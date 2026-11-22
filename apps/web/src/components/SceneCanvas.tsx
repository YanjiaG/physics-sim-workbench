import { useEffect, useRef, useState } from 'react';
import { getModel, PALETTE, runBounds, stateAt } from '@psw/core';
import { useApp } from '../store';
import { registerCanvas } from '../lib/export';
import { fmtNumber } from '../lib/format';
import { createViewport, drawEmptyState, drawFrame } from '../lib/draw';

const FORCE_COLOR: Record<string, string> = {
  gravity: PALETTE.gravity,
  normal: PALETTE.normal,
  friction: PALETTE.friction,
  applied: PALETTE.applied,
};

export function SceneCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scene = useApp((state) => state.scene);
  const run = useApp((state) => state.run);
  const time = useApp((state) => state.time);
  const [size, setSize] = useState({ width: 800, height: 480 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: parent.clientWidth, height: parent.clientHeight });
    });
    observer.observe(parent);
    setSize({ width: parent.clientWidth, height: parent.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    registerCanvas(canvas);
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, size.width);
    const height = Math.max(1, size.height);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const model = getModel(scene.modelId);
    if (!model) {
      drawEmptyState(ctx, width, height, '未注册的模型');
      return;
    }
    const bounds = runBounds(model, scene, run);
    const marginX = Math.max(0.3, (bounds.maxX - bounds.minX) * 0.05);
    const marginY = Math.max(0.2, (bounds.maxY - bounds.minY) * 0.08);
    const padded = {
      minX: bounds.minX - marginX,
      maxX: bounds.maxX + marginX,
      minY: bounds.minY - marginY,
      maxY: bounds.maxY + marginY,
    };
    const view = createViewport(width, height, padded, 26);
    drawFrame(ctx, model.frame(scene.params, run, time), view);
  }, [scene, run, time, size]);

  const model = getModel(scene.modelId);
  const current = stateAt(run, time);
  const mode = current.bodies[model?.primaryBody ?? 'block']?.v ?? 0;

  return (
    <div className="stage-canvas-wrap">
      <canvas ref={canvasRef} />
      <div className="stage-badge">
        <span className="chip accent">{model?.name ?? scene.modelId}</span>
        <span className="chip">
          {current.t <= 0 ? '初始状态' : run.segments[current.segmentIndex]?.label ?? '运行中'}
        </span>
        {current.t > 0 ? (
          <span className="chip">
            v = {mode.toFixed(2)} m/s
          </span>
        ) : null}
      </div>
      {current.forces.length > 0 ? (
        <div className="stage-legend">
          {current.forces.map((force) => (
            <div key={`${force.id}_${force.on}`} className="legend-row">
              <span className="legend-dot" style={{ background: FORCE_COLOR[force.kind] ?? PALETTE.muted }} />
              <span className="legend-label">{force.label}</span>
              <span className="legend-value">{fmtNumber(force.magnitude, 2)} N</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
