// 工作台「N 位待接待」与接待大厅共用 @assistflow/shared 的判定：只数已转人工、未认领的会话。
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAwaitingHuman, countAwaitingHuman } from '@assistflow/shared';

const sessions = [
  { sessionId: 'a', status: 'bot' }, // AI 正在答，未认领：不算
  { sessionId: 'b', status: 'bot' },
  { sessionId: 'c', status: 'waiting_human' }, // 转人工，未认领：算
  { sessionId: 'd', status: 'assigned', assignedAgentId: 'ag_1' },
  { sessionId: 'e', status: 'closed' },
  { sessionId: 'f', status: 'resolved' },
];

test('只把 waiting_human 且未认领的会话算作待接待', () => {
  assert.deepEqual(sessions.filter(isAwaitingHuman).map((s) => s.sessionId), ['c']);
  assert.equal(countAwaitingHuman(sessions), 1);
});

test('已被认领的 waiting_human（异常/过渡态）也不算', () => {
  assert.equal(isAwaitingHuman({ status: 'waiting_human', assignedAgentId: 'ag_1' }), false);
  assert.equal(countAwaitingHuman([]), 0);
});
