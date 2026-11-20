import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import type { Message, Session } from '@assistflow/shared';
import { Observable, filter, map } from 'rxjs';
import { AgentAuthGuard } from '../auth/auth.guard.js';
import { AuthService, type AuthenticatedAgent } from '../auth/auth.service.js';
import { MetricsService } from '../metrics/metrics.service.js';
import { normalizeAttachments, normalizeProfile } from '../common/normalize.js';
import { REVOKED_EVENT, SseService, type SseMessage } from '../sse/sse.service.js';
import { SessionAccessGuard, type SessionAccess } from './session-access.guard.js';
import { toVisitorPayload } from './visitor-view.js';
import { SessionTicketService } from '../workflow/session-ticket.service.js';
import { SessionsService } from './sessions.service.js';
import { AgentAuditService } from '../agent/audit.js';

@Controller('api/sessions')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly workflow: SessionTicketService,
    private readonly metrics: MetricsService,
    private readonly sse: SseService,
    private readonly auth: AuthService,
    private readonly agentAudit: AgentAuditService,
  ) {}

  @UseGuards(AgentAuthGuard)
  @Get()
  listSessions(@Req() req: any) {
    return this.sessions.getSessionsPayload(req.agent as AuthenticatedAgent);
  }

  /**
   * 接待大厅实时队列。每条推送前按「当前」账号复核（见 SseService.live）：
   * 停用 / 删除 / 改密码后发 revoked 并断开；降级后发 role 事件并立即按新权限重推一次快照，
   * 之后只能收到自己能看的会话（不再收到别人名下的会话）。
   */
  @UseGuards(AgentAuthGuard)
  @Sse('events')
  queueEvents(@Req() req: any) {
    const agent = req.agent as AuthenticatedAgent;
    return this.sse.live(this.sse.queueStream(this.sessions.getSessionsPayload(agent)), {
      initial: agent,
      recheck: () => this.auth.revalidate(agent),
      changes$: this.accountChanges(agent.id),
      project: (event, current) =>
        event.type === 'sessions'
          ? { type: 'sessions', data: this.sessions.filterPayloadForAgent(event.data as { sessions: any[] }, current) }
          : event,
      onRoleChange: (current) => ({ type: 'sessions', data: this.sessions.getSessionsPayload(current) }),
    });
  }

  private accountChanges(agentId: string) {
    return this.auth.changes$.pipe(filter((change) => change.id === agentId));
  }

  @UseGuards(AgentAuthGuard)
  @Get(':sessionId/agent-audit')
  async agentAuditLog(@Param('sessionId') sessionId: string, @Req() req: any) {
    const agent = req.agent as AuthenticatedAgent;
    const { session } = await this.sessions.loadDetail(sessionId);
    if (!session) throw new NotFoundException({ error: 'session not found' });
    if (!this.sessions.canView(session, agent)) {
      throw new ForbiddenException({ error: 'session is handled by another agent' });
    }
    return { entries: await this.agentAudit.forSession(sessionId) };
  }

  @UseGuards(SessionAccessGuard)
  @Get(':sessionId')
  async getSession(@Param('sessionId') sessionId: string, @Req() req: any) {
    const { agent } = req.sessionAccess as SessionAccess;
    const { session, messages } = await this.sessions.loadDetail(sessionId);
    if (!session) throw new NotFoundException({ error: 'session not found' });
    const payload = { session, messages };
    return agent ? payload : toVisitorPayload(payload);
  }

  /**
   * 单会话实时消息。准入在 SessionAccessGuard 里做（非 200 状态码，EventSource 不会死循环重连）。
   * 客服连接每条推送前复核：账号失效发 revoked{account_changed}；会话被别的客服认领、
   * 当前客服已无权查看时发 revoked{session_reassigned} 并断开，之后的消息不会再推给他。
   * 访客连接只下发白名单字段（visitor-view.ts）。
   */
  @UseGuards(SessionAccessGuard)
  @Sse(':sessionId/events')
  sessionEvents(@Param('sessionId') sessionId: string, @Req() req: any): Observable<SseMessage> {
    const { agent } = req.sessionAccess as SessionAccess;
    const source$ = this.sse.sessionStream(sessionId, this.sessions.getSessionPayload(sessionId));
    if (!agent) {
      return source$.pipe(
        map((event) =>
          event.type === 'session'
            ? { type: 'session', data: toVisitorPayload(event.data as { session: Session | null; messages: Message[] }) }
            : event
        )
      );
    }
    return this.sse.live(source$, {
      initial: agent,
      recheck: () => this.auth.revalidate(agent),
      changes$: this.accountChanges(agent.id),
      project: (event, current) => {
        if (event.type !== 'session') return event;
        const session = (event.data as { session: Session | null })?.session ?? this.sessions.get(sessionId);
        if (session && !this.sessions.canView(session, current)) {
          return {
            type: REVOKED_EVENT,
            data: {
              reason: 'session_reassigned',
              assignedAgentId: session.assignedAgentId ?? null,
              assignedAgentName: session.assignedAgentName ?? null,
            },
          };
        }
        return event;
      },
    });
  }

  @UseGuards(AgentAuthGuard)
  @Post(':sessionId/resolve')
  resolveSession(@Param('sessionId') sessionId: string, @Body() body: any, @Req() req: any) {
    const session = this.sessions.get(sessionId);
    const resolution = String(body?.resolution || '人工客服已标记解决').trim().slice(0, 120);
    if (!session) throw new NotFoundException({ error: 'session not found' });
    const agent = req.agent as AuthenticatedAgent;
    this.assertOwnerOrUnassigned(session, agent);
    if (session.status === 'closed') {
      return {
        session,
        tickets: this.workflow.resolvedTicketsForSession(sessionId),
        metrics: this.metrics.buildMetrics(),
      };
    }
    const resolvedTickets = this.workflow.resolveSessionTickets(sessionId, resolution);
    const updatedSession: Session = {
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

  @UseGuards(AgentAuthGuard)
  @Post(':sessionId/messages')
  postMessage(@Param('sessionId') sessionId: string, @Body() body: any, @Req() req: any) {
    const actor = body?.actor === 'customer' ? 'customer' : 'agent';
    const session = this.sessions.get(sessionId);
    const content = String(body?.content || '').trim();
    const agent = req.agent as AuthenticatedAgent;
    const attachments = normalizeAttachments(body?.attachments);
    if (!session) throw new NotFoundException({ error: 'session not found' });
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
    const nextMessages = this.sessions.appendMessages(
      currentMessages,
      this.sessions.createMessage({
        role: 'assistant',
        actor: 'agent',
        content,
        agentId: agent.id,
        agentName: agent.name,
        agentRole: agent.role,
        attachments,
      })
    );
    const linkedTicket = this.workflow.advanceTicketOnFirstReply(sessionId);
    const updatedSession: Session = {
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

  @UseGuards(AgentAuthGuard)
  @Post(':sessionId/profile')
  setProfile(@Param('sessionId') sessionId: string, @Body() body: any, @Req() req: any) {
    const profile = normalizeProfile(body);
    const current = this.sessions.get(sessionId);
    if (!current) throw new NotFoundException({ error: 'session not found' });
    const agent = req.agent as AuthenticatedAgent;
    this.assertOwnerOrUnassigned(current, agent);
    const updatedSession: Session = {
      ...current,
      profile,
      displayName: this.sessions.buildDisplayName(
        sessionId,
        current?.inquiryId ?? null,
        profile,
        current?.visitor ?? null
      ),
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
  private assertOwnerOrUnassigned(session: Session, agent: AuthenticatedAgent) {
    if (agent.role === 'admin') return;
    if (session.assignedAgentId && session.assignedAgentId !== agent.id) {
      throw new ForbiddenException({ error: 'session is handled by another agent' });
    }
  }
}
