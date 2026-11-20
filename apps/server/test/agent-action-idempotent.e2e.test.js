// 待确认操作卡片：连点「确认」/ 重放请求时幂等，不在聊天记录里多追加消息，也不执行两遍。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';
import { startServer } from './helpers/server.js';

const mock = await startMockOpenAI((body) => {
  if (!body.tools) return { text: 'PERSONA_REPLY' };
  const toolMsgs = body.messages.filter((m) => m.role === 'tool');
  const orderId = toolMsgs.map((m) => m.content).join(' ').match(/DEMO-[A-Z0-9]+/)?.[0];
  if (!toolMsgs.length) {
    return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_q', type: 'function', function: { name: 'query_order', arguments: '{}' } }] } };
  }
  if (toolMsgs.length === 1 && orderId) {
    return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_a', type: 'function', function: { name: 'change_address', arguments: JSON.stringify({ orderId, address: '北京市朝阳区测试路 1 号' }) } }] } };
  }
  return { text: '已处理' };
});
const server = await startServer({ AI_ENABLED: 'true', AI_BASE_URL: mock.baseUrl, AI_MODEL: 'mock-model', AI_API_KEY: 'sk-mock' });

test.after(async () => {
  await server.stop();
  await mock.close();
});

async function pendingAction(sessionId) {
  const res = await server.chat(sessionId, '我要改地址');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const card = res.data.messages.find((m) => m.agentAction?.status === 'pending');
  assert.ok(card, `应出现待确认卡片：${JSON.stringify(res.data.messages.map((m) => m.content))}`);
  return { actionId: card.agentAction.id, token: res.data.visitorToken };
}

const decide = (sessionId, actionId, decision, token) =>
  server.request(
    'POST',
    '/api/chat/agent-action',
    { sessionId, actionId, decision, siteKey: server.siteKey, tenantId: server.tenantId },
    { 'x-visitor-token': token },
  );

test('同一张卡片确认两次：第二次幂等返回，不追加「已经处理过了」', async () => {
  const sessionId = `v-action-${Date.now()}`;
  const { actionId, token } = await pendingAction(sessionId);
  const first = await decide(sessionId, actionId, 'confirm', token);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const afterFirst = first.data.messages.length;

  const second = await decide(sessionId, actionId, 'confirm', token);
  assert.equal(second.status, 201);
  assert.equal(second.data.alreadyHandled, true);
  assert.equal(second.data.messages.length, afterFirst, '重复确认不应追加消息');
  assert.ok(!second.data.messages.some((m) => /已经处理过/.test(m.content || '')));
  const card = second.data.messages.find((m) => m.agentAction?.id === actionId);
  assert.notEqual(card.agentAction.status, 'pending');
});

test('并发连点两次确认：只执行一次、只多一条结果消息', async () => {
  const sessionId = `v-action-dbl-${Date.now()}`;
  const { actionId, token } = await pendingAction(sessionId);
  const before = (await server.detail(sessionId)).data.messages.length;
  const [a, b] = await Promise.all([decide(sessionId, actionId, 'confirm', token), decide(sessionId, actionId, 'confirm', token)]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal([a, b].filter((r) => r.data.alreadyHandled).length, 1);
  const after = (await server.detail(sessionId)).data.messages;
  assert.equal(after.length, before + 1, JSON.stringify(after.map((m) => m.content)));
  assert.ok(!after.some((m) => /已经处理过/.test(m.content || '')));
});
