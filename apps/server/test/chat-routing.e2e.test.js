// A1：消息路由。起真实服务 + mock 模型，验证：
// - 「转人工」一定由规则处理（建跟进事项、进入待接入），不经过 Agent；
// - Agent 只在真的调用了工具时接手，模型只回文字就交回 FAQ + 人设流程；
// - Agent 第一步失败时也交回普通流程，而不是回一句「没能办完」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startMockOpenAI } from './helpers/mock-openai.js';
import { startServer } from './helpers/server.js';

const lastUser = (body) => [...body.messages].reverse().find((m) => m.role === 'user')?.content || '';

const mock = await startMockOpenAI((body) => {
  const user = lastUser(body);
  if (body.tools) {
    if (user.includes('故障测试')) return { status: 400, json: { error: { message: 'bad request' } } };
    if (body.messages.some((m) => m.role === 'tool')) return { text: '工具结果回答' };
    if (user.includes('订单')) {
      return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'query_order', arguments: '{}' } }] } };
    }
    return { text: 'AGENT_TEXT_SHOULD_NOT_BE_USED' };
  }
  return { text: 'PERSONA_REPLY' };
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

test('A1：「转人工」不经过 Agent，一定建跟进事项并进入待接入', async () => {
  const before = mock.requests.length;
  const res = await server.chat(`v-route-h-${Date.now()}`, '转人工');
  assert.equal(res.status, 201);
  assert.equal(res.data.needHuman, true);
  assert.ok(res.data.ticket?.id, '应建跟进事项');
  assert.equal(res.data.session.status, 'waiting_human');
  const sent = mock.requests.slice(before);
  assert.equal(sent.some((b) => b.tools), false, '转人工不应请求 Agent');
});

test('A1：模型没调工具只回了文字，交回 FAQ + 人设流程', async () => {
  const res = await server.chat(`v-route-f-${Date.now()}`, '你们的报价是多少？');
  assert.equal(res.status, 201);
  assert.equal(res.data.reply, 'PERSONA_REPLY');
  assert.notEqual(res.data.intent, 'agent_tool');
  assert.ok(res.data.sources.length > 0, '应带 FAQ 来源');
  assert.equal(res.data.ai.used, true);
});

test('A1：模型调用了工具，由 Agent 接手', async () => {
  const sid = `v-route-t-${Date.now()}`;
  const res = await server.chat(sid, '帮我查一下我的订单');
  assert.equal(res.status, 201);
  assert.equal(res.data.reply, '工具结果回答');
  assert.equal(res.data.intent, 'agent_tool');
  // 工具调用轨迹只给客服看，访客响应里不带
  assert.equal(res.data.messages.at(-1).agentTrace, undefined);
  const detail = await server.detail(sid);
  assert.equal(detail.data.messages.at(-1).agentTrace[0].tool, 'query_order');
});

test('A1：Agent 第一步失败，交回普通流程而不是「没能办完」', async () => {
  const res = await server.chat(`v-route-e-${Date.now()}`, '故障测试：你们做小程序吗');
  assert.equal(res.status, 201);
  assert.equal(res.data.reply, 'PERSONA_REPLY');
  assert.doesNotMatch(res.data.reply, /没能办完/);
});
