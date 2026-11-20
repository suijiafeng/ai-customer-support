import React, { Suspense, lazy, useState } from 'react';
import type { EChartsOption } from 'echarts';

// ECharts 单独成块：只有打开「数据概览」或租户详情时才下载，登录页和会话页不加载图表库。
// React.lazy 会缓存失败的 Promise，重试时必须换一个新的 lazy 组件；放在模块级，
// 同一页面上的几张图共用一份，任意一张点「重试」其余也跟着重新加载。
const makeLazy = () => lazy(() => import('./EChart.js'));
let EChart = makeLazy();

interface BoundaryProps {
  height: number;
  failures: number;
  onError: () => void;
  onRetry: () => void;
  children: React.ReactNode;
}

/** 图表块加载失败（断网、发版后旧 chunk 404）只影响这张卡片，不能让整个工作台白屏 */
class ChartErrorBoundary extends React.Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // 重试过还是失败：多半是发了新版本、旧的 chunk 文件已不存在，刷新页面才能拿到新地址
    const stale = this.props.failures > 1;
    return (
      <div className="chart-error" style={{ height: this.props.height }} role="alert">
        <p>图表加载失败</p>
        {stale && <p className="chart-error-hint">可能是系统刚更新过，刷新页面即可恢复</p>}
        <div className="chart-error-actions">
          <button type="button" className="retry-btn" onClick={this.props.onRetry}>重试</button>
          {stale && (
            <button type="button" className="retry-btn" onClick={() => window.location.reload()}>刷新页面</button>
          )}
        </div>
      </div>
    );
  }
}

export default function LazyEChart({ option, height }: { option: EChartsOption; height: number }) {
  // attempt 变化时重建错误边界（key），配合新的 lazy 组件重新下载图表块
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState(0);
  const retry = () => {
    EChart = makeLazy();
    setAttempt((n) => n + 1);
  };
  return (
    <ChartErrorBoundary
      key={attempt}
      height={height}
      failures={failures}
      onError={() => setFailures((n) => n + 1)}
      onRetry={retry}
    >
      <Suspense
        fallback={
          <div className="chart-loading" style={{ height }} aria-busy="true" aria-label="图表加载中">
            <span className="chart-spinner" aria-hidden="true" />
          </div>
        }
      >
        <EChart option={option} height={height} />
      </Suspense>
    </ChartErrorBoundary>
  );
}
