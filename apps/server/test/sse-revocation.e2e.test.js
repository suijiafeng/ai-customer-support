// 角色审查 #1 #8 #9：SSE 长连接在账号停用 / 删除 / 降级后不能继续推送；
// 身份以服务端当前账号为准（GET /api/auth/me）；未授权的 SSE 在写响应头之前就返回 401/403。
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers/server.js';
import { openSse } from './helpers/sse.js';

const server = await startServer();
const admin = { authorization: `Bearer ${server.agentToken}` };
const stamp = Date.now().toString(36);

test.after(() => server.stop());

const bearer = (token) => ({ authorization: `Bearer ${token}` });
async function createAndLogin(id, role) {
  const created = await server.request('POST', '/api/admin/users', { id, name: `测试${id}`, password: 'abcdef12', role }, admin);
  assert.equal(created.status, 201);
  const login = await server.request('POST', '/api/auth/login', { agentNo: id, password: 'abcdef12' });
  assert.equal(login.status, 201);
  return login.data.token;
}
async function ticketFor(token) {
  const res = await server.request('POST', '/api/auth/sse-ticket', undefined, bearer(token));
  assert.equal(res.status, 201);
  return res.data.ticket;
}
const queueUrl = (ticket) => `${server.base}/api/sessions/events?ticket=${encodeURIComponent(ticket)}`;

const u100 = `u${stamp}a`;
const a200 = `a${stamp}b`;
const u300 = `u${stamp}c`;
let u100Token;
let a200Token;
let u300Token;

test('准备：建两个账号并登录', async () => {
  u100Token = await createAndLogin(u100, 'agent');
  a200Token = await createAndLogin(a200, 'admin');
  u300Token = await createAndLogin(u300, 'agent');
});

test('#1 停用账号：已打开的队列 SSE 立即收到 revoked 并被服务端关闭', async () => {
  const es = await openSse(queueUrl(await ticketFor(u100Token)));
  assert.equal(es.status, 200);
  assert.ok(await es.waitFor((evs) => evs.some((e) => e.type === 'sessions')), '先收到初始快照');
  const off = await server.request('PATCH', `/api/admin/users/${u100}`, { active: false }, admin);
  assert.equal(off.status, 200);
  assert.ok(await es.waitFor((evs) => evs.some((e) => e.type === 'revoked')), '应收到 revoked');
  assert.equal(es.events().find((e) => e.type === 'revoked').data.reason, 'account_changed');
  assert.equal(await es.waitEnd(), true, '服务端应主动断开');
  // 之后的会话更新不会再推给他
  const before = es.text.length;
  await server.chat(`v-${stamp}-off`, '转人工');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(es.text.length, before);
});

test('#1 删除账号：已打开的队列 SSE 收到 revoked 并断开', async () => {
  const es = await openSse(queueUrl(await ticketFor(u300Token)));
  assert.ok(await es.waitFor((evs) => evs.some((e) => e.type === 'sessions')));
  const del = await server.request('DELETE', `/api/admin/users/${u300}`, undefined, admin);
  assert.equal(del.status, 200);
  assert.ok(await es.waitFor((evs) => evs.some((e) => e.type === 'revoked')));
  assert.equal(await es.waitEnd(), true);
});

test('#1 #8 降级管理员：SSE 推 role 事件，之后只按普通客服权限推送；/api/auth/me 返回新角色', async () => {
  // 9527 先认领一个会话：这是普通客服看不到的「别人名下」的会话
  const sid = `v-${stamp}-owned`;
  await server.chat(sid, '转人工');
  const claim = await server.request('POST', `/api/sessions/${sid}/messages`, { content: '管理员已接入' }, admin);
  assert.equal(claim.status, 201);

  const es = await openSse(queueUrl(await ticketFor(a200Token)));
  assert.ok(
    await es.waitFor((evs) => evs.some((e) => e.type === 'sessions' && e.data.sessions.some((s) => s.sessionId === sid))),
    '降级前作为管理员能看到 9527 名下的会话'
  );
  const demote = await server.request('PATCH', `/api/admin/users/${a200}`, { role: 'agent' }, admin);
  assert.equal(demote.status, 200);
  assert.ok(await es.waitFor((evs) => evs.some((e) => e.type === 'role' && e.data.role === 'agent')), '应收到 role 事件');
  const afterRole = es.events().slice(es.events().findIndex((e) => e.type === 'role'));
  const snapshot = afterRole.find((e) => e.type === 'sessions');
  assert.ok(snapshot, '降级后立即按新权限补发一次快照');
  assert.equal(snapshot.data.sessions.some((s) => s.sessionId === sid), false);

  // 之后该会话有新消息，降级后的连接收不到
  const mark = es.text.length;
  await server.request('POST', `/api/sessions/${sid}/messages`, { content: '只给有权限的人看' }, admin);
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(es.text.slice(mark).includes(sid), false, '别人名下的会话不应再出现在推送里');
  es.close();

  const me = await server.request('GET', '/api/auth/me', undefined, bearer(a200Token));
  assert.equal(me.status, 200);
  assert.equal(me.data.agent.role, 'agent');
  const adminApi = await server.request('GET', '/api/admin/users', undefined, bearer(a200Token));
  assert.equal(adminApi.status, 403);
});

test('#9 未授权的会话 SSE 在建流前返回 401/403（不是 200 + error 事件）', async () => {
  const sid = `v-${stamp}-sse`;
  const first = await server.chat(sid, '转人工');
  const other = await server.chat(`v-${stamp}-other`, '你好');
  const url = `${server.base}/api/sessions/${sid}/events`;

  const none = await openSse(url);
  assert.equal(none.status, 403);
  assert.match(none.contentType, /application\/json/);

  const wrongVisitor = await openSse(`${url}?vt=${encodeURIComponent(other.data.visitorToken)}`);
  assert.equal(wrongVisitor.status, 403);

  const badTicket = await openSse(`${url}?ticket=not-a-ticket`);
  assert.equal(badTicket.status, 401);
  assert.match(badTicket.contentType, /application\/json/);

  const disabledTicket = await openSse(`${server.base}/api/sessions/events?ticket=garbage`);
  assert.equal(disabledTicket.status, 401);

  const ok = await openSse(`${url}?vt=${encodeURIComponent(first.data.visitorToken)}`);
  assert.equal(ok.status, 200);
  assert.match(ok.contentType, /text\/event-stream/);
  ok.close();
});

test('#9 已停用账号换不到新的 SSE 票据', async () => {
  const res = await server.request('POST', '/api/auth/sse-ticket', undefined, bearer(u100Token));
  assert.equal(res.status, 401);
});
