// 限速响应：把 @nestjs/throttler 的 Retry-After-<name> 统一成标准 Retry-After + data.retryAfter。
import test from 'node:test';
import assert from 'node:assert/strict';
import { retryAfterSeconds } from '../dist/common/http-exception.filter.js';
import { startServer } from './helpers/server.js';

const fakeRes = (headers) => ({
  getHeaderNames: () => Object.keys(headers),
  getHeader: (name) => headers[name],
});

test('retryAfterSeconds 取具名限速头里的最大值', () => {
  assert.equal(retryAfterSeconds(fakeRes({ 'retry-after-login': '42', 'x-ratelimit-limit-login': '5' })), 42);
  assert.equal(retryAfterSeconds(fakeRes({ 'retry-after-chat': 3, 'retry-after-login': 17 })), 17);
  assert.equal(retryAfterSeconds(fakeRes({ 'content-type': 'json' })), 0);
});

test('登录被限速时返回剩余秒数', async () => {
  const server = await startServer();
  try {
    // startServer 自己已经登录过一次，再错 4 次用满每分钟 5 次的额度
    for (let i = 0; i < 4; i += 1) {
      const r = await server.request('POST', '/api/auth/login', { agentNo: '9527', password: 'wrong' });
      assert.equal(r.status, 401);
    }
    const res = await fetch(`${server.base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentNo: '9527', password: 'wrong' }),
    });
    assert.equal(res.status, 429);
    const header = Number(res.headers.get('retry-after'));
    const body = await res.json();
    assert.ok(header > 0 && header <= 60, `Retry-After=${header}`);
    assert.equal(body.data.retryAfter, header);
  } finally {
    await server.stop();
  }
});
