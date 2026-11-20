// 客服回复草稿：按「客服 + 会话」保存在 sessionStorage（刷新不丢，关掉标签页即清除）。
// 典型场景：两位客服同时接同一位访客，抢输的一方会话从列表里消失、输入框随之卸载，
// 打了一半的回复不能跟着没了。

const PREFIX = 'assistflow.draft.';
const memory = new Map<string, string>(); // sessionStorage 不可用（隐私模式等）时的兜底

const keyOf = (agentId: string, sessionId: string) => `${PREFIX}${agentId}:${sessionId}`;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadDraft(agentId: string, sessionId: string): string {
  const key = keyOf(agentId, sessionId);
  try {
    return storage()?.getItem(key) ?? memory.get(key) ?? '';
  } catch {
    return memory.get(key) ?? '';
  }
}

export function saveDraft(agentId: string, sessionId: string, text: string): void {
  const key = keyOf(agentId, sessionId);
  if (!text.trim()) {
    clearDraft(agentId, sessionId);
    return;
  }
  memory.set(key, text);
  try {
    storage()?.setItem(key, text);
  } catch {
    // 配额满等：内存里那份仍可用
  }
}

export function clearDraft(agentId: string, sessionId: string): void {
  const key = keyOf(agentId, sessionId);
  memory.delete(key);
  try {
    storage()?.removeItem(key);
  } catch {}
}
