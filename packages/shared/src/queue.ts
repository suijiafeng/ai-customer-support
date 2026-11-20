/**
 * 接待大厅（待接待）的唯一判定：访客已转人工（waiting_human）且还没有客服认领。
 * AI 仍在答的会话（bot）不算待接待。工作台侧栏的「N 位待接待」和接待大厅列表都用它，
 * 避免两处各写一套条件、数字对不上。
 */
export function isAwaitingHuman(session: { status: string; assignedAgentId?: string | null }): boolean {
  return session.status === 'waiting_human' && !session.assignedAgentId;
}

export function countAwaitingHuman(sessions: Array<{ status: string; assignedAgentId?: string | null }>): number {
  let n = 0;
  for (const s of sessions) if (isAwaitingHuman(s)) n += 1;
  return n;
}
