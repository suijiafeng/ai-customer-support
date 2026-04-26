var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Req, Sse, UseGuards, } from '@nestjs/common';
import { map } from 'rxjs';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { normalizeAttachments, normalizeProfile } from '../common/normalize.js';
import { SseService } from '../sse/sse.service.js';
import { SessionTicketService } from '../workflow/session-ticket.service.js';
import { SessionsService } from './sessions.service.js';
let SessionsController = class SessionsController {
    sessions;
    workflow;
    metrics;
    sse;
    auth;
    constructor(sessions, workflow, metrics, sse, auth) {
        this.sessions = sessions;
        this.workflow = workflow;
        this.metrics = metrics;
        this.sse = sse;
        this.auth = auth;
    }
    listSessions(req) {
        return this.sessions.getSessionsPayload(req.agent);
    }
    queueEvents(req) {
        const agent = req.agent;
        return this.sse.queueStream(this.sessions.getSessionsPayload(agent)).pipe(map((event) => ({
            type: event.type,
            data: event.type === 'sessions'
                ? this.sessions.filterPayloadForAgent(event.data, agent)
                : event.data,
        })));
    }
    /**
     * 访客侧读取的准入判定：必须是「本会话的访客」或「有权查看的客服」，二者居一。
     *
     * 令牌从两处取：REST 走 `x-visitor-token` 头，SSE 走 `?vt=`
     * （EventSource 无法自定义请求头，与客服的 ?ticket= 同理）。
     *
     * ALLOW_ANON_SESSION_READ=true 可临时放行未携带令牌的请求，仅供存量 widget 灰度期使用；
     * 一旦线上 widget 都升到会带令牌的版本就应该关掉。默认关闭——安全默认值不该由部署者操心。
     */
    assertVisitorOrAgent(sessionId, req) {
        const agent = this.agentFromRequest(req);
        if (agent)
            return agent;
        const token = req.headers['x-visitor-token'] ||
            req.query?.vt;
        if (this.auth.verifyVisitorToken(token, sessionId))
            return null;
        if (process.env.ALLOW_ANON_SESSION_READ === 'true')
            return null;
        throw new ForbiddenException({
            error: 'visitor token required',
            detail: '会话读取需要出示该会话的访客令牌（x-visitor-token 头或 ?vt= 查询串）',
        });
    }
    async getSession(sessionId, req) {
        // 注意顺序：先鉴权再查库。反过来会把「会话是否存在」这一位信息泄漏给未授权方，
        // 攻击者可以据此枚举出哪些 sessionId 是真实存在的。
        const agent = this.assertVisitorOrAgent(sessionId, req);
        const { session, messages } = await this.sessions.loadDetail(sessionId);
        if (!session)
            throw new NotFoundException({ error: 'session not found' });
        if (agent && !this.sessions.canView(session, agent)) {
            throw new ForbiddenException({ error: 'session is handled by another agent' });
        }
        const payload = { session, messages };
        return agent ? payload : this.redactVisitor(payload);
    }
    sessionEvents(sessionId, req) {
        const agent = this.assertVisitorOrAgent(sessionId, req);
        const session = this.sessions.get(sessionId);
        if (agent && session && !this.sessions.canView(session, agent)) {
            throw new ForbiddenException({ error: 'session is handled by another agent' });
        }
        return this.sse
            .sessionStream(sessionId, this.sessions.getSessionPayload(sessionId))
            .pipe(map((event) => ({
            type: event.type,
            data: (agent
                ? event.data
                : this.redactVisitor(event.data)),
        })));
    }
    resolveSession(sessionId, body, req) {
        const session = this.sessions.get(sessionId);
        const resolution = String(body?.resolution || '人工客服已标记解决').trim().slice(0, 120);
        if (!session)
            throw new NotFoundException({ error: 'session not found' });
        const agent = req.agent;
        this.assertOwnerOrUnassigned(session, agent);
        if (session.status === 'closed') {
            return {
                session,
                tickets: this.workflow.resolvedTicketsForSession(sessionId),
                metrics: this.metrics.buildMetrics(),
            };
        }
        const resolvedTickets = this.workflow.resolveSessionTickets(sessionId, resolution);
        const updatedSession = {
            ...session,
            status: 'closed',
            needHuman: false,
            reason: resolution,
            workflow: session.workflow
                ? {
                    ...session.workflow,
                    needHuman: false,
                    reason: resolution,
                    ticket: resolvedTickets[0] || session.workflow.ticket || null,
                }
                : session.workflow,
            resolvedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        this.sessions.setSession(updatedSession);
        this.workflow.notify(sessionId);
        return {
            session: updatedSession,
            tickets: resolvedTickets,
            metrics: this.metrics.buildMetrics(),
        };
    }
    postMessage(sessionId, body, req) {
        const actor = body?.actor === 'customer' ? 'customer' : 'agent';
        const session = this.sessions.get(sessionId);
        const content = String(body?.content || '').trim();
        const agent = req.agent;
        const attachments = normalizeAttachments(body?.attachments);
        if (!session)
            throw new NotFoundException({ error: 'session not found' });
        if (!content && attachments.length === 0) {
            throw new BadRequestException({ error: 'content or attachments required' });
        }
        if (actor === 'customer') {
            throw new BadRequestException({ error: 'customer messages must use /api/chat' });
        }
        const isAdmin = agent.role === 'admin';
        if (session.assignedAgentId && session.assignedAgentId !== agent.id && !isAdmin) {
            throw new ConflictException({
                error: 'session is assigned to another agent',
                assignedAgentId: session.assignedAgentId,
                assignedAgentName: session.assignedAgentName,
            });
        }
        const currentMessages = this.sessions.getMessages(sessionId);
        const nextMessages = this.sessions.appendMessages(currentMessages, this.sessions.createMessage({
            role: 'assistant',
            actor: 'agent',
            content,
            agentId: agent.id,
            agentName: agent.name,
            attachments,
        }));
        const linkedTicket = this.workflow.advanceTicketOnFirstReply(sessionId);
        const updatedSession = {
            ...session,
            status: 'assigned',
            assignedAgentId: session.assignedAgentId || agent.id,
            assignedAgentName: session.assignedAgentName || agent.name,
            // 接管计时起点：首次接管时写入，后续客服回复以消息时间为准（见 humanIdleMs）
            assignedAt: session.assignedAt || new Date().toISOString(),
            lastMessage: content,
            ticketId: linkedTicket?.id || session.ticketId,
            workflow: session.workflow
                ? {
                    ...session.workflow,
                    ticket: linkedTicket || session.workflow.ticket || null,
                }
                : session.workflow,
            updatedAt: new Date().toISOString(),
        };
        this.sessions.setConversation(sessionId, nextMessages);
        this.sessions.setSession(updatedSession);
        this.workflow.notify(sessionId);
        return { session: updatedSession, messages: nextMessages };
    }
    setProfile(sessionId, body, req) {
        const profile = normalizeProfile(body);
        const current = this.sessions.get(sessionId);
        if (!current)
            throw new NotFoundException({ error: 'session not found' });
        const agent = req.agent;
        this.assertOwnerOrUnassigned(current, agent);
        const updatedSession = {
            ...current,
            profile,
            displayName: this.sessions.buildDisplayName(sessionId, current?.inquiryId ?? null, profile, current?.visitor ?? null),
            updatedAt: new Date().toISOString(),
        };
        this.sessions.setSession(updatedSession);
        this.workflow.notify(sessionId);
        return { session: updatedSession };
    }
    /**
     * 会话级操作（标记解决 / 改资料）的归属判定，与工单侧 assertCanOperate 保持一致：
     * 管理员全部可操作；普通客服可操作「自己的 + 尚未认领」的会话。
     * 之前要求必须已归属自己，导致接待大厅里等人工的会话普通客服既不能先补资料也不能直接关闭。
     */
    assertOwnerOrUnassigned(session, agent) {
        if (agent.role === 'admin')
            return;
        if (session.assignedAgentId && session.assignedAgentId !== agent.id) {
            throw new ForbiddenException({ error: 'session is handled by another agent' });
        }
    }
    redactVisitor(payload) {
        const session = payload.session;
        if (!session?.visitor)
            return payload;
        const { code, createdAt } = session.visitor;
        return { ...payload, session: { ...session, visitor: { code, createdAt } } };
    }
    agentFromRequest(req) {
        const header = String(req.headers.authorization || '');
        const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
        if (bearer)
            return this.auth.verify(bearer);
        const ticket = String(req.query?.ticket || '');
        return ticket ? this.auth.verifySseTicket(ticket) : null;
    }
};
__decorate([
    UseGuards(AgentAuthGuard),
    Get(),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "listSessions", null);
__decorate([
    UseGuards(AgentAuthGuard),
    Sse('events'),
    __param(0, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "queueEvents", null);
__decorate([
    Get(':sessionId'),
    __param(0, Param('sessionId')),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], SessionsController.prototype, "getSession", null);
__decorate([
    Sse(':sessionId/events'),
    __param(0, Param('sessionId')),
    __param(1, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "sessionEvents", null);
__decorate([
    UseGuards(AgentAuthGuard),
    Post(':sessionId/resolve'),
    __param(0, Param('sessionId')),
    __param(1, Body()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "resolveSession", null);
__decorate([
    UseGuards(AgentAuthGuard),
    Post(':sessionId/messages'),
    __param(0, Param('sessionId')),
    __param(1, Body()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "postMessage", null);
__decorate([
    UseGuards(AgentAuthGuard),
    Post(':sessionId/profile'),
    __param(0, Param('sessionId')),
    __param(1, Body()),
    __param(2, Req()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], SessionsController.prototype, "setProfile", null);
SessionsController = __decorate([
    Controller('api/sessions'),
    __metadata("design:paramtypes", [SessionsService,
        SessionTicketService,
        MetricsService,
        SseService,
        AuthService])
], SessionsController);
export { SessionsController };
//# sourceMappingURL=sessions.controller.js.map