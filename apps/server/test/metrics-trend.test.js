// 趋势图：今天的点按实时会话计算，不用启动时写下的（可能是 0 的）快照。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MetricsService } from '../dist/metrics/metrics.service.js';

function harness(stored, sessions) {
  const store = { loadDailyMetrics: async (days) => stored.slice(-days), saveDailyMetric: () => {} };
  const sessionsSvc = { list: () => sessions, messageCount: 0 };
  const tickets = { all: [] };
  return new MetricsService(sessionsSvc, tickets, store);
}

const now = new Date('2026-11-20T10:00:00');
const today = now.toLocaleDateString('en-CA');
const s = (status) => ({ sessionId: status + Math.random(), status, needHuman: status === 'waiting_human', priority: 'normal' });

test('今天的快照是 0 时，用实时值替换', async () => {
  const stored = [
    { date: '2026-11-18', waiting: 2, assigned: 1, activeSessions: 5 },
    { date: '2026-11-19', waiting: 3, assigned: 2, activeSessions: 7 },
    { date: today, waiting: 0, assigned: 0, activeSessions: 0 },
  ];
  const svc = harness(stored, [s('bot'), s('bot'), s('waiting_human'), s('assigned'), s('closed')]);
  const trend = await svc.getTrend(14, now);
  assert.deepEqual(trend.map((p) => p.date), ['2026-11-18', '2026-11-19', today]);
  assert.deepEqual(trend.at(-1), { date: today, waiting: 1, assigned: 1, activeSessions: 4 });
  assert.equal(trend.filter((p) => p.date === today).length, 1);
});

test('库里还没有今天的点时，追加实时点，且总天数不超过上限', async () => {
  const stored = Array.from({ length: 14 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, waiting: 1, assigned: 1, activeSessions: 1 }));
  const svc = harness(stored, [s('waiting_human')]);
  const trend = await svc.getTrend(14, now);
  assert.equal(trend.length, 14);
  assert.equal(trend.at(-1).date, today);
  assert.equal(trend.at(-1).waiting, 1);
  assert.equal(trend[0].date, '2026-10-02');
});
