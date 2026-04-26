var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { LIMITS } from '@assistflow/shared';
import { extractInquiryId } from '../rules/rules.js';
import { inferVisitorFromSessionId } from '../common/normalize.js';
import { StoreService } from '../store/store.service.js';
let SessionsService = class SessionsService {
    store;
    sessions = new Map();
    conversations = new Map();
    constructor(store) {
        this.store = store;
    }
    async onModuleInit() {
        await this.store.whenReady;
        const persisted = this.store.getPersisted();
        for (const [id, data] of persisted.sessions)
            this.sessions.set(id, data);
        for (const [id, messages] of persisted.conversations)
            this.conversations.set(id, messages);
    }
    get(sessionId) {
        return this.sessions.get(sessionId);
    }
    getMessages(sessionId) {
        return this.conversations.get(sessionId) || [];
    }
    list() {
        return [...this.sessions.values()];
    }
    get messageCount() {
        return [...this.conversations.values()].reduce((total, messages) => total + messages.length, 0);
    }
    isHumanAssigned(sessionId) {
        return this.sessions.get(sessionId)?.status === 'assigned';
    }
    /**
     * 人工侧静默了多久（毫秒）：从「最后一条客服消息」算起，没有客服消息则从接管时刻算起。
     * 注意不能用 session.updatedAt——访客每发一条都会刷新它，那样永远等不到超时。
     */
    humanIdleMs(sessionId, now = Date.now()) {
        const session = this.sessions.get(sessionId);
        if (!session || session.status !== 'assigned')
            return 0;
        const messages = this.conversations.get(sessionId) || [];
        const lastAgentAt = [...messages].reverse().find((m) => m.actor === 'agent')?.createdAt;
        const since = lastAgentAt || session.assignedAt || session.updatedAt;
        const sinceMs = new Date(since).getTime();
        return Number.isFinite(sinceMs) ? Math.max(0, now - sinceMs) : 0;
    }
    /** 把会话从人工交还给 AI：清空归属并回到 bot 状态（超时自动 / 访客主动都走这里）。 */
    releaseToBot(sessionId, reason) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return null;
        return this.setSession({
            ...session,
            status: 'bot',
            assignedAgentId: null,
            assignedAgentName: null,
            assignedAt: null,
            needHuman: false,
            reason,
            updatedAt: new Date().toISOString(),
        });
    }
    /** 距上一条系统提示是否已超过冷却时间（避免访客每发一条就刷一条提示）。 */
    canPostSystemNotice(sessionId, cooldownMs, now = Date.now()) {
        if (cooldownMs <= 0)
            return true;
        const messages = this.conversations.get(sessionId) || [];
        const lastNoticeAt = [...messages].reverse().find((m) => m.actor === 'system')?.createdAt;
        if (!lastNoticeAt)
            return true;
        const ts = new Date(lastNoticeAt).getTime();
        return !Number.isFinite(ts) || now - ts >= cooldownMs;
    }
    canView(session, agent) {
        if (agent.role === 'admin')
            return true;
        return !session.assignedAgentId || session.assignedAgentId === agent.id;
    }
    setSession(session) {
        touch(this.sessions, session.sessionId, session);
        this.store.saveSession(session);
        trimMap(this.sessions, LIMITS.MAX_SESSIONS);
        return session;
    }
    setConversation(sessionId, messages) {
        touch(this.conversations, sessionId, messages);
        this.store.saveConversation(sessionId, messages);
        trimMap(this.conversations, LIMITS.MAX_CONVERSATIONS);
        return messages;
    }
    async loadDetail(sessionId) {
        let session = this.sessions.get(sessionId) ?? null;
        let messages = this.conversations.get(sessionId);
        if (!session) {
            session = await this.store.loadSession(sessionId);
            if (session) {
                touch(this.sessions, sessionId, session);
                trimMap(this.sessions, LIMITS.MAX_SESSIONS);
            }
        }
        if (messages === undefined) {
            const loaded = await this.store.loadConversation(sessionId);
            if (loaded) {
                messages = loaded;
                touch(this.conversations, sessionId, loaded);
                trimMap(this.conversations, LIMITS.MAX_CONVERSATIONS);
            }
        }
        return { session, messages: messages ?? [] };
    }
    createMessage(params) {
        return {
            id: randomUUID(),
            clientMessageId: params.clientMessageId ?? null,
            role: params.role,
            actor: params.actor,
            content: params.content,
            agentId: params.agentId ?? null,
            agentName: params.agentName ?? null,
            attachments: params.attachments ?? [],
            createdAt: new Date().toISOString(),
        };
    }
    appendMessages(currentMessages, ...nextMessages) {
        return [...currentMessages, ...nextMessages].slice(-LIMITS.MAX_MESSAGES_PER_SESSION);
    }
    upsertSession(params) {
        const { sessionId, message, workflow, profile, visitor, forceStatus, tenantKey } = params;
        const now = new Date().toISOString();
        const current = this.sessions.get(sessionId);
        const nextProfile = profile || current?.profile || null;
        const nextVisitor = visitor || current?.visitor || inferVisitorFromSessionId(sessionId);
        const status = forceStatus || resolveSessionStatus(current, workflow);
        const keepHighPriority = current?.priority === 'high' && current?.status !== 'closed';
        const priority = keepHighPriority || workflow.needHuman ? 'high' : 'normal';
        const inquiryId = workflow.inquiry?.id || current?.inquiryId || extractInquiryId(message) || null;
        const displayName = this.buildDisplayName(sessionId, inquiryId, nextProfile, nextVisitor);
        const session = {
            sessionId,
            displayName,
            profile: nextProfile,
            visitor: nextVisitor,
            status,
            priority,
            lastMessage: message,
            lastIntent: workflow.intent,
            sentiment: workflow.sentiment,
            needHuman: workflow.needHuman,
            reason: workflow.reason,
            inquiryId,
            ticketId: workflow.ticket?.id || current?.ticketId || null,
            assignedAgentId: status === 'assigned' ? current?.assignedAgentId || null : null,
            assignedAgentName: status === 'assigned' ? current?.assignedAgentName || null : null,
            assignedAt: status === 'assigned' ? current?.assignedAt || now : null,
            workflow,
            createdAt: current?.createdAt || now,
            updatedAt: now,
            tenantKey: tenantKey ?? current?.tenantKey ?? null,
        };
        return this.setSession(session);
    }
    syncFromTicket(ticket) {
        const session = this.sessions.get(ticket.sessionId);
        if (!session)
            return null;
        const isResolved = ticket.status === 'resolved';
        const nextSession = {
            ...session,
            status: isResolved ? 'closed' : ticket.status === 'processing' ? 'assigned' : session.status,
            assignedAt: isResolved
                ? null
                : ticket.status === 'processing'
                    ? session.assignedAt || new Date().toISOString()
                    : session.assignedAt,
            priority: ticket.priority,
            needHuman: isResolved ? false : session.needHuman,
            reason: ticket.resolution || session.reason,
            ticketId: ticket.id,
            workflow: session.workflow
                ? {
                    ...session.workflow,
                    needHuman: isResolved ? false : session.workflow.needHuman,
                    reason: ticket.resolution || session.workflow.reason,
                    ticket,
                }
                : session.workflow,
            resolvedAt: isResolved ? ticket.resolvedAt : session.resolvedAt,
            updatedAt: new Date().toISOString(),
        };
        return this.setSession(nextSession);
    }
    createEmptySession(sessionId) {
        const now = new Date().toISOString();
        return {
            sessionId,
            displayName: this.buildDisplayName(sessionId, null, null, inferVisitorFromSessionId(sessionId)),
            profile: null,
            visitor: inferVisitorFromSessionId(sessionId),
            status: 'bot',
            priority: 'normal',
            lastMessage: '',
            lastIntent: 'general',
            sentiment: 'neutral',
            needHuman: false,
            reason: '',
            inquiryId: null,
            ticketId: null,
            assignedAgentId: null,
            assignedAgentName: null,
            workflow: null,
            createdAt: now,
            updatedAt: now,
        };
    }
    buildDisplayName(sessionId, inquiryId, profile, visitor) {
        if (profile?.name)
            return profile.name;
        if (visitor?.code)
            return `访客 ${visitor.code}`;
        if (inquiryId)
            return `咨询 ${inquiryId}`;
        const suffix = sessionId.replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() ||
            String(this.sessions.size + 1).padStart(2, '0');
        return `访客 ${suffix}`;
    }
    getSessionsPayload(agent) {
        const all = [...this.sessions.values()];
        const scoped = agent ? all.filter((session) => this.canView(session, agent)) : all;
        return {
            sessions: scoped.sort(sortSessions).map((session) => {
                const msgs = this.conversations.get(session.sessionId);
                return {
                    ...session,
                    messageCount: msgs?.length || 0,
                    // 系统提示不算「有人回复过」，否则队列里会把仍在等客服的会话标成已回复
                    lastMessageRole: lastHumanRole(msgs),
                };
            }),
        };
    }
    filterPayloadForAgent(payload, agent) {
        if (agent.role === 'admin')
            return payload;
        return { sessions: payload.sessions.filter((session) => this.canView(session, agent)) };
    }
    getSessionPayload(sessionId) {
        return {
            session: this.sessions.get(sessionId) || null,
            messages: this.conversations.get(sessionId) || [],
        };
    }
};
SessionsService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [StoreService])
], SessionsService);
export { SessionsService };
function resolveSessionStatus(current, workflow) {
    if (current?.status === 'closed')
        return workflow.needHuman ? 'waiting_human' : 'bot';
    if (current?.status === 'assigned')
        return 'assigned';
    if (workflow.needHuman)
        return 'waiting_human';
    return current?.status || 'bot';
}
/** 最后一条非系统消息的发送方：user=访客在等回复，assistant=AI/客服已回过 */
function lastHumanRole(messages) {
    const last = [...(messages || [])].reverse().find((m) => m.actor !== 'system');
    return last?.role ?? null;
}
function sortSessions(a, b) {
    const priorityRank = { high: 0, normal: 1 };
    const statusRank = { waiting_human: 0, bot: 1, assigned: 2, closed: 3 };
    const rankA = priorityRank[a.priority] ?? 1;
    const rankB = priorityRank[b.priority] ?? 1;
    if (rankA !== rankB)
        return rankA - rankB;
    const statusA = statusRank[a.status] ?? 9;
    const statusB = statusRank[b.status] ?? 9;
    if (statusA !== statusB)
        return statusA - statusB;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}
/**
 * 写入时把键挪到 Map 末尾，让插入顺序 = 最近使用顺序。
 * Map.set 覆盖已有键不会改变顺序，纯 set 会让 trimMap 淘汰「最早创建」而非「最久未用」的会话：
 * 一个聊了一上午的老会话会被刚进来的新访客挤出内存。
 */
function touch(map, key, value) {
    map.delete(key);
    map.set(key, value);
}
/** 内存只保留最近使用的 N 条；淘汰只影响内存，库里仍有，可由 loadDetail 回灌 */
function trimMap(map, maxEntries) {
    while (map.size > maxEntries) {
        const firstKey = map.keys().next().value;
        map.delete(firstKey);
    }
}
//# sourceMappingURL=sessions.service.js.map