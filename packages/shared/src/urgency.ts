/**
 * 「急」与「等待超时」的统一规则（工作台接待大厅、会话详情、跟进事项共用）。
 *
 * - 急：访客原话里明确催促（URGENT_KEYWORDS）。服务端建跟进事项时用同一份词表把优先级
 *   定为 high，所以大厅里的「急」和跟进事项里的「急」指的是同一件事；跟进事项上客服
 *   手动改过的优先级以手动为准。
 *   会话的 priority 字段对所有转人工会话都是 high，不能拿来判断「急」。
 *   会话带着关联跟进事项时直接看它的优先级（含客服手动调整），否则按访客最近一句话判断。
 * - 等待超时：转人工后超过 URGENT_WAIT_MINUTES 分钟没人接（首次响应 SLA）。超时只把
 *   等待时长变成警示色，不额外加标签。
 * - 情绪负面单独用一个 ⚠ 图标表示，和「急」互不重复。
 */
export const URGENT_KEYWORDS = ['紧急', '尽快', '马上', '今天联系'] as const;

/** 首次人工响应 SLA（分钟） */
export const URGENT_WAIT_MINUTES = 5;

const squash = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, '');

/** 访客原话是否明确催促 */
export function isUrgentText(text: unknown): boolean {
  const value = squash(text);
  return URGENT_KEYWORDS.some((term) => value.includes(squash(term)));
}

/** 等待是否已超过 SLA */
export function isWaitOverdue(sinceIso: string | null | undefined, now: number = Date.now()): boolean {
  if (!sinceIso) return false;
  const since = new Date(sinceIso).getTime();
  if (Number.isNaN(since)) return false;
  return now - since >= URGENT_WAIT_MINUTES * 60_000;
}

/** 会话是否「急」：有关联跟进事项看它的优先级，没有则看访客最近一句话 */
export function isUrgentSession(session: {
  lastMessage?: string | null;
  workflow?: { ticket?: { priority?: string } | null } | null;
}): boolean {
  const ticket = session.workflow?.ticket;
  if (ticket?.priority) return ticket.priority === 'high';
  return isUrgentText(session.lastMessage);
}
