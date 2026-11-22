import type { Force, Params, Pt, Primitive, ParamValue, Run } from '../types';
import { stateAt } from '../solver';
import {
  ARROW_MAX_M,
  ARROW_MIN_M,
  FORCE_ARROW_SCALE,
  PALETTE,
  VELOCITY_ARROW_SCALE,
} from '../types';

export function num(params: Params, key: string, fallback = 0): number {
  const value = params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function bool(params: Params, key: string, fallback = false): boolean {
  const value = params[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 数值展示：默认两位小数，去掉多余的 0 但保留至少整数位 */
export function fmt(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '—';
  const fixed = value.toFixed(digits);
  return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

export function fmtUnit(value: number, unit: string, digits = 2): string {
  return `${fmt(value, digits)} ${unit}`.trim();
}

export function vec(x: number, y: number): Pt {
  return { x, y };
}

export function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scaleVec(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k };
}

export function rotate(p: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

export function normalize(p: Pt): Pt {
  const len = Math.hypot(p.x, p.y);
  if (len < 1e-12) return { x: 0, y: 0 };
  return { x: p.x / len, y: p.y / len };
}

export function forceArrowLength(magnitude: number): number {
  return clamp(magnitude * FORCE_ARROW_SCALE, ARROW_MIN_M, ARROW_MAX_M);
}

export function velocityArrowLength(speed: number): number {
  return clamp(Math.abs(speed) * VELOCITY_ARROW_SCALE, 0, ARROW_MAX_M);
}

export function makeForce(
  kind: Force['kind'],
  label: string,
  magnitude: number,
  dir: Pt,
  on: string,
  id?: string,
): Force {
  return {
    id: id ?? `${kind}_${on}_${label}`,
    label,
    on,
    kind,
    magnitude: Math.abs(magnitude),
    dir: normalize(dir),
  };
}

export function forceColor(kind: Force['kind']): string {
  switch (kind) {
    case 'gravity':
      return PALETTE.gravity;
    case 'normal':
      return PALETTE.normal;
    case 'friction':
      return PALETTE.friction;
    case 'applied':
      return PALETTE.applied;
  }
}

export function arrow(
  from: Pt,
  dir: Pt,
  length: number,
  color: string,
  label?: string,
  labelSide: 'above' | 'below' = 'above',
  width = 2,
): Primitive {
  const unit = normalize(dir);
  const to = { x: from.x + unit.x * length, y: from.y + unit.y * length };
  return { type: 'arrow', from, to, color, label, labelSide, width };
}

export function text(
  at: Pt,
  content: string,
  options: { color?: string; size?: number; weight?: number; align?: 'left' | 'center' | 'right'; baseline?: 'top' | 'middle' | 'bottom' } = {},
): Primitive {
  return {
    type: 'text',
    at,
    text: content,
    color: options.color ?? PALETTE.text,
    size: options.size ?? 12,
    weight: options.weight ?? 500,
    align: options.align ?? 'left',
    baseline: options.baseline ?? 'middle',
  };
}

/** 地面剖面线：在地面线下方画斜线，帮助区分「固定支撑」 */
export function groundHatch(fromX: number, toX: number, y = 0, height = 0.28, step = 0.5): Primitive[] {
  const out: Primitive[] = [];
  for (let x = fromX; x < toX; x += step) {
    out.push({
      type: 'line',
      a: { x, y },
      b: { x: x + height, y: y - height },
      color: PALETTE.surface,
      width: 1,
    });
  }
  return out;
}

export interface ArrowBundle {
  force: Force[];
}

export function blockPrimitive(
  center: Pt,
  width: number,
  height: number,
  angle: number,
  fill: string = PALETTE.block,
  stroke: string = PALETTE.blockEdge,
): Primitive {
  return {
    type: 'rect',
    center,
    w: width,
    h: height,
    angle,
    fill,
    stroke,
    lineWidth: 1.5,
    rx: 2,
  };
}

export function axisEndpoints(origin: Pt, axis: Pt, length: number): { a: Pt; b: Pt } {
  return { a: origin, b: { x: origin.x + axis.x * length, y: origin.y + axis.y * length } };
}

/** 兼容类型检查：确保参数值未被意外当成对象 */
export function isNumberValue(value: ParamValue | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 一维匀加速运动中到达某个坐标所需的最早正时间 */
export function timeToReach(target: number, x0: number, v0: number, a: number): number | null {
  if (Math.abs(a) < 1e-9) {
    if (Math.abs(v0) < 1e-9) return null;
    const t = (target - x0) / v0;
    return t > 1e-9 ? t : null;
  }
  const disc = v0 * v0 - 2 * a * (x0 - target);
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const candidates = [(-v0 + sq) / a, (-v0 - sq) / a].filter((t) => t > 1e-9);
  candidates.sort((p, q) => p - q);
  return candidates[0] ?? null;
}
/** 力矢量的图例：在画布空白处列出「符号 = 大小 N」，避免箭头端点标签互相重叠 */
export function forceLegend(
  rows: { label: string; text: string; color: string }[],
  origin: Pt,
  options: { rowHeight?: number; size?: number; sample?: number } = {},
): Primitive[] {
  const rowHeight = options.rowHeight ?? 0.24;
  const size = options.size ?? 11;
  const sample = options.sample ?? 0.3;
  const out: Primitive[] = [];
  rows.forEach((row, index) => {
    const y = origin.y - index * rowHeight;
    out.push({ type: 'line', a: { x: origin.x, y }, b: { x: origin.x + sample, y }, color: row.color, width: 2 });
    out.push({
      type: 'polygon',
      pts: [
        { x: origin.x + sample + 0.07, y },
        { x: origin.x + sample, y: y + 0.05 },
        { x: origin.x + sample, y: y - 0.05 },
      ],
      fill: row.color,
      stroke: row.color,
      lineWidth: 0,
    });
    out.push(
      text({ x: origin.x + sample + 0.16, y }, row.text, {
        size,
        color: PALETTE.text,
        baseline: 'middle',
        align: 'left',
      }),
    );
  });
  return out;
}

export function trajectory(
  run: Run,
  t: number,
  bodyId: string,
  toWorld: (x: number) => Pt,
  count = 80,
): Pt[] {
  const end = Math.min(t, run.duration_s);
  if (end <= 0) return [];
  const points: Pt[] = [];
  for (let i = 0; i <= count; i++) {
    const time = (end * i) / count;
    const body = stateAt(run, time).bodies[bodyId];
    if (body) points.push(toWorld(body.x));
  }
  return points;
}
