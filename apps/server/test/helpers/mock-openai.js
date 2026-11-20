// 测试用的 OpenAI 兼容服务：只实现 POST /v1/chat/completions。
// - 记录每次请求体（requests），便于断言服务端到底发了什么；
// - 默认按 OpenAI 的规则校验 tool 消息：role=tool 必须带 tool_call_id，且前面要有带 tool_calls 的 assistant；
// - handler(body) 决定回什么：{ status, json } | { message } | { stream: string[], delayMs }。
import http from 'node:http';

export function validateToolMessages(messages = []) {
  const open = new Set();
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const call of m.tool_calls) open.add(call.id);
    }
    if (m.role === 'tool') {
      if (!m.tool_call_id || !open.has(m.tool_call_id)) {
        return "Invalid parameter: messages with role 'tool' must be a response to a preceeding message with 'tool_calls'.";
      }
    }
  }
  return null;
}

export async function startMockOpenAI(handler, { strictTools = true } = {}) {
  const requests = [];
  const events = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      const body = raw ? JSON.parse(raw) : {};
      requests.push(body);
      const invalid = strictTools ? validateToolMessages(body.messages) : null;
      if (invalid) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: invalid, type: 'invalid_request_error' } }));
        return;
      }
      const out = (await handler(body, requests.length)) || {};
      if (out.hang) return; // 永不响应：用来测超时
      if (out.status && out.status !== 200) {
        res.writeHead(out.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(out.json || { error: { message: 'mock error' } }));
        return;
      }
      if (body.stream) {
        const chunks = out.stream || [];
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        let closed = false;
        res.on('close', () => {
          if (!res.writableFinished) {
            closed = true;
            events.push('client_closed');
          }
        });
        for (let i = 0; i < chunks.length && !closed; i += 1) {
          const chunk = { id: 'mock', object: 'chat.completion.chunk', created: 0, model: body.model, choices: [{ index: 0, delta: { content: chunks[i] }, finish_reason: null }] };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          events.push(`chunk:${i}`);
          if (out.delayMs) await new Promise((r) => setTimeout(r, out.delayMs));
        }
        if (!closed) {
          res.write('data: [DONE]\n\n');
          res.end();
          events.push('stream_done');
        }
        return;
      }
      const message = out.message || { role: 'assistant', content: out.text ?? '' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'mock', object: 'chat.completion', created: 0, model: body.model,
        choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    events,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }),
  };
}

/** 等到 predicate 为真或超时 */
export async function waitFor(predicate, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}
