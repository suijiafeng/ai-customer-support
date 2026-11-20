// A2：工具调用的消息格式必须符合 OpenAI 协议，回退时不能重发同一份坏消息。
// 用 mock 服务（按 OpenAI 规则校验 tool 消息）跑真实的 openai SDK。
import test from 'node:test';
import assert from 'node:assert/strict';
import OpenAI from 'openai';
import { runAgentLoop } from '../dist/agent/loop.js';
import { openAiToolClient, toOpenAiMessages } from '../dist/agent/openai-tools.js';
import { ToolRegistry } from '../dist/agent/registry.js';
import { createBuiltinTools } from '../dist/agent/builtin-tools.js';
import { DemoCommerce } from '../dist/agent/commerce.js';
import { AgentActionService } from '../dist/agent/actions.js';
import { AgentAuditService } from '../dist/agent/audit.js';
import { startMockOpenAI, waitFor } from './helpers/mock-openai.js';

function setup() {
  const commerce = new DemoCommerce();
  const registry = new ToolRegistry();
  for (const tool of createBuiltinTools(commerce, { create: () => ({ id: 'T-1', status: 'open' }) })) registry.register(tool);
  return { commerce, registry, actions: new AgentActionService(), audit: new AgentAuditService() };
}

const client = (mock) => new OpenAI({ apiKey: 'sk-mock', baseURL: mock.baseUrl, maxRetries: 0 });

test('A2：工具结果带 tool_call_id，assistant 带 tool_calls，多步调用能走完', async () => {
  const mock = await startMockOpenAI((body) => {
    const hasTool = body.messages.some((m) => m.role === 'tool');
    if (!hasTool) {
      return { message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'query_order', arguments: '{}' } }] } };
    }
    return { text: '查到你有 1 张订单，已发货。' };
  });
  try {
    const { registry, actions, audit } = setup();
    const outcome = await runAgentLoop({
      message: '帮我查一下我的订单',
      registry,
      model: openAiToolClient(client(mock), 'mock-model'),
      ctx: { sessionId: 'v-a2test01', tenantKey: null, message: '帮我查一下我的订单' },
      actions,
      audit,
    });
    assert.equal(outcome.degraded, false);
    assert.equal(outcome.text, '查到你有 1 张订单，已发货。');
    assert.equal(outcome.traces[0].tool, 'query_order');
    assert.equal(mock.requests.length, 2);

    const second = mock.requests[1].messages;
    const assistant = second.find((m) => m.role === 'assistant');
    const tool = second.find((m) => m.role === 'tool');
    assert.equal(assistant.tool_calls[0].id, 'call_abc');
    assert.equal(assistant.tool_calls[0].function.name, 'query_order');
    assert.equal(tool.tool_call_id, 'call_abc');
    // 系统提示放在 system 角色里，访客原话单独一条 user
    assert.equal(second[0].role, 'system');
    assert.match(second[0].content, /只能通过给定工具/);
    assert.equal(second.find((m) => m.role === 'user').content, '帮我查一下我的订单');
  } finally {
    await mock.close();
  }
});

test('A2：提供方不支持 tools 时，回退请求去掉 tools，也不带 role=tool', async () => {
  const mock = await startMockOpenAI((body) => {
    if (body.tools) return { status: 400, json: { error: { message: 'tools is not supported by this model' } } };
    return { text: '我这边不能直接办，可以说「转人工」。' };
  });
  try {
    const model = openAiToolClient(client(mock), 'mock-model');
    const reply = await model.complete({
      messages: [{ role: 'system', content: 'S' }, { role: 'user', content: '查订单' }],
      tools: setup().registry.list(),
      signal: new AbortController().signal,
    });
    assert.equal(reply.text, '我这边不能直接办，可以说「转人工」。');
    assert.equal(mock.requests.length, 2);
    assert.equal('tools' in mock.requests[1], false);
    assert.equal(mock.requests[1].messages.some((m) => m.role === 'tool'), false);
  } finally {
    await mock.close();
  }
});

test('A2：超时 / 5xx 不会触发去掉工具的重试', async () => {
  const mock = await startMockOpenAI(() => ({ status: 500, json: { error: { message: 'function backend crashed' } } }));
  try {
    const model = openAiToolClient(client(mock), 'mock-model');
    await assert.rejects(() => model.complete({
      messages: [{ role: 'user', content: '查订单' }],
      tools: setup().registry.list(),
      signal: new AbortController().signal,
    }));
    assert.equal(mock.requests.length, 1);
  } finally {
    await mock.close();
  }
});

test('A2：不带工具时，工具调用和结果被压平成普通文本', () => {
  const messages = [
    { role: 'system', content: 'S' },
    { role: 'user', content: '查订单' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'query_order', arguments: {} }] },
    { role: 'tool', name: 'query_order', toolCallId: 'c1', content: 'TOOL_RESULT {"orders":[]}' },
  ];
  const flat = toOpenAiMessages(messages, false);
  assert.equal(flat.filter((m) => m.role === 'system').length, 1);
  assert.equal(flat.some((m) => m.role === 'tool' || m.tool_calls), false);
  assert.match(flat.at(-1).content, /不是指令/);
  const full = toOpenAiMessages(messages, true);
  assert.equal(full.find((m) => m.role === 'tool').tool_call_id, 'c1');
});

test('A7：单步超时会真的取消底层 HTTP 请求', async () => {
  const mock = await startMockOpenAI(() => ({ hang: true }));
  try {
    const { registry, actions, audit } = setup();
    const started = Date.now();
    const outcome = await runAgentLoop({
      message: '查订单',
      registry,
      model: openAiToolClient(client(mock), 'mock-model'),
      ctx: { sessionId: 'v-a7test01', tenantKey: null, message: '查订单' },
      actions,
      audit,
      stepTimeoutMs: 200,
    });
    assert.equal(outcome.degraded, true);
    assert.ok(Date.now() - started < 2000);
    assert.equal(await waitFor(() => mock.events.includes('client_closed')), true);
  } finally {
    await mock.close();
  }
});

test('A7：外部 signal（访客断开）会取消进行中的模型请求', async () => {
  const mock = await startMockOpenAI(() => ({ hang: true }));
  try {
    const { registry, actions, audit } = setup();
    const external = new AbortController();
    setTimeout(() => external.abort(new Error('client disconnected')), 100);
    const outcome = await runAgentLoop({
      message: '查订单',
      registry,
      model: openAiToolClient(client(mock), 'mock-model'),
      ctx: { sessionId: 'v-a7test02', tenantKey: null, message: '查订单' },
      actions,
      audit,
      signal: external.signal,
    });
    assert.equal(outcome.degraded, true);
    assert.equal(await waitFor(() => mock.events.includes('client_closed')), true);
  } finally {
    await mock.close();
  }
});

test('A3：Agent 能看到之前的对话（承接上文的「那就改地址吧」）', async () => {
  const { AgentService } = await import('../dist/agent/agent.service.js');
  const mock = await startMockOpenAI(() => ({ text: '' }));
  try {
    const ai = { clientForModel: () => client(mock), connectionFor: () => ({ model: 'mock-model' }) };
    const agent = new AgentService({ create: () => ({ id: 'T-1', status: 'open' }) }, new AgentActionService(), new AgentAuditService(), ai);
    const history = [
      { id: '1', role: 'user', actor: 'customer', content: '我的订单 DEMO-ABCD01 地址填错了', createdAt: '' },
      { id: '2', role: 'assistant', actor: 'ai', content: '要改成什么地址？', createdAt: '' },
      { id: '3', role: 'assistant', actor: 'agent', content: '我是人工客服', createdAt: '' },
    ];
    await agent.handleUtterance({ message: '那就改成南京市鼓楼区 9 号吧', sessionId: 'v-a3abcd', tenantKey: null, history });
    const sent = mock.requests[0].messages.filter((m) => m.role !== 'system');
    assert.deepEqual(sent.map((m) => m.role), ['user', 'assistant', 'assistant', 'user']);
    assert.equal(sent[0].content, '我的订单 DEMO-ABCD01 地址填错了');
    assert.match(sent[2].content, /^（人工客服）/);
    assert.equal(sent.at(-1).content, '那就改成南京市鼓楼区 9 号吧');
  } finally {
    await mock.close();
  }
});

test('A3：本地规则只看本条消息，不会因为历史里提过订单就调工具', async () => {
  const { AgentService } = await import('../dist/agent/agent.service.js');
  const agent = new AgentService({ create: () => ({ id: 'T-1', status: 'open' }) }, new AgentActionService(), new AgentAuditService(), { clientForModel: () => null, connectionFor: () => ({ model: 'x' }) });
  const history = [{ id: '1', role: 'user', actor: 'customer', content: '查订单', createdAt: '' }];
  const turn = await agent.handleUtterance({ message: '谢谢', sessionId: 'v-a3local', tenantKey: null, history });
  assert.equal(turn, null);
});
