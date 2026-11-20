// A4：访客断开流式连接后，服务端必须立即取消上游模型请求。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI, waitFor } from './helpers/mock-openai.js';
import { startServer } from './helpers/server.js';

const chunks = Array.from({ length: 30 }, (_, i) => `片段${i} `);
const mock = await startMockOpenAI((body) => {
  if (body.tools) return { text: '' }; // Agent 不接手
  return { stream: chunks, delayMs: 100 };
});
const server = await startServer({
  AI_ENABLED: 'true',
  AI_BASE_URL: mock.baseUrl,
  AI_MODEL: 'mock-model',
  AI_API_KEY: 'sk-mock',
});

test.after(async () => {
  await server.stop();
  await mock.close();
});

test('A4：访客中途断开，上游流被取消，已输出的部分保留在会话里', async () => {
  const sessionId = `v-abort-${Date.now()}`;
  const ac = new AbortController();
  const res = await fetch(`${server.base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, message: '你们的报价是多少？', siteKey: server.siteKey, tenantId: server.tenantId }),
    signal: ac.signal,
  });
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  let got = '';
  try {
    while (!got.includes('片段2')) {
      const { value, done } = await reader.read();
      if (done) break;
      got += Buffer.from(value).toString();
    }
  } finally {
    ac.abort();
  }
  assert.match(got, /event: delta/);

  assert.equal(await waitFor(() => mock.events.includes('client_closed'), 3000), true, '上游连接应被关闭');
  assert.equal(mock.events.includes('stream_done'), false, '上游不应把 30 段全部生成完');
  const sentChunks = mock.events.filter((e) => e.startsWith('chunk:')).length;
  assert.ok(sentChunks < chunks.length, `只应生成一部分，实际 ${sentChunks}`);

  // 已经推给访客的部分保留下来，客服在工作台能看到断开原因
  let detail;
  for (let i = 0; i < 20; i += 1) {
    detail = await server.detail(sessionId);
    if (detail.data?.messages?.length === 2) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const [user, assistant] = detail.data.messages;
  assert.equal(user.content, '你们的报价是多少？');
  assert.match(assistant.content, /^片段0 片段1/);
  assert.equal(detail.data.session.workflow.ai.error, 'client disconnected');
});
