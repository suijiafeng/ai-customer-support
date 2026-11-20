// A5 / A6：同一会话的并发写入。
// A5：第一条回复还在生成时又来一条消息（或客服插话），旧代码用请求开始时的历史快照覆盖写回，后来的消息丢失。
// A6：第一条消息的回复生成完之前，会话「看起来还没历史」，不带访客令牌的请求能混进来。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';
import { startServer } from './helpers/server.js';

const mock = await startMockOpenAI((body) => {
  if (body.tools) return { text: '' }; // Agent 不接手
  if (body.stream) return { stream: Array.from({ length: 8 }, (_, i) => `慢${i}`), delayMs: 100 };
  return { text: '快速回复' };
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function streamChat(sessionId, message, headers = {}) {
  return fetch(`${server.base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ sessionId, message, siteKey: server.siteKey, tenantId: server.tenantId }),
  }).then(async (res) => ({ status: res.status, text: await res.text() }));
}

test('A5：回复生成期间同一会话又来一条消息，两条都保留且按顺序', async () => {
  const sessionId = `v-conc-a-${Date.now()}`;
  const first = await server.chat(sessionId, '你好，我想咨询一下');
  const token = first.data.visitorToken;
  assert.ok(token);

  const slow = streamChat(sessionId, '消息A：你们的报价是多少？', { 'x-visitor-token': token });
  await sleep(250);
  const fast = await server.chat(sessionId, '消息B：你们几点上班', {}, { 'x-visitor-token': token });
  const slowRes = await slow;
  assert.equal(slowRes.status, 200);
  assert.equal(fast.status, 201);

  const { data } = await server.detail(sessionId);
  const users = data.messages.filter((m) => m.role === 'user').map((m) => m.content);
  assert.deepEqual(users, ['你好，我想咨询一下', '消息A：你们的报价是多少？', '消息B：你们几点上班']);
  // 每条访客消息后面紧跟自己的回复
  const idxA = data.messages.findIndex((m) => m.content.startsWith('消息A'));
  const idxB = data.messages.findIndex((m) => m.content.startsWith('消息B'));
  assert.match(data.messages[idxA + 1].content, /^慢0慢1/);
  assert.equal(data.messages[idxB + 1].role, 'assistant');
  assert.ok(idxB > idxA + 1);
});

test('A5：AI 生成期间客服插话，客服消息不会被覆盖', async () => {
  const sessionId = `v-conc-b-${Date.now()}`;
  const slow = streamChat(sessionId, '你们的报价是多少？');
  await sleep(300);
  const posted = await server.request('POST', `/api/sessions/${sessionId}/messages`, { content: '我是人工客服，我来跟进' }, { authorization: `Bearer ${server.agentToken}` });
  assert.equal(posted.status, 201);
  await slow;
  const { data } = await server.detail(sessionId);
  const contents = data.messages.map((m) => m.content);
  assert.ok(contents.includes('我是人工客服，我来跟进'), JSON.stringify(contents));
  assert.ok(contents.some((c) => c.startsWith('慢0')));
  assert.equal(contents[0], '你们的报价是多少？');
});

test('A6：第一条回复生成期间，不带访客令牌的请求被拒', async () => {
  const sessionId = `v-conc-c-${Date.now()}`;
  const slow = streamChat(sessionId, '你们的报价是多少？');
  await sleep(250);
  const intruder = await server.chat(sessionId, '我是来插话的');
  assert.equal(intruder.status, 403);
  assert.equal((await slow).status, 200);
  const { data } = await server.detail(sessionId);
  assert.equal(data.messages.some((m) => m.content === '我是来插话的'), false);
  assert.equal(data.messages.length, 2);
});
