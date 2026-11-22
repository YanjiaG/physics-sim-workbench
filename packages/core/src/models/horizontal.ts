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
  blockPrimitive,
  clamp,
  fmt,
  forceArrowLength,
  groundHatch,
  makeForce,
  num,
  text,
  trajectory,
  velocityArrowLength,
} from './helpers';

const BLOCK = 'block';
const HALF_W = 0.4;
const HALF_H = 0.24;

const parameters: ParamSpec[] = [
  { key: 'mass_kg', label: '质量 m', unit: 'kg', group: 'object', type: 'number', default: 1, min: 0.1, max: 50, step: 0.1 },
  { key: 'gravity_m_s2', label: '重力加速度 g', unit: 'm/s²', group: 'environment', type: 'number', default: 9.8, min: 0.5, max: 20, step: 0.1, advanced: true },
  { key: 'mu_static', label: '静摩擦系数 μs', group: 'environment', type: 'number', default: 0.3, min: 0, max: 2, step: 0.01 },
  { key: 'mu_kinetic', label: '动摩擦系数 μk', group: 'environment', type: 'number', default: 0.2, min: 0, max: 2, step: 0.01 },
  { key: 'applied_force_N', label: '水平外力 F', unit: 'N', group: 'environment', type: 'number', default: 0, min: -500, max: 500, step: 0.5, hint: '正值指向 +x（右）' },
  { key: 'initial_position_m', label: '初始位置 x₀', unit: 'm', group: 'initial', type: 'number', default: 0, min: -200, max: 200, step: 0.1 },
  { key: 'initial_velocity_m_s', label: '初速度 v₀', unit: 'm/s', group: 'initial', type: 'number', default: 4, min: -100, max: 100, step: 0.1, hint: '正值向右' },
];

const assumptions: AssumptionSpec[] = [
  { key: 'fixed_ground', label: '水平面固定且足够长', locked: true },
  { key: 'point_mass', label: '物体视为质点，忽略转动', locked: true },
  { key: 'no_air', label: '忽略空气阻力', locked: true },
  { key: 'uniform_g', label: 'g 在场景内均匀', locked: true },
  { key: 'coulomb', label: '摩擦服从库仑模型（f ≤ μ·N）', note: '未建模静摩擦的微观黏滑' },
];

const observables: ObservableSpec[] = [
  { key: 'position', label: '位置 x', unit: 'm' },
  { key: 'velocity', label: '速度 v', unit: 'm/s' },
  { key: 'acceleration', label: '加速度 a', unit: 'm/s²' },
  { key: 'friction', label: '摩擦力 f', unit: 'N' },
  { key: 'energy', label: '动能 Ek', unit: 'J' },
];

function mass(params: Params): number {
  return num(params, 'mass_kg', 1);
}
function gravity(params: Params): number {
  return num(params, 'gravity_m_s2', 9.8);
}
function muStatic(params: Params): number {
  return num(params, 'mu_static', 0.3);
}
function muKinetic(params: Params): number {
  return num(params, 'mu_kinetic', 0.2);
}
function applied(params: Params): number {
  return num(params, 'applied_force_N', 0);
}

function createDefaultParams(): Params {
  return {
    mass_kg: 1,
    gravity_m_s2: 9.8,
    mu_static: 0.3,
    mu_kinetic: 0.2,
    applied_force_N: 0,
    initial_position_m: 0,
    initial_velocity_m_s: 4,
  };
}

function validate(params: Params): Issue[] {
  const issues: Issue[] = [];
  if (mass(params) <= 0) issues.push({ level: 'error', key: 'mass_kg', message: '质量必须大于 0。' });
  if (gravity(params) <= 0) issues.push({ level: 'error', key: 'gravity_m_s2', message: '重力加速度必须大于 0。' });
  if (muKinetic(params) < 0) issues.push({ level: 'error', key: 'mu_kinetic', message: '动摩擦系数不能为负。' });
  if (muStatic(params) < 0) issues.push({ level: 'error', key: 'mu_static', message: '静摩擦系数不能为负。' });
  if (muStatic(params) < muKinetic(params)) {
    issues.push({
      level: 'warning',
      key: 'mu_static',
      message: '静摩擦系数小于动摩擦系数。计算按两者独立处理，但真实材料通常 μs ≥ μk。',
    });
  }
  return issues;
}

function init(params: Params): ModelState {
  const v0 = num(params, 'initial_velocity_m_s', 0);
  const x0 = num(params, 'initial_position_m', 0);
  return {
    time: 0,
    bodies: { [BLOCK]: { x: x0, v: v0 } },
    mode: Math.abs(v0) > EPS ? 'sliding' : 'rest',
  };
}

function buildForces(params: Params, mode: 'rest' | 'sliding', sgn: number): Force[] {
  const m = mass(params);
  const g = gravity(params);
  const weight = m * g;
  const f = applied(params);
  const forces: Force[] = [
    makeForce('gravity', 'G', weight, { x: 0, y: -1 }, BLOCK, 'g'),
    makeForce('normal', 'N', weight, { x: 0, y: 1 }, BLOCK, 'n'),
  ];
  if (Math.abs(f) > EPS) {
    forces.push(makeForce('applied', 'F', Math.abs(f), { x: Math.sign(f), y: 0 }, BLOCK, 'applied'));
  }
  if (mode === 'rest') {
    if (Math.abs(f) > EPS) {
      forces.push(makeForce('friction', 'f静', Math.abs(f), { x: -Math.sign(f), y: 0 }, BLOCK, 'friction'));
    }
  } else {
    const fk = muKinetic(params) * weight;
    if (fk > EPS) {
      forces.push(makeForce('friction', 'f', fk, { x: -sgn, y: 0 }, BLOCK, 'friction'));
    }
  }
  return forces;
}

function accel(state: ModelState, params: Params): Acceleration {
  const m = mass(params);
  const g = gravity(params);
  const weight = m * g;
  const f = applied(params);
  const body = state.bodies[BLOCK] ?? { x: 0, v: 0 };
  const maxStatic = muStatic(params) * weight;
  const sliding = Math.abs(body.v) > EPS;

  if (!sliding && Math.abs(f) <= maxStatic + EPS) {
    return {
      bodies: { [BLOCK]: 0 },
      mode: 'rest',
      label: `静止：|F| = ${fmt(Math.abs(f))} N ≤ 最大静摩擦 ${fmt(maxStatic)} N，加速度为 0`,
      forces: buildForces(params, 'rest', 0),
      heat: [],
    };
  }

  const sgn = sliding ? Math.sign(body.v) : Math.sign(f) || 1;
  const fk = muKinetic(params) * weight;
  const a = (f - sgn * fk) / m;
  const label = sliding
    ? `${sgn > 0 ? '向右' : '向左'}滑动：a = (F − ${sgn > 0 ? '+' : '−'}f) / m = ${fmt(a)} m/s²`
    : `外力超过最大静摩擦，开始${sgn > 0 ? '向右' : '向左'}滑动：a = ${fmt(a)} m/s²`;

  return {
    bodies: { [BLOCK]: a },
    mode: 'sliding',
    label,
    forces: buildForces(params, 'sliding', sgn),
    heat: fk > EPS ? [{ magnitude: fk, bodyId: BLOCK, ref: { kind: 'ground' } }] : [],
  };
}

function nextEvent(state: ModelState, params: Params, accelResult: Acceleration, deadline: number): EventCandidate | null {
  const body = state.bodies[BLOCK];
  if (!body) return null;
  const a = accelResult.bodies[BLOCK] ?? 0;
  if (Math.abs(body.v) <= EPS || Math.abs(a) <= EPS || body.v * a >= 0) return null;

  const tEvent = state.time + -body.v / a;
  if (tEvent <= state.time + EPS || tEvent > deadline + EPS) return null;

  const m = mass(params);
  const g = gravity(params);
  const maxStatic = muStatic(params) * m * g;
  const f = applied(params);
  const holds = Math.abs(f) <= maxStatic + EPS;
  const direction = Math.sign(f) > 0 ? '向右' : '向左';

  return {
    time: tEvent,
    kind: holds ? 'stop' : 'reverse',
    title: holds ? '停止' : '反向',
    bodyIds: [BLOCK],
    detail: holds
      ? `速度降为 0；外力 ${fmt(Math.abs(f))} N 未超过最大静摩擦 ${fmt(maxStatic)} N，物体保持静止。`
      : `速度降为 0；外力 ${fmt(Math.abs(f))} N 超过最大静摩擦 ${fmt(maxStatic)} N，物体随即${direction}反向。`,
    apply: (s) => ({
      ...s,
      bodies: { ...s.bodies, [BLOCK]: { x: s.bodies[BLOCK]?.x ?? 0, v: 0 } },
      mode: holds ? 'rest' : 'sliding',
    }),
  };
}

function energy(state: ModelState, params: Params): number {
  const body = state.bodies[BLOCK];
  if (!body) return 0;
  return 0.5 * mass(params) * body.v * body.v;
}

function bounds(params: Params, run: Run): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const segment of run.segments) {
    const motion = segment.bodies[BLOCK];
    if (!motion) continue;
    const dt = segment.t1 - segment.t0;
    const x1 = motion.x0 + motion.v0 * dt + 0.5 * motion.a * dt * dt;
    minX = Math.min(minX, motion.x0, x1);
    maxX = Math.max(maxX, motion.x0, x1);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 0;
  }
  const arrowRoom = Math.min(
    Math.max(mass(params) * gravity(params), Math.abs(applied(params))) * FORCE_ARROW_SCALE,
    2.6,
  );
  const maxY = clamp(HALF_H * 2 + arrowRoom + 1.0, 1.8, 3.6);
  return { minX: minX - 1.0, maxX: Math.max(maxX + 1.5, minX + 3.4), minY: -1.05, maxY };
}

function frame(params: Params, run: Run, t: number): SceneFrame {
  const m = mass(params);
  const st = stateAt(run, t);
  const body = st.bodies[BLOCK] ?? { x: 0, v: 0, a: 0 };
  const box = bounds(params, run);
  const prims: Primitive[] = [];

  prims.push({ type: 'line', a: { x: box.minX, y: 0 }, b: { x: box.maxX, y: 0 }, color: PALETTE.ground, width: 2.5 });
  prims.push(...groundHatch(box.minX, box.maxX, 0, 0.24, 0.5));

  const trackPoints = trajectory(run, t, BLOCK, (x) => ({ x, y: 0.04 }));
  if (trackPoints.length > 1) {
    prims.push({ type: 'polyline', pts: trackPoints, color: PALETTE.trajectory, width: 1.6, dash: true });
  }

  const x0 = num(params, 'initial_position_m', 0);
  prims.push({ type: 'line', a: { x: x0, y: 0 }, b: { x: x0, y: HALF_H * 2 + 0.35 }, color: PALETTE.marker, width: 1, dash: true });
  prims.push(text({ x: x0, y: HALF_H * 2 + 0.52 }, `x₀ = ${fmt(x0)} m`, { size: 11, color: PALETTE.marker, align: 'center' }));

  prims.push({ type: 'arrow', from: { x: box.maxX - 1.2, y: -0.36 }, to: { x: box.maxX - 0.15, y: -0.36 }, color: PALETTE.muted, width: 1.4, label: '+x', labelSide: 'below' });

  const center: Pt = { x: body.x, y: HALF_H };
  prims.push(blockPrimitive(center, HALF_W * 2, HALF_H * 2, 0));
  prims.push(text({ x: body.x, y: HALF_H }, `m = ${fmt(m)} kg`, { size: 10, align: 'center', weight: 600, color: PALETTE.white }));

  for (const force of st.forces) {
    const length = Math.min(Math.max(forceArrowLength(force.magnitude), 0.34), 0.95);
    if (length <= EPS) continue;
    const from: Pt =
      force.kind === 'gravity'
        ? { x: body.x, y: 0 }
        : force.kind === 'normal'
          ? { x: body.x - 0.22, y: HALF_H * 2 }
          : force.kind === 'friction'
            ? { x: body.x + force.dir.x * HALF_W, y: 0.02 }
            : { x: body.x + force.dir.x * HALF_W, y: HALF_H };
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
      to: { x: from.x + force.dir.x * length, y: from.y + force.dir.y * length },
      color,
      width: 2,
    });
  }

  const vLen = velocityArrowLength(body.v);
  if (vLen > 0.02) {
    prims.push({
      type: 'arrow',
      from: { x: body.x + 0.06, y: HALF_H * 2 + 0.1 },
      to: { x: body.x + 0.06 + Math.sign(body.v) * vLen, y: HALF_H * 2 + 0.1 },
      color: PALETTE.velocity,
      width: 2.4,
    });
    prims.push(
      text({ x: body.x + 0.06 + Math.sign(body.v) * (vLen + 0.1), y: HALF_H * 2 + 0.1 }, `v = ${fmt(Math.abs(body.v))} m/s`, {
        size: 11,
        color: PALETTE.velocity,
        align: Math.sign(body.v) > 0 ? 'left' : 'right',
      }),
    );
  }

  return {
    primitives: prims,
    bodies: [{ id: BLOCK, label: '滑块', mass: m, color: PALETTE.block }],
  };
}

export const horizontalModel: ModelDefinition = {
  id: 'horizontal-block',
  name: '水平面滑块',
  category: '直线运动',
  summary: '水平固定平面上受外力、静摩擦与动摩擦作用的单滑块；可演示静止平衡、匀减速停止与反向。',
  primaryBody: BLOCK,
  axisHint: 'x 轴水平向右为正',
  parameters,
  assumptions,
  observables,
  createDefaultParams,
  validate,
  axis: () => ({ x: 1, y: 0 }),
  init,
  accel,
  nextEvent,
  energy,
  frame,
  bounds,
};
