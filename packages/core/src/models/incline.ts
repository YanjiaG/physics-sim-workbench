import type {
  Acceleration,
  AssumptionSpec,
  Bounds,
  EventCandidate,
  Force,
  Issue,
  ModelDefinition,
  ModelState,
  ObservableSpec,
  ParamSpec,
  Params,
  Primitive,
  Pt,
  Run,
  SceneFrame,
} from '../types';
import { EPS, FORCE_ARROW_SCALE, PALETTE } from '../types';
import { stateAt } from '../solver';
import {
  add,
  blockPrimitive,
  clamp,
  fmt,
  fmtUnit,
  forceArrowLength,
  groundHatch,
  makeForce,
  normalize,
  num,
  scaleVec,
  text,
  timeToReach,
  trajectory,
  velocityArrowLength,
} from './helpers';

const BLOCK = 'block';
const HALF_W = 0.36;
const HALF_H = 0.2;

const parameters: ParamSpec[] = [
  { key: 'mass_kg', label: '质量 m', unit: 'kg', group: 'object', type: 'number', default: 1, min: 0.1, max: 50, step: 0.1 },
  { key: 'angle_deg', label: '倾角 θ', unit: '°', group: 'object', type: 'number', default: 30, min: 1, max: 89, step: 1 },
  { key: 'incline_length_m', label: '斜面长度 L', unit: 'm', group: 'object', type: 'number', default: 8, min: 1, max: 40, step: 0.5 },
  { key: 'gravity_m_s2', label: '重力加速度 g', unit: 'm/s²', group: 'environment', type: 'number', default: 9.8, min: 0.5, max: 20, step: 0.1, advanced: true },
  { key: 'mu_static', label: '静摩擦系数 μs', group: 'environment', type: 'number', default: 0.3, min: 0, max: 2, step: 0.01 },
  { key: 'mu_kinetic', label: '动摩擦系数 μk', group: 'environment', type: 'number', default: 0.2, min: 0, max: 2, step: 0.01 },
  { key: 'applied_force_N', label: '沿斜面外力 F', unit: 'N', group: 'environment', type: 'number', default: 0, min: -500, max: 500, step: 0.5, hint: '正值沿斜面向上' },
  { key: 'initial_position_m', label: '初始位置 s₀', unit: 'm', group: 'initial', type: 'number', default: 4, min: 0, max: 40, step: 0.1, hint: '从斜面底端沿斜面量起' },
  { key: 'initial_velocity_m_s', label: '初速度 v₀', unit: 'm/s', group: 'initial', type: 'number', default: 0, min: -60, max: 60, step: 0.1, hint: '正值沿斜面向上' },
];

const assumptions: AssumptionSpec[] = [
  { key: 'fixed_incline', label: '斜面固定不动，表面平直', locked: true },
  { key: 'point_mass', label: '物体视为质点，忽略转动与翻滚', locked: true },
  { key: 'no_air', label: '忽略空气阻力', locked: true },
  { key: 'edge', label: '物块到达斜面两端即离开，之后不再模拟', note: '如需模拟离开后的抛体运动，请等待后续版本' },
];

const observables: ObservableSpec[] = [
  { key: 'position', label: '沿斜面位置 s', unit: 'm' },
  { key: 'velocity', label: '沿斜面速度 v', unit: 'm/s' },
  { key: 'acceleration', label: '加速度 a', unit: 'm/s²' },
  { key: 'friction', label: '摩擦力 f', unit: 'N' },
  { key: 'energy', label: '机械能 E', unit: 'J' },
];

function mass(params: Params): number {
  return num(params, 'mass_kg', 1);
}
function gravity(params: Params): number {
  return num(params, 'gravity_m_s2', 9.8);
}
function angle(params: Params): number {
  return (num(params, 'angle_deg', 30) * Math.PI) / 180;
}
function lengthOf(params: Params): number {
  return num(params, 'incline_length_m', 8);
}
function axisOf(params: Params): Pt {
  const theta = angle(params);
  return { x: Math.cos(theta), y: Math.sin(theta) };
}
function normalOf(params: Params): Pt {
  const theta = angle(params);
  return { x: -Math.sin(theta), y: Math.cos(theta) };
}
/** 重力沿斜面向下的分量大小 */
function gravityAlong(params: Params): number {
  return mass(params) * gravity(params) * Math.sin(angle(params));
}
function maxStatic(params: Params): number {
  return num(params, 'mu_static', 0.3) * mass(params) * gravity(params) * Math.cos(angle(params));
}
function kineticFriction(params: Params): number {
  return num(params, 'mu_kinetic', 0.2) * mass(params) * gravity(params) * Math.cos(angle(params));
}
function applied(params: Params): number {
  return num(params, 'applied_force_N', 0);
}
function surfacePoint(s: number, params: Params): Pt {
  const theta = angle(params);
  return { x: s * Math.cos(theta), y: s * Math.sin(theta) };
}

function createDefaultParams(): Params {
  return {
    mass_kg: 1,
    angle_deg: 30,
    incline_length_m: 8,
    gravity_m_s2: 9.8,
    mu_static: 0.3,
    mu_kinetic: 0.2,
    applied_force_N: 0,
    initial_position_m: 4,
    initial_velocity_m_s: 0,
  };
}

function validate(params: Params): Issue[] {
  const issues: Issue[] = [];
  const theta = num(params, 'angle_deg', 30);
  const length = lengthOf(params);
  const s0 = num(params, 'initial_position_m', 4);
  if (mass(params) <= 0) issues.push({ level: 'error', key: 'mass_kg', message: '质量必须大于 0。' });
  if (gravity(params) <= 0) issues.push({ level: 'error', key: 'gravity_m_s2', message: '重力加速度必须大于 0。' });
  if (theta <= 0 || theta >= 90) issues.push({ level: 'error', key: 'angle_deg', message: '倾角需在 0° 与 90° 之间（不含端点）。' });
  if (length <= 0) issues.push({ level: 'error', key: 'incline_length_m', message: '斜面长度必须大于 0。' });
  if (s0 <= 0 || s0 >= length) {
    issues.push({ level: 'error', key: 'initial_position_m', message: `初始位置需落在斜面上：0 < s₀ < ${fmt(length)} m。` });
  }
  if (num(params, 'mu_kinetic', 0.2) < 0 || num(params, 'mu_static', 0.3) < 0) {
    issues.push({ level: 'error', message: '摩擦系数不能为负。' });
  }
  if (num(params, 'mu_static', 0.3) < num(params, 'mu_kinetic', 0.2)) {
    issues.push({ level: 'warning', key: 'mu_static', message: '静摩擦系数小于动摩擦系数。计算按两者独立处理，但真实材料通常 μs ≥ μk。' });
  }
  if (theta < 5) issues.push({ level: 'warning', key: 'angle_deg', message: '坡度很缓，摩擦与外力对结果的影响会被放大。' });
  return issues;
}

function init(params: Params): ModelState {
  const s0 = num(params, 'initial_position_m', 4);
  const v0 = num(params, 'initial_velocity_m_s', 0);
  return {
    time: 0,
    bodies: { [BLOCK]: { x: s0, v: v0 } },
    mode: Math.abs(v0) > EPS ? 'sliding' : 'rest',
  };
}

function buildForces(params: Params, mode: 'rest' | 'sliding', sgn: number): Force[] {
  const axis = axisOf(params);
  const normal = normalOf(params);
  const f = applied(params);
  const forces: Force[] = [
    makeForce('gravity', 'G', mass(params) * gravity(params), { x: 0, y: -1 }, BLOCK, 'g'),
    makeForce('normal', 'N', mass(params) * gravity(params) * Math.cos(angle(params)), normal, BLOCK, 'n'),
  ];
  if (Math.abs(f) > EPS) {
    forces.push(makeForce('applied', 'F', Math.abs(f), scaleVec(axis, Math.sign(f)), BLOCK, 'applied'));
  }
  if (mode === 'rest') {
    const drive = f - gravityAlong(params);
    if (Math.abs(drive) > EPS) {
      forces.push(makeForce('friction', 'f静', Math.abs(drive), scaleVec(axis, -Math.sign(drive)), BLOCK, 'friction'));
    }
  } else {
    const fk = kineticFriction(params);
    if (fk > EPS) {
      forces.push(makeForce('friction', 'f', fk, scaleVec(axis, -sgn), BLOCK, 'friction'));
    }
  }
  return forces;
}

function accel(state: ModelState, params: Params): Acceleration {
  const m = mass(params);
  const f = applied(params);
  const drive = f - gravityAlong(params);
  const body = state.bodies[BLOCK] ?? { x: 0, v: 0 };
  const sliding = Math.abs(body.v) > EPS;

  if (!sliding && Math.abs(drive) <= maxStatic(params) + EPS) {
    return {
      bodies: { [BLOCK]: 0 },
      mode: 'rest',
      label: `静止：沿斜面驱动力 ${fmt(Math.abs(drive))} N ≤ 最大静摩擦 ${fmt(maxStatic(params))} N`,
      forces: buildForces(params, 'rest', 0),
      heat: [],
    };
  }

  const sgn = sliding ? Math.sign(body.v) : Math.sign(drive) || -1;
  const fk = kineticFriction(params);
  const a = (f - gravityAlong(params) - sgn * fk) / m;
  const direction = sgn > 0 ? '向上' : '向下';
  return {
    bodies: { [BLOCK]: a },
    mode: 'sliding',
    label: `${direction}滑动：a = (F − m·g·sinθ ${sgn > 0 ? '−' : '+'} f) / m = ${fmt(a)} m/s²`,
    forces: buildForces(params, 'sliding', sgn),
    heat: fk > EPS ? [{ magnitude: fk, bodyId: BLOCK, ref: { kind: 'ground' } }] : [],
  };
}

function nextEvent(state: ModelState, params: Params, accelResult: Acceleration, deadline: number): EventCandidate | null {
  const body = state.bodies[BLOCK];
  if (!body) return null;
  const a = accelResult.bodies[BLOCK] ?? 0;
  const length = lengthOf(params);
  const candidates: EventCandidate[] = [];

  if (Math.abs(body.v) > EPS && Math.abs(a) > EPS && body.v * a < 0) {
    const tStop = state.time + -body.v / a;
    if (tStop > state.time + EPS && tStop <= deadline + EPS) {
      const drive = applied(params) - gravityAlong(params);
      const holds = Math.abs(drive) <= maxStatic(params) + EPS;
      candidates.push({
        time: tStop,
        kind: holds ? 'stop' : 'reverse',
        title: holds ? '停止' : '反向',
        bodyIds: [BLOCK],
        detail: holds
          ? `速度降为 0；沿斜面驱动力 ${fmt(Math.abs(drive))} N 未超过最大静摩擦 ${fmt(maxStatic(params))} N，物体停在斜面上。`
          : `速度降为 0；沿斜面驱动力超过最大静摩擦，物体随即改变方向。`,
        apply: (s) => ({
          ...s,
          bodies: { ...s.bodies, [BLOCK]: { x: s.bodies[BLOCK]?.x ?? 0, v: 0 } },
          mode: holds ? 'rest' : 'sliding',
        }),
      });
    }
  }

  for (const target of [0, length]) {
    const tEdge = timeToReach(target, body.x, body.v, a);
    if (tEdge === null) continue;
    const tAbs = state.time + tEdge;
    if (tAbs > deadline + EPS) continue;
    const atBottom = target === 0;
    candidates.push({
      time: tAbs,
      kind: 'leave',
      title: atBottom ? '离开斜面（底端）' : '离开斜面（顶端）',
      bodyIds: [BLOCK],
      terminal: true,
      detail: `滑块到达斜面${atBottom ? '底端' : '顶端'}（s = ${fmt(target)} m），离开模型定义域，模拟结束。`,
      apply: (s) => ({
        ...s,
        bodies: { ...s.bodies, [BLOCK]: { x: target, v: s.bodies[BLOCK]?.v ?? 0 } },
        mode: 'left',
      }),
    });
  }

  candidates.sort((p, q) => p.time - q.time);
  return candidates[0] ?? null;
}

function energy(state: ModelState, params: Params): number {
  const body = state.bodies[BLOCK];
  if (!body) return 0;
  const kinetic = 0.5 * mass(params) * body.v * body.v;
  const potential = mass(params) * gravity(params) * body.x * Math.sin(angle(params));
  return kinetic + potential;
}

function bounds(params: Params, run: Run): Bounds {
  const length = lengthOf(params);
  const theta = angle(params);
  let minS = Number.POSITIVE_INFINITY;
  let maxS = Number.NEGATIVE_INFINITY;
  for (const segment of run.segments) {
    const motion = segment.bodies[BLOCK];
    if (!motion) continue;
    const dt = segment.t1 - segment.t0;
    const s1 = motion.x0 + motion.v0 * dt + 0.5 * motion.a * dt * dt;
    minS = Math.min(minS, motion.x0, s1);
    maxS = Math.max(maxS, motion.x0, s1);
  }
  if (!Number.isFinite(minS)) {
    minS = 0;
    maxS = length;
  }
  minS = clamp(minS, 0, length);
  maxS = clamp(maxS, 0, length);
  const arrowRoom = Math.min(
    Math.max(mass(params) * gravity(params), Math.max(Math.abs(applied(params)), maxStatic(params))) * FORCE_ARROW_SCALE,
    2.6,
  );
  return {
    minX: Math.min(-1.2, minS * Math.cos(theta) - 1.0),
    maxX: Math.max(length * Math.cos(theta), maxS * Math.cos(theta)) + 1.4,
    minY: -1.05,
    maxY: Math.max(length * Math.sin(theta), maxS * Math.sin(theta)) + arrowRoom + 1.1,
  };
}

function frame(params: Params, run: Run, t: number): SceneFrame {
  const theta = angle(params);
  const length = lengthOf(params);
  const axis = axisOf(params);
  const normal = normalOf(params);
  const st = stateAt(run, t);
  const body = st.bodies[BLOCK] ?? { x: 0, v: 0, a: 0 };
  const box = bounds(params, run);
  const prims: Primitive[] = [];

  const top: Pt = surfacePoint(length, params);
  prims.push({
    type: 'polygon',
    pts: [{ x: 0, y: 0 }, top, { x: top.x, y: 0 }],
    fill: PALETTE.inclineFill,
    stroke: PALETTE.incline,
    lineWidth: 2,
  });
  prims.push({ type: 'line', a: { x: box.minX, y: 0 }, b: { x: box.maxX, y: 0 }, color: PALETTE.ground, width: 2.5 });
  prims.push(...groundHatch(Math.min(0, box.minX), box.maxX, 0, 0.22, 0.5));

  const arcRadius = Math.min(1.5, Math.max(0.8, length * 0.25));
  prims.push({ type: 'arc', center: { x: 0, y: 0 }, r: arcRadius, from: 0, to: theta, color: PALETTE.muted, width: 1.4 });
  prims.push(
    text(
      { x: arcRadius * 0.72 * Math.cos(theta / 2), y: arcRadius * 0.72 * Math.sin(theta / 2) },
      `θ = ${fmt(num(params, 'angle_deg', 30), 0)}°`,
      { size: 12, color: PALETTE.muted, align: 'left' },
    ),
  );

  prims.push({ type: 'line', a: top, b: { x: top.x, y: 0 }, color: PALETTE.surface, width: 1, dash: true });
  prims.push(text({ x: top.x + 0.15, y: top.y / 2 }, `L = ${fmt(length)} m`, { size: 11, color: PALETTE.muted }));

  const trackPoints = trajectory(run, t, BLOCK, (s) => surfacePoint(s, params));
  if (trackPoints.length > 1) {
    prims.push({ type: 'polyline', pts: trackPoints, color: PALETTE.trajectory, width: 1.6, dash: true });
  }

  const base = surfacePoint(body.x, params);
  const center = add(base, scaleVec(normal, HALF_H));
  prims.push(blockPrimitive(center, HALF_W * 2, HALF_H * 2, theta, PALETTE.block, PALETTE.blockEdge));
  prims.push(
    text(add(center, scaleVec(axis, HALF_W + 0.12)), `m = ${fmt(mass(params))} kg`, {
      size: 10,
      align: 'left',
      weight: 600,
      color: PALETTE.text,
    }),
  );

  for (const force of st.forces) {
    const fxLength = Math.min(Math.max(forceArrowLength(force.magnitude), 0.34), 0.95);
    if (fxLength <= EPS) continue;
    const along = Math.sign(force.dir.x * axis.x + force.dir.y * axis.y) || 1;
    const from: Pt =
      force.kind === 'gravity'
        ? center
        : force.kind === 'normal'
          ? add(base, scaleVec(normal, 0.02))
          : force.kind === 'friction'
            ? add(add(base, scaleVec(normal, 0.02)), scaleVec(axis, -0.08))
            : add(center, scaleVec(normal, HALF_H));
    const dir = normalize(
      force.kind === 'gravity'
        ? { x: 0, y: -1 }
        : force.kind === 'normal'
          ? normal
          : scaleVec(axis, along),
    );
    const color =
      force.kind === 'gravity'
        ? PALETTE.gravity
        : force.kind === 'normal'
          ? PALETTE.normal
          : force.kind === 'friction'
            ? PALETTE.friction
            : PALETTE.applied;
    prims.push({
      type: 'arrow',
      from,
      to: { x: from.x + dir.x * fxLength, y: from.y + dir.y * fxLength },
      color,
      width: 2,
    });
  }

  const vLen = velocityArrowLength(body.v);
  if (vLen > 0.02) {
    const from = add(center, scaleVec(normal, HALF_H + 0.06));
    const dir = scaleVec(axis, Math.sign(body.v) || 1);
    prims.push({
      type: 'arrow',
      from,
      to: { x: from.x + dir.x * vLen, y: from.y + dir.y * vLen },
      color: PALETTE.velocity,
      width: 2.4,
    });
    prims.push(
      text({ x: from.x + dir.x * (vLen + 0.08), y: from.y + dir.y * (vLen + 0.08) }, `v = ${fmt(Math.abs(body.v))} m/s`, {
        size: 11,
        color: PALETTE.velocity,
        align: dir.x >= 0 ? 'left' : 'right',
      }),
    );
  }

  prims.push(
    text({ x: box.maxX - 0.2, y: -0.62 }, `s 沿斜面向上为正 · 当前 s = ${fmtUnit(body.x, 'm')}`, {
      size: 11,
      color: PALETTE.muted,
      align: 'right',
    }),
  );

  return { primitives: prims, bodies: [{ id: BLOCK, label: '滑块', mass: mass(params), color: PALETTE.block }] };
}

export const inclineModel: ModelDefinition = {
  id: 'incline-block',
  name: '斜面滑块',
  category: '直线运动',
  summary: '固定斜面上的单滑块：可演示静止、上滑减速、下滑加速与到达斜面端点离开。',
  primaryBody: BLOCK,
  axisHint: 's 轴沿斜面向上为正',
  parameters,
  assumptions,
  observables,
  createDefaultParams,
  validate,
  axis: axisOf,
  init,
  accel,
  nextEvent,
  energy,
  frame,
  bounds,
};
