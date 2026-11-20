import type { AgentActionCard, Message, Session } from '@assistflow/shared';

/**
 * 访客侧可见字段的白名单。访客令牌只证明「这是你的会话」，不代表能看客服的内部判断：
 * 情绪、优先级、意图、客服 id、完整跟进事项、模型厂商与型号、知识库命中分数等都不该下发。
 * 新增字段默认不出现在这里——想给访客看，就显式加进来。
 */
export interface VisitorMessage {
  id: string;
  clientMessageId: string | null;
  role: Message['role'];
  actor: Message['actor'];
  content: string;
  /** 只给显示名，挂件用来写「客服9528」 */
  agentName: string | null;
  attachments: Message['attachments'];
  createdAt: string;
  agentAction?: Pick<AgentActionCard, 'id' | 'title' | 'summary' | 'status' | 'demo'> | null;
}

export interface VisitorSession {
  sessionId: string;
  status: Session['status'];
  /** 排队状态：已转人工、还在等客服 */
  needHuman: boolean;
  assignedAgentName: string | null;
  visitor: { code: string; createdAt: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export function toVisitorMessage(m: Message): VisitorMessage {
  const out: VisitorMessage = {
    id: m.id,
    clientMessageId: m.clientMessageId ?? null,
    role: m.role,
    actor: m.actor,
    content: m.content,
    agentName: m.actor === 'agent' ? m.agentName ?? null : null,
    attachments: Array.isArray(m.attachments) ? m.attachments : [],
    createdAt: m.createdAt,
  };
  if (m.agentAction) {
    const { id, title, summary, status, demo } = m.agentAction;
    out.agentAction = { id, title, summary, status, demo };
  }
  return out;
}

export function toVisitorSession(s: Session | null | undefined): VisitorSession | null {
  if (!s) return null;
  return {
    sessionId: s.sessionId,
    status: s.status,
    needHuman: Boolean(s.needHuman),
    assignedAgentName: s.status === 'assigned' ? s.assignedAgentName ?? null : null,
    visitor: s.visitor?.code ? { code: s.visitor.code, createdAt: s.visitor.createdAt ?? null } : null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function toVisitorPayload(payload: { session: Session | null; messages?: Message[] }) {
  return {
    session: toVisitorSession(payload.session),
    messages: (payload.messages || []).map(toVisitorMessage),
  };
}

/**
 * /api/chat 系列响应的访客视图：保留挂件和对接方要用的结果字段
 * （reply / intent / needHuman / inquiry / 跟进事项编号与状态 / 是否用了模型 / 引用的 FAQ 标题），
 * 会话与消息走同一份白名单；去掉情绪、原因、模型厂商型号、检索分数和完整跟进事项。
 */
export function toVisitorChatResponse<T>(result: T): any {
  const r = result as any;
  if (!r || typeof r !== 'object' || typeof r.sessionId !== 'string') return result;
  const out: Record<string, unknown> = {
    sessionId: r.sessionId,
    reply: r.reply ?? '',
    session: toVisitorSession(r.session),
    messages: Array.isArray(r.messages) ? r.messages.map(toVisitorMessage) : [],
  };
  if (r.visitorToken) out.visitorToken = r.visitorToken;
  if (r.alreadyHandled) out.alreadyHandled = true;
  if (r.handledByAgent) out.handledByAgent = true;
  if (r.intent !== undefined) out.intent = r.intent;
  if (r.needHuman !== undefined) out.needHuman = Boolean(r.needHuman);
  if (r.inquiry !== undefined) out.inquiry = r.inquiry;
  if (r.ticket !== undefined) out.ticket = r.ticket ? { id: r.ticket.id, status: r.ticket.status } : null;
  if (r.ai) out.ai = { used: Boolean(r.ai.used), fallback: Boolean(r.ai.fallback) };
  if (Array.isArray(r.sources)) out.sources = r.sources.map((s: any) => ({ id: s.id, question: s.question }));
  return out;
}
