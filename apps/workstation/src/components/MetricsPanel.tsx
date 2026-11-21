import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { DailyMetricPoint, Metrics } from '@assistflow/shared';
import type * as echarts from 'echarts';
import { fmtTime, requestJson } from '../api.js';
import EChart from '../ui/LazyEChart.js';
import Icon from '../ui/Icon.js';

const MAX_DAYS = 14;
const TREND_H = 200;

// 同一青绿的明度阶梯，避免蓝橙撞色；已关闭用中性灰
const C_AI = '#0d9488';
const C_ASSIGNED = '#2a78d6';
const C_WAITING = '#eb6834';
const C_CLOSED = '#d0d3d7';
// 轴线 / 网格 / 文字：一律中性灰，退到数据后面
const AXIS = '#e6e7ea';
const TICK = '#989a9e';
const LEGEND = '#6c6f72';

/** 数据概览区块（页面上半部）：指标条 + 会话构成 + 每日趋势，进入时拉取，每 15 秒自动刷新。 */
export default function MetricsPanel() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  // 每日趋势改由后端按天落库、聚合返回（团队级、跨端一致）
  const [history, setHistory] = useState<DailyMetricPoint[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([
        requestJson<Metrics>('/api/metrics'),
        requestJson<{ trend: DailyMetricPoint[] }>('/api/metrics/trend'),
      ]);
      setMetrics(m);
      setHistory(t.trend || []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);

  // 会话构成：AI 接待 / 人工接待中 / 待跟进 / 已关闭（部分与整体，用一条横向堆叠条表达）
  const composition = useMemo(() => {
    if (!metrics) return [];
    const { sessions } = metrics.totals;
    const { waitingHuman, assigned, closed } = metrics.queue;
    const bot = Math.max(0, sessions - waitingHuman - assigned - closed);
    return [
      { key: 'bot', name: 'AI 接待', value: bot, color: C_AI },
      { key: 'assigned', name: '人工接待中', value: assigned, color: C_ASSIGNED },
      { key: 'waiting', name: '待跟进', value: waitingHuman, color: C_WAITING },
      { key: 'closed', name: '已关闭', value: closed, color: C_CLOSED },
    ];
  }, [metrics]);
  const compositionTotal = composition.reduce((sum, c) => sum + c.value, 0);

  const lineOption = useMemo<echarts.EChartsOption>(() => ({
    color: [C_AI, C_ASSIGNED, C_WAITING],
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: AXIS } },
      backgroundColor: '#fff',
      borderColor: AXIS,
      textStyle: { color: '#1a1d21', fontSize: 12 },
    },
    legend: {
      top: 0, right: 0, icon: 'roundRect', itemWidth: 12, itemHeight: 3, itemGap: 16,
      textStyle: { color: LEGEND, fontSize: 12 },
    },
    grid: { left: 28, right: 8, top: 32, bottom: 24 },
    xAxis: {
      type: 'category', boundaryGap: false,
      data: history.map((h) => h.date.slice(5)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: TICK, fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: TICK, fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
      splitLine: { lineStyle: { color: '#f1f3f5', type: 'dashed' } },
    },
    series: [
      { name: '活跃会话', data: history.map((h) => h.activeSessions) },
      { name: '人工接待中', data: history.map((h) => h.assigned) },
      { name: '待跟进', data: history.map((h) => h.waiting) },
    ].map((s) => ({
      ...s,
      type: 'line' as const,
      smooth: false,
      showSymbol: false,
      symbolSize: 6,
      lineStyle: { width: 1.5 },
      emphasis: { focus: 'series' as const },
    })),
  }), [history]);

  const lineHasData = history.some((h) => h.waiting + h.assigned + h.activeSessions > 0);

  return (
    <section className="panel-block" aria-label="数据概览">
      <div className="panel-toolbar">
        <h2 className="block-title">数据概览</h2>
        {metrics && (
          <span className="metrics-time" title="每 15 秒自动刷新">更新于 {fmtTime(metrics.generatedAt)}</span>
        )}
      </div>

      {error ? (
        <div className="empty"><Icon name="alert-triangle" size={28} style={{ opacity: .4, marginBottom: 4 }} />指标加载失败<button className="retry-btn" onClick={load}>重试</button></div>
      ) : !metrics ? (
        <div className="loading-center"><div className="spinner" /></div>
      ) : (
        <>
          {/* 指标条：一条面板 + 细分隔线；需要处理的指标大于 0 时，标签前加一个小提示点 */}
          <div className="stat-strip">
            {[
              { label: '总会话', value: metrics.totals.sessions },
              { label: '人工接待中', value: metrics.queue.assigned },
              { label: '待跟进', value: metrics.queue.waitingHuman, attention: metrics.queue.waitingHuman > 0 },
              { label: '待处理工单', value: metrics.tickets.open, attention: metrics.tickets.open > 0 },
              { label: '处理中工单', value: metrics.tickets.processing },
              { label: 'AI 解决率', value: metrics.totals.sessions > 0 ? `${metrics.ai.automationRate}%` : '—' },
            ].map((s) => (
              <div key={s.label} className="stat">
                <span className="stat-label">
                  {s.attention && <i className="stat-dot" aria-hidden="true" />}
                  {s.label}
                  {s.attention && <span className="sr-only">（需要处理）</span>}
                </span>
                <b className="stat-value">{s.value}</b>
              </div>
            ))}
          </div>

          <div className="overview-grid">
            <section className="chart-card">
              <div className="chart-head">
                <h3>会话构成</h3>
                <span className="chart-sub">共 {compositionTotal} 个</span>
              </div>
              {compositionTotal > 0 ? (
                <>
                  <div
                    className="compose-bar"
                    role="img"
                    aria-label={composition.map((c) => `${c.name} ${c.value}`).join('，')}
                  >
                    {composition.filter((c) => c.value > 0).map((c) => (
                      <span
                        key={c.key}
                        className="compose-seg"
                        style={{ flexGrow: c.value, background: c.color }}
                        title={`${c.name}：${c.value}（${Math.round((c.value / compositionTotal) * 100)}%）`}
                      />
                    ))}
                  </div>
                  <ul className="compose-legend">
                    {composition.map((c) => (
                      <li key={c.key}>
                        <i style={{ background: c.color }} aria-hidden="true" />
                        <span className="compose-name">{c.name}</span>
                        <b>{c.value}</b>
                        <span className="compose-pct">{Math.round((c.value / compositionTotal) * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <ChartEmpty height={120} />}
            </section>

            <section className="chart-card">
              <div className="chart-head">
                <h3>每日趋势</h3>
                <span className="chart-sub">近 {MAX_DAYS} 天</span>
              </div>
              {lineHasData ? <EChart option={lineOption} height={TREND_H} /> : <ChartEmpty height={TREND_H} />}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function ChartEmpty({ height, text = '暂无数据' }: { height: number; text?: string }) {
  return (
    <div className="chart-empty" style={{ height }}>
      <Icon name="bar-chart" size={24} style={{ opacity: .3, marginBottom: 6 }} />
      <span>{text}</span>
    </div>
  );
}

