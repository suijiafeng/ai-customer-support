// 「急」/ 等待超时规则：工作台接待大厅、会话详情、跟进事项共用 @assistflow/shared 的 urgency.ts。
// 服务端建跟进事项时用同一份词表定优先级，见 tickets.service.test.js。
import test from 'node:test';
import assert from 'node:assert/strict';
import { isUrgentText, isUrgentSession, isWaitOverdue, URGENT_WAIT_MINUTES } from '@assistflow/shared';

test('催促词判定为急，普通转人工不算急', () => {
  assert.equal(isUrgentText('麻烦尽快 联系我'), true);
  assert.equal(isUrgentText('今天 联系'), true);
  assert.equal(isUrgentText('转人工'), false);
  assert.equal(isUrgentText(null), false);
});

test('有关联跟进事项时以它的优先级为准（含手动调整）', () => {
  assert.equal(isUrgentSession({ lastMessage: '紧急！', workflow: { ticket: { priority: 'normal' } } }), false);
  assert.equal(isUrgentSession({ lastMessage: '转人工', workflow: { ticket: { priority: 'high' } } }), true);
  assert.equal(isUrgentSession({ lastMessage: '马上处理', workflow: null }), true);
  assert.equal(isUrgentSession({ lastMessage: '你好' }), false);
});

test('等待超过 SLA 才算超时', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  const ago = (min) => new Date(now - min * 60_000).toISOString();
  assert.equal(isWaitOverdue(ago(URGENT_WAIT_MINUTES - 1), now), false);
  assert.equal(isWaitOverdue(ago(URGENT_WAIT_MINUTES), now), true);
  assert.equal(isWaitOverdue(null, now), false);
});
