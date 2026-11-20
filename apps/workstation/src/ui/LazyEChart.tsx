import React, { Suspense, lazy } from 'react';
import type { EChartsOption } from 'echarts';

// ECharts 单独成块：只有打开「数据概览」或租户详情时才下载，登录页和会话页不加载图表库
const EChart = lazy(() => import('./EChart.js'));

export default function LazyEChart({ option, height }: { option: EChartsOption; height: number }) {
  return (
    <Suspense fallback={<div className="chart-loading" style={{ width: '100%', height }} aria-busy="true" />}>
      <EChart option={option} height={height} />
    </Suspense>
  );
}
