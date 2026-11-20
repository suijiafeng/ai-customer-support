// 角色审查 #2 #5：会话被别的客服认领后，原来打开着的会话 SSE 不能再收到内容；
// 访客读取（GET / SSE / 对话响应）只下发白名单字段。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { openSse } from './helpers/sse.js';

const server = await startServer();
const stamp = Date.now().toString(36);
const bearer = (token) => ({ authorization: `Bearer ${token}` });
const login = async (no) => (await server.request('POST', '/api/auth/login', { agentNo: no, password: '123456' })).data.token;
const a28 = await login('9528');
const a29 = await login('9529');

test.after(() => server.stop());

test('#2 会话被 9528 认领后，9529 打开着的会话 SSE 收到 revoked 并断开，拿不到后续内容', async () => {
  const sid = `v-${stamp}-claim`;
  await server.chat(sid, '转人工');
  const ticket = (await server.request('POST', '/api/auth/sse-ticket', undefined, bearer(a29))).data.ticket;
  const es = await openSse(`${server.base}/api/sessions/${sid}/events?ticket=${encodeURIComponent(ticket)}`);
  assert.equal(es.status, 200, '未认领时 9529 可以查看');
  assert.ok(await es.waitFor((evs) => evs.some((e) => e.type === 'session')));

  const claim = await server.request('POST', `/api/sessions/${sid}/messages`, { content: '我是9528-机密回复' }, bearer(a28));
  assert.equal(claim.status, 201);
  assert.ok(await es.waitFor((evs) => evs.some((e) => e.type === 'revoked')), '应收到 revoked');
  const revoked = es.events().find((e) => e.type === 'revoked');
  assert.equal(revoked.data.reason, 'session_reassigned');
  assert.equal(revoked.data.assignedAgentId, '9528');
  assert.equal(await es.waitEnd(), true, '服务端应断开');
  assert.equal(es.text.includes('我是9528-机密回复'), false, '认领那条回复也不应推给 9529');

  // 重连也进不来：在建流前直接 403
  const again = (await server.request('POST', '/api/auth/sse-ticket', undefined, bearer(a29))).data.ticket;
  const retry = await openSse(`${server.base}/api/sessions/${sid}/events?ticket=${encodeURIComponent(again)}`);
  assert.equal(retry.status, 403);
});

const FORBIDDEN_SESSION_KEYS = ['sentiment', 'priority', 'lastIntent', 'assignedAgentId', 'workflow', 'ticketId', 'reason', 'inquiryId', 'tenantKey', 'profile', 'lastMessage'];

function assertVisitorSafe(payload, label) {
  const { session, messages } = payload;
  assert.ok(session, `${label}: 应有 session`);
  for (const key of FORBIDDEN_SESSION_KEYS) assert.equal(key in session, false, `${label}: session 不应含 ${key}`);
  assert.deepEqual(Object.keys(session).sort(), ['assignedAgentName', 'createdAt', 'needHuman', 'sessionId', 'status', 'updatedAt', 'visitor']);
  assert.deepEqual(Object.keys(session.visitor || {}).sort(), session.visitor ? ['code', 'createdAt'] : []);
  for (const m of messages) {
    assert.equal('agentId' in m, false, `${label}: 消息不应含 agentId`);
    assert.equal('agentTrace' in m, false, `${label}: 消息不应含 agentTrace`);
    assert.equal('agentRole' in m, false, `${label}: 消息不应含 agentRole`);
  }
}

test('#5 访客读取自己的会话：GET / SSE / 对话响应都只有白名单字段，挂件需要的字段都在', async () => {
  const sid = `v-${stamp}-dto`;
  const first = await server.chat(sid, '紧急！转人工');
  assert.equal(first.status, 201);
  const vt = first.data.visitorToken;
  // 对话响应：没有情绪、原因、模型厂商型号、检索分数，跟进事项只有编号和状态
  assert.equal('sentiment' in first.data, false);
  assert.equal('reason' in first.data, false);
  assert.deepEqual(Object.keys(first.data.ticket).sort(), ['id', 'status']);
  if (first.data.ai) assert.deepEqual(Object.keys(first.data.ai).sort(), ['fallback', 'used']);
  for (const s of first.data.sources || []) assert.equal('score' in s, false);
  assertVisitorSafe(first.data, 'chat');
  assert.equal(first.data.session.status, 'waiting_human');
  assert.equal(first.data.needHuman, true);

  await server.request('POST', `/api/sessions/${sid}/messages`, { content: '您好，我来处理' }, bearer(a28));

  const got = await server.request('GET', `/api/sessions/${sid}`, undefined, { 'x-visitor-token': vt });
  assert.equal(got.status, 200);
  assertVisitorSafe(got.data, 'GET');
  assert.equal(got.data.session.status, 'assigned');
  assert.equal(got.data.session.assignedAgentName, '客服9528', '挂件只拿到客服显示名');
  const agentMsg = got.data.messages.find((m) => m.actor === 'agent');
  assert.equal(agentMsg.agentName, '客服9528');
  assert.ok(agentMsg.id && agentMsg.createdAt && agentMsg.role && Array.isArray(agentMsg.attachments));

  const es = await openSse(`${server.base}/api/sessions/${sid}/events?vt=${encodeURIComponent(vt)}`);
  assert.equal(es.status, 200);
  assert.ok(await es.waitFor((evs) => evs.some((e) => e.type === 'session')));
  assertVisitorSafe(es.events().find((e) => e.type === 'session').data, 'SSE initial');
  await server.request('POST', `/api/sessions/${sid}/messages`, { content: '第二条' }, bearer(a28));
  assert.ok(await es.waitFor((evs) => evs.filter((e) => e.type === 'session').length >= 2));
  assertVisitorSafe(es.events().filter((e) => e.type === 'session').at(-1).data, 'SSE update');
  es.close();

  // 客服侧不受影响：仍能拿到完整字段
  const agentView = await server.request('GET', `/api/sessions/${sid}`, undefined, bearer(a28));
  assert.equal(agentView.data.session.assignedAgentId, '9528');
  assert.ok(agentView.data.session.workflow);
  assert.equal(agentView.data.messages.find((m) => m.actor === 'agent').agentRole, 'agent');
});
