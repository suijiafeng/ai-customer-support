import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyedLock } from '../dist/common/keyed-lock.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('同一 key 串行，不同 key 并行，失败不卡住队列，空了会清理', async () => {
  const lock = new KeyedLock();
  const log = [];
  const job = (key, name, ms, fail = false) => lock.run(key, async () => {
    log.push(`start:${name}`);
    await sleep(ms);
    log.push(`end:${name}`);
    if (fail) throw new Error(name);
    return name;
  });
  const results = await Promise.allSettled([job('s1', 'a', 60, true), job('s1', 'b', 10), job('s2', 'c', 10)]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].value, 'b');
  // s1 的 b 在 a 结束后才开始；s2 的 c 不用等 a
  assert.ok(log.indexOf('start:b') > log.indexOf('end:a'));
  assert.ok(log.indexOf('start:c') < log.indexOf('end:a'));
  assert.equal(lock.size, 0);
});
