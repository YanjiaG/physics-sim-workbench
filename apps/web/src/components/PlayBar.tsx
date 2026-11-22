import { useEffect, useRef } from 'react';
import { useApp } from '../store';
import { fmtNumber } from '../lib/format';

export function PlayBar() {
  const time = useApp((state) => state.time);
  const run = useApp((state) => state.run);
  const playing = useApp((state) => state.playing);
  const speed = useApp((state) => state.speed);
  const setPlaying = useApp((state) => state.setPlaying);
  const seek = useApp((state) => state.seek);
  const setSpeed = useApp((state) => state.setSpeed);
  const tick = useApp((state) => state.tick);
  const frameRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);

  useEffect(() => {
    if (!playing) {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      return;
    }
    lastRef.current = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      tick(dt);
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [playing, tick]);

  return (
    <div className="playbar">
      <button
        type="button"
        className="btn primary"
        onClick={() => setPlaying(!playing)}
        title={playing ? '暂停' : '播放'}
      >
        {playing ? '暂停' : '播放'}
      </button>
      <button type="button" className="btn ghost small" onClick={() => seek(0)}>
        回到起点
      </button>
      <span className="time-readout">
        {fmtNumber(time, 2)} / {fmtNumber(run.duration_s, 2)} s
      </span>
      <input
        className="range"
        type="range"
        min={0}
        max={run.duration_s}
        step={0.01}
        value={Math.min(time, run.duration_s)}
        onChange={(event) => seek(Number(event.target.value))}
        aria-label="时间轴"
      />
      <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="播放速度">
        <option value={0.25}>0.25×</option>
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={2}>2×</option>
        <option value={4}>4×</option>
      </select>
    </div>
  );
}
