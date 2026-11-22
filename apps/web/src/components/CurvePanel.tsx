import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import type { Run } from '@psw/core';
import { sampleRun } from '@psw/core';
import { useApp } from '../store';

type Metric = 'x' | 'v' | 'a';

const METRIC_LABEL: Record<Metric, string> = { x: '位置 x (m)', v: '速度 v (m/s)', a: '加速度 a (m/s²)' };
const BODY_LABEL: Record<string, string> = { block: '滑块', board: '木板' };
const BODY_COLOR: Record<string, string> = { block: '#0f766e', board: '#b45309' };

function seriesFor(run: Run, metric: Metric) {
  const samples = sampleRun(run, 240);
  return Object.keys(samples.bodies).map((bodyId) => ({
    name: BODY_LABEL[bodyId] ?? bodyId,
    type: 'line' as const,
    showSymbol: false,
    smooth: true,
    lineStyle: { width: 2, color: metric === 'x' ? '#475569' : BODY_COLOR[bodyId] ?? '#0f766e' },
    itemStyle: { color: BODY_COLOR[bodyId] ?? '#0f766e' },
    data: samples.ts.map((t, index) => [Number(t.toFixed(3)), Number((samples.bodies[bodyId]?.[metric]?.[index] ?? 0).toFixed(4))]),
  }));
}

export function CurvePanel() {
  const run = useApp((state) => state.run);
  const compare = useApp((state) => state.compare);
  const time = useApp((state) => state.time);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const [metric, setMetric] = useState<Metric>('v');

  const option = useMemo(() => {
    const base = {
      animation: false,
      grid: { left: 52, right: 18, top: 26, bottom: 26 },
      tooltip: { trigger: 'axis' as const, backgroundColor: '#1f2937', borderWidth: 0, textStyle: { color: '#f9fafb', fontSize: 11 } },
      legend: { top: 0, right: 8, itemWidth: 12, itemHeight: 6, textStyle: { fontSize: 11, color: '#6b7280' } },
      xAxis: {
        type: 'value' as const,
        name: 't/s',
        nameTextStyle: { fontSize: 10, color: '#8a8577' },
        axisLabel: { fontSize: 10, color: '#8a8577' },
        axisLine: { lineStyle: { color: '#e2ddd4' } },
        splitLine: { lineStyle: { color: '#f0ece5' } },
      },
      yAxis: {
        type: 'value' as const,
        name: METRIC_LABEL[metric],
        nameTextStyle: { fontSize: 10, color: '#8a8577' },
        axisLabel: { fontSize: 10, color: '#8a8577' },
        axisLine: { lineStyle: { color: '#e2ddd4' } },
        splitLine: { lineStyle: { color: '#f0ece5' } },
      },
    };

    if (compare) {
      const plans = [
        { label: `${compare.label} = ${compare.values[0]}`, value: compare.values[0], run: compare.runs[0], color: '#0f766e' },
        { label: `${compare.label} = ${compare.values[1]}`, value: compare.values[1], run: compare.runs[1], color: '#b45309' },
      ];
      return {
        ...base,
        legend: { ...base.legend, textStyle: { fontSize: 11, color: '#4b5563' } },
        series: plans.map((plan) => {
          const samples = sampleRun(plan.run, 240);
          return {
            name: plan.label,
            type: 'line' as const,
            showSymbol: false,
            smooth: true,
            lineStyle: { width: 2, color: plan.color },
            itemStyle: { color: plan.color },
            data: samples.ts.map((t, index) => [Number(t.toFixed(3)), Number((samples.bodies.block?.v[index] ?? 0).toFixed(4))]),
          };
        }),
      };
    }

    const series = seriesFor(run, metric);
    return {
      ...base,
      series: series.map((item) => ({ ...item, lineStyle: { ...item.lineStyle, color: series.length > 1 ? item.lineStyle.color : '#0f766e' } })),
    };
  }, [run, compare, metric]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!chartRef.current) chartRef.current = echarts.init(el);
    chartRef.current.setOption(option, true);
    const observer = new ResizeObserver(() => chartRef.current?.resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, [option]);

  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  const sampleNow = useMemo(() => {
    if (compare) return null;
    const samples = sampleRun(run, 240);
    let index = 0;
    for (let i = 0; i < samples.ts.length; i += 1) {
      if ((samples.ts[i] ?? 0) <= time) index = i;
    }
    return Number((samples.bodies.block?.[metric]?.[index] ?? 0).toFixed(3));
  }, [run, time, metric, compare]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="chart-head">
        {(['v', 'x', 'a'] as Metric[]).map((item) => (
          <button
            key={item}
            type="button"
            className={`btn small${metric === item ? ' primary' : ' ghost'}`}
            onClick={() => setMetric(item)}
          >
            {item === 'v' ? 'v–t' : item === 'x' ? 'x–t' : 'a–t'}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {sampleNow !== null ? (
          <span className="chip">
            此刻 {sampleNow} {metric === 'x' ? 'm' : metric === 'v' ? 'm/s' : 'm/s²'}
          </span>
        ) : (
          <span className="chip">对比模式</span>
        )}
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
