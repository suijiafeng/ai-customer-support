// 测试用 SSE 客户端：打开一条事件流，持续收集文本，可按条件等待，也能判断服务端是否已关闭连接。
export async function openSse(url, headers = {}) {
  const ac = new AbortController();
  // 与浏览器 EventSource 一样带 Accept，服务端据此跳过统一响应包装
  const res = await fetch(url, { headers: { accept: 'text/event-stream', ...headers }, signal: ac.signal });
  const state = { status: res.status, contentType: res.headers.get('content-type') || '', text: '', ended: false, res };
  if (!res.ok || !res.body) {
    state.text = await res.text().catch(() => '');
    state.ended = true;
    return { ...state, events: () => [], waitFor: async () => false, waitEnd: async () => true, close: () => {} };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        state.text += dec.decode(value, { stream: true });
      }
      state.ended = true;
    } catch {
      /* 主动 abort */
    }
  })();
  const events = () =>
    state.text
      .split('\n\n')
      .filter((block) => block.includes('data:'))
      .map((block) => {
        const type = /^event: (.*)$/m.exec(block)?.[1] || 'message';
        const raw = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        let data = raw;
        try { data = JSON.parse(raw); } catch {}
        return { type, data };
      });
  const waitFor = async (predicate, timeoutMs = 3000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (predicate(events(), state.text)) return true;
      if (state.ended) return predicate(events(), state.text);
      await new Promise((r) => setTimeout(r, 25));
    }
    return false;
  };
  const waitEnd = async (timeoutMs = 3000) => {
    await Promise.race([pump, new Promise((r) => setTimeout(r, timeoutMs))]);
    return state.ended;
  };
  return {
    get status() { return state.status; },
    get contentType() { return state.contentType; },
    get text() { return state.text; },
    get ended() { return state.ended; },
    events,
    waitFor,
    waitEnd,
    close: () => ac.abort(),
  };
}
