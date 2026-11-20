import React, { useEffect, useRef } from 'react';
import type { EChartsOption } from 'echarts';
// 按需引入：只注册工作台用到的折线图、柱状图和网格 / 提示框 / 图例组件，
// 不再 `import * as echarts from 'echarts'` 把全部图表类型打进包里。
// 新增图表类型时记得在这里 use() 注册，否则 setOption 会报「series.xxx 未注册」。
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([LineChart, BarChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

/** ECharts 容器：init、setOption、随容器尺寸重绘、卸载时销毁。 */
export default function EChart({ option, height }: { option: EChartsOption; height: number }) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const chart = echarts.init(elRef.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={elRef} style={{ width: '100%', height }} />;
}
