// 角色审查 #3 #4（及 #7）：会话绑定租户，换别的租户 siteKey 续写/确认操作/读取一律 403，
// 会话租户不会被消息改写；改密码后旧令牌和旧 SSE 票据立即失效。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { openSse } from './helpers/sse.js';

const server = await startServer();
const stamp = Date.now().toString(36);
const admin = () => ({ authorization: `Bearer ${server.agentToken}` });
const bearer = (token) => ({ authorization: `Bearer ${token}` });

test.after(() => server.stop());

let tenantB;
test('准备：再建一个租户 B', async () => {
  const created = await server.request('POST', '/api/widget-keys', { key: `tb-${stamp}`, name: '租户B' }, admin());
  assert.equal(created.status, 201);
  tenantB = created.data.key;
});

test('#3 用租户 B 的 siteKey 续写租户 A 的会话：403，会话租户不变', async () => {
  const sid = `v-${stamp}-tenant`;
  const first = await server.chat(sid, '你好');
  const vt = first.data.visitorToken;
  const cross = await server.request(
    'POST', '/api/chat',
    { sessionId: sid, message: '换个租户', siteKey: tenantB.key, tenantId: tenantB.id },
    { 'x-visitor-token': vt }
  );
  assert.equal(cross.status, 403);
  assert.equal(cross.body.msg || cross.body.error, 'session_tenant_mismatch');

  const stream = await fetch(`${server.base}/api/chat/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-visitor-token': vt },
    body: JSON.stringify({ sessionId: sid, message: '换个租户', siteKey: tenantB.key, tenantId: tenantB.id }),
  });
  assert.equal(stream.status, 403);
  await stream.text();

  const action = await server.request(
    'POST', '/api/chat/agent-action',
    { sessionId: sid, actionId: 'x', decision: 'confirm', siteKey: tenantB.key, tenantId: tenantB.id },
    { 'x-visitor-token': vt }
  );
  assert.equal(action.status, 403);

  const read = await server.request('GET', `/api/sessions/${sid}?siteKey=${tenantB.key}`, undefined, { 'x-visitor-token': vt });
  assert.equal(read.status, 403);
  const es = await openSse(`${server.base}/api/sessions/${sid}/events?vt=${encodeURIComponent(vt)}&siteKey=${tenantB.key}`);
  assert.equal(es.status, 403);

  const detail = await server.detail(sid);
  assert.equal(detail.data.session.tenantKey, server.siteKey, '会话仍属于租户 A');
  assert.equal(detail.data.messages.some((m) => m.content === '换个租户'), false);

  // 用自己租户的 siteKey 照常可以续写
  const same = await server.chat(sid, '还是原来的租户', {}, { 'x-visitor-token': vt });
  assert.equal(same.status, 201);
});

test('#3 原租户停用后，不能借另一个租户的 siteKey 继续使用该会话', async () => {
  const sid = `v-${stamp}-disabled`;
  const ownKey = `ta-${stamp}`;
  const own = (await server.request('POST', '/api/widget-keys', { key: ownKey, name: '租户A2' }, admin())).data.key;
  const first = await server.request('POST', '/api/chat', { sessionId: sid, message: '你好', siteKey: own.key, tenantId: own.id });
  const vt = first.data.visitorToken;
  await server.request('PATCH', `/api/widget-keys/${own.key}`, { active: false }, admin());
  const viaB = await server.request(
    'POST', '/api/chat',
    { sessionId: sid, message: '绕过停用', siteKey: tenantB.key, tenantId: tenantB.id },
    { 'x-visitor-token': vt }
  );
  assert.equal(viaB.status, 403);
  assert.equal((await server.detail(sid)).data.session.tenantKey, own.key);
});

test('#7 会话优先级与跟进事项同一规则：普通转人工是 normal，明确催促才是 high', async () => {
  const plain = await server.chat(`v-${stamp}-p1`, '转人工');
  const urgent = await server.chat(`v-${stamp}-p2`, '紧急！请尽快转人工');
  const d1 = await server.detail(`v-${stamp}-p1`);
  const d2 = await server.detail(`v-${stamp}-p2`);
  assert.equal(d1.data.session.priority, 'normal');
  assert.equal(d1.data.session.workflow.ticket.priority, 'normal');
  assert.equal(d2.data.session.priority, 'high');
  assert.equal(d2.data.session.workflow.ticket.priority, 'high');
  assert.ok(plain.data.ticket && urgent.data.ticket);
});

test('#4 管理员重置密码后，旧登录令牌、旧 SSE 票据立即失效，新密码可登录', async () => {
  const id = `p${stamp}`;
  await server.request('POST', '/api/admin/users', { id, name: '改密测试', password: 'oldpass1', role: 'agent' }, admin());
  const oldToken = (await server.request('POST', '/api/auth/login', { agentNo: id, password: 'oldpass1' })).data.token;
  const oldTicket = (await server.request('POST', '/api/auth/sse-ticket', undefined, bearer(oldToken))).data.ticket;
  assert.ok(oldTicket);
  const es = await openSse(`${server.base}/api/sessions/events?ticket=${encodeURIComponent(oldTicket)}`);
  assert.equal(es.status, 200);

  const reset = await server.request('PATCH', `/api/admin/users/${id}`, { password: 'newpass1' }, admin());
  assert.equal(reset.status, 200);
  assert.equal('token' in reset.data, false, '改别人的密码不发令牌');

  assert.ok(await es.waitFor((evs) => evs.some((e) => e.type === 'revoked')), '已打开的 SSE 被踢下线');
  assert.equal((await server.request('GET', '/api/sessions', undefined, bearer(oldToken))).status, 401);
  assert.equal((await server.request('POST', '/api/auth/sse-ticket', undefined, bearer(oldToken))).status, 401);
  const reuse = await openSse(`${server.base}/api/sessions/events?ticket=${encodeURIComponent(oldTicket)}`);
  assert.equal(reuse.status, 401, '改密前签发的 SSE 票据也作废');

  const fresh = await server.request('POST', '/api/auth/login', { agentNo: id, password: 'newpass1' });
  assert.equal(fresh.status, 201);
  assert.equal((await server.request('GET', '/api/sessions', undefined, bearer(fresh.data.token))).status, 200);
});

test('#4 改自己的密码：旧令牌失效，响应里带一枚新令牌可继续使用', async () => {
  const oldToken = server.agentToken;
  const res = await server.request('PATCH', '/api/admin/users/9527', { password: '654321' }, admin());
  assert.equal(res.status, 200);
  assert.ok(res.data.token);
  assert.equal((await server.request('GET', '/api/sessions', undefined, bearer(oldToken))).status, 401);
  assert.equal((await server.request('GET', '/api/auth/me', undefined, bearer(res.data.token))).status, 200);
});
