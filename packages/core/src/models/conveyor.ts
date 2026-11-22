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
  timeToReach,
  velocityArrowLength,
} from './helpers';

const BLOCK = 'block';
const HALF_W = 0.34;
const HALF_H = 0.2;
const BELT_TOP = 0.42;
const BELT_BOTTOM = 0.28;

const parameters: ParamSpec[] = [
  { key: 'mass_kg', label: '质量 m', unit: 'kg', group: 'object', type: 'number', default: 1, min: 0.1, max: 50, step: 0.1 },
  { key: 'belt_length_m', label: '传送带长度 L', unit: 'm', group: 'object', type: 'number', default: 10, min: 1, max: 40, step: 0.5 },
  { key: 'belt_speed_m_s', label: '带速 v带', unit: 'm/s', group: 'environment', type: 'number', default: 2, min: -20, max: 20, step: 0.1, hint: '正值表示带面沿 +x 运动' },
  { key: 'gravity_m_s2', label: '重力加速度 g', unit: 'm/s²', group: 'environment', type: 'number', default: 9.8, min: 0.5, max: 20, step: 0.1, advanced: true },
  { key: 'mu_static', label: '静摩擦系数 μs', group: 'environment', type: 'number', default: 0.3, min: 0, max: 2, step: 0.01 },
  { key: 'mu_kinetic', label: '动摩擦系数 μk', group: 'environment', type: 'number', default: 0.2, min: 0, max: 2, step: 0.01 },
  { key: 'applied_force_N', label: '水平外力 F', unit: 'N', group: 'environment', type: 'number', default: 0, min: -500, max: 500, step: 0.5, hint: '作用在滑块上，正值指向 +x' },
  { key: 'initial_position_m', label: '初始位置 s₀', unit: 'm', group: 'initial', type: 'number', default: 0, min: 0, max: 40, step: 0.1, hint: '从传送带左端量起' },
  { key: 'initial_velocity_m_s', label: '初速度 v₀', unit: 'm/s', group: 'initial', type: 'number', default: 0, min: -40, max: 40, step: 0.1 },
];

const assumptions: AssumptionSpec[] = [
  { key: 'constant_belt', label: '传送带速度恒定（由电机维持）', locked: true },
  { key: 'flat', label: '传送带水平，带面平直', locked: true },
  { key: 'point_mass', label: '物体视为质点，忽略转动', locked: true },
  { key: 'coulomb', label: '带面摩擦服从库仑模型', locked: true },
  { key: 'edge', label: '滑块到达传送带两端即离开，之后不再模拟', note: '离开后的运动（如落入料斗）不在本模型内' },
];

const observables: ObservableSpec[] = [
  { key: 'position', label: '带面位置 s', unit: 'm' },
  { key: 'velocity', label: '速度 v', unit: 'm/s' },
  { key: 'relative', label: '相对带速 v − v带', unit: 'm/s' },
  { key: 'friction', label: '摩擦力 f', unit: 'N' },
  { key: 'energy', label: '动能 Ek', unit: 'J' },
];

function mass(params: Params): number {
  return num(params, 'mass_kg', 1);
}
function gravity(params: Params): number {
  return num(params, 'gravity_m_s2', 9.8);
}
function beltSpeed(params: Params): number {
  return num(params, 'belt_speed_m_s', 2);
}
function beltLength(params: Params): number {
  return num(params, 'belt_length_m', 10);
}
function applied(params: Params): number {
  return num(params, 'applied_force_N', 0);
}
function maxStatic(params: Params): number {
  return num(params, 'mu_static', 0.3) * mass(params) * gravity(params);
}
function kineticFriction(params: Params): number {
  return num(params, 'mu_kinetic', 0.2) * mass(params) * gravity(params);
}

function createDefaultParams(): Params {
  return {
    mass_kg: 1,
    belt_length_m: 10,
    belt_speed_m_s: 2,
    gravity_m_s2: 9.8,
    mu_static: 0.3,
    mu_kinetic: 0.2,
    applied_force_N: 0,
    initial_position_m: 0,
    initial_velocity_m_s: 0,
  };
}

function validate(params: Params): Issue[] {
  const issues: Issue[] = [];
  const s0 = num(params, 'initial_position_m', 0);
  const length = beltLength(params);
  if (mass(params) <= 0) issues.push({ level: 'error', key: 'mass_kg', message: '质量必须大于 0。' });
  if (gravity(params) <= 0) issues.push({ level: 'error', key: 'gravity_m_s2', message: '重力加速度必须大于 0。' });
  if (length <= 0) issues.push({ level: 'error', key: 'belt_length_m', message: '传送带长度必须大于 0。' });
  if (s0 < 0 || s0 > length) {
    issues.push({ level: 'error', key: 'initial_position_m', message: `初始位置需满足 0 ≤ s₀ ≤ ${fmt(length)} m。` });
  }
  if (num(params, 'mu_kinetic', 0.2) < 0 || num(params, 'mu_static', 0.3) < 0) {
    issues.push({ level: 'error', message: '摩擦系数不能为负。' });
  }
  if (num(params, 'mu_static', 0.3) < num(params, 'mu_kinetic', 0.2)) {
    issues.push({ level: 'warning', key: 'mu_static', message: '静摩擦系数小于动摩擦系数。计算按两者独立处理，但真实材料通常 μs ≥ μk。' });
  }
  if (s0 === 0) issues.push({ level: 'warning', key: 'initial_position_m', message: '滑块位于传送带左端，若向左运动会立即离开。' });
  return issues;
}

function init(params: Params): ModelState {
  const s0 = num(params, 'initial_position_m', 0);
  const v0 = num(params, 'initial_velocity_m_s', 0);
  const vb = beltSpeed(params);
  return {
    time: 0,
    bodies: { [BLOCK]: { x: s0, v: v0 } },
    mode: Math.abs(v0 - vb) > EPS ? 'slip' : 'synced',
  };
}

function buildForces(params: Params, mode: 'synced' | 'slip', sgn: number): Force[] {
  const weight = mass(params) * gravity(params);
  const forces: Force[] = [
    makeForce('gravity', 'G', weight, { x: 0, y: -1 }, BLOCK, 'g'),
    makeForce('normal', 'N', weight, { x: 0, y: 1 }, BLOCK, 'n'),
  ];
  if (Math.abs(applied(params)) > EPS) {
    forces.push(makeForce('applied', 'F', Math.abs(applied(params)), { x: Math.sign(applied(params)), y: 0 }, BLOCK, 'applied'));
  }
  if (mode === 'synced') {
    if (Math.abs(applied(params)) > EPS) {
      forces.push(makeForce('friction', 'f静', Math.abs(applied(params)), { x: -Math.sign(applied(params)), y: 0 }, BLOCK, 'friction'));
    }
  } else {
    const fk = kineticFriction(params);
    if (fk > EPS) forces.push(makeForce('friction', 'f', fk, { x: -sgn, y: 0 }, BLOCK, 'friction'));
  }
  return forces;
}

function accel(state: ModelState, params: Params): Acceleration {
  const m = mass(params);
  const vb = beltSpeed(params);
  const body = state.bodies[BLOCK] ?? { x: 0, v: 0 };
  const vrel = body.v - vb;
  const fk = kineticFriction(params);

  if (Math.abs(vrel) <= EPS && Math.abs(applied(params)) <= maxStatic(params) + EPS) {
    return {
      bodies: { [BLOCK]: 0 },
      mode: 'synced',
      label: `与传送带同步：v = v带 = ${fmt(vb)} m/s，静摩擦 ${fmt(Math.abs(applied(params)))} N`,
      forces: buildForces(params, 'synced', 0),
      heat: [],
    };
  }

  const sgn = Math.abs(vrel) > EPS ? Math.sign(vrel) : Math.sign(applied(params)) || 1;
  const a = (applied(params) - sgn * fk) / m;
  const relative = sgn > 0 ? '快于带速，摩擦力向后' : '慢于带速，摩擦力向前';
  return {
    bodies: { [BLOCK]: a },
    mode: 'slip',
    label: `相对滑动（${relative}）：a = (F − ${sgn > 0 ? '+' : '−'}f) / m = ${fmt(a)} m/s²`,
    forces: buildForces(params, 'slip', sgn),
    heat: fk > EPS ? [{ magnitude: fk, bodyId: BLOCK, ref: { kind: 'speed', v: vb } }] : [],
  };
}

function nextEvent(state: ModelState, params: Params, accelResult: Acceleration, deadline: number): EventCandidate | null {
  const body = state.bodies[BLOCK];
  if (!body) return null;
  const a = accelResult.bodies[BLOCK] ?? 0;
  const vb = beltSpeed(params);
  const length = beltLength(params);
  const vrel = body.v - vb;
  const candidates: EventCandidate[] = [];

  if (Math.abs(vrel) > EPS && Math.abs(a) > EPS && vrel * a < 0) {
    const tCross = state.time + -vrel / a;
    if (tCross > state.time + EPS && tCross <= deadline + EPS) {
      const holds = Math.abs(applied(params)) <= maxStatic(params) + EPS;
      candidates.push({
        time: tCross,
        kind: holds ? 'sync' : 'slip',
        title: holds ? '与传送带同步' : '越过带速（未能同步）',
        bodyIds: [BLOCK],
        detail: holds
          ? `速度达到带速 ${fmt(vb)} m/s；外力 ${fmt(Math.abs(applied(params)))} N 未超过最大静摩擦 ${fmt(maxStatic(params))} N，随后随带一起运动。`
          : `速度越过带速 ${fmt(vb)} m/s；外力 ${fmt(Math.abs(applied(params)))} N 超过最大静摩擦 ${fmt(maxStatic(params))} N，无法同步，摩擦力立即反向。`,
        apply: (s) => ({
          ...s,
          bodies: { ...s.bodies, [BLOCK]: { x: s.bodies[BLOCK]?.x ?? 0, v: holds ? vb : (s.bodies[BLOCK]?.v ?? vb) } },
          mode: holds ? 'synced' : 'slip',
        }),
      });
    }
  }

  for (const target of [0, length]) {
    const tEdge = timeToReach(target, body.x, body.v, a);
    if (tEdge === null) continue;
    const tAbs = state.time + tEdge;
    if (tAbs > deadline + EPS) continue;
    const atStart = target === 0;
    candidates.push({
      time: tAbs,
      kind: 'leave',
      title: atStart ? '从左端离开传送带' : '从右端离开传送带',
      bodyIds: [BLOCK],
      terminal: true,
      detail: `滑块到达传送带${atStart ? '左端' : '右端'}（s = ${fmt(target)} m），离开模型定义域，模拟结束。`,
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
  return 0.5 * mass(params) * body.v * body.v;
}

function bounds(params: Params, run: Run): Bounds {
  const length = beltLength(params);
  let minX = 0;
  let maxX = length;
  for (const segment of run.segments) {
    const motion = segment.bodies[BLOCK];
    if (!motion) continue;
    const dt = segment.t1 - segment.t0;
    const s1 = motion.x0 + motion.v0 * dt + 0.5 * motion.a * dt * dt;
    minX = Math.min(minX, motion.x0, s1);
    maxX = Math.max(maxX, motion.x0, s1);
  }
  const arrowRoom = Math.min(Math.max(mass(params) * gravity(params), Math.abs(applied(params))) * FORCE_ARROW_SCALE, 2.6);
  return {
    minX: Math.min(0, minX) - 1.1,
    maxX: Math.max(length, maxX) + 1.2,
    minY: -0.8,
    maxY: clamp(BELT_TOP + HALF_H * 2 + arrowRoom + 0.8, 1.8, 3.4),
  };
}

function frame(params: Params, run: Run, t: number): SceneFrame {
  const L = beltLength(params);
  const vb = beltSpeed(params);
  const st = stateAt(run, t);
  const body = st.bodies[BLOCK] ?? { x: 0, v: 0, a: 0 };
  const box = bounds(params, run);
  const prims: Primitive[] = [];

  // 支架与地面
  prims.push({ type: 'line', a: { x: box.minX, y: 0 }, b: { x: box.maxX, y: 0 }, color: PALETTE.ground, width: 2.5 });
  prims.push(...groundHatch(box.minX, box.maxX, 0, 0.2, 0.5));
  for (const cx of [L * 0.18, L * 0.82]) {
    prims.push({ type: 'line', a: { x: cx, y: 0 }, b: { x: cx, y: BELT_BOTTOM - 0.02 }, color: PALETTE.muted, width: 3 });
  }

  // 传送带带体与滚筒
  prims.push({
    type: 'rect',
    center: { x: L / 2, y: (BELT_TOP + BELT_BOTTOM) / 2 },
    w: L,
    h: BELT_TOP - BELT_BOTTOM,
    fill: PALETTE.belt,
    stroke: PALETTE.beltRoller,
    lineWidth: 1.5,
  });
  prims.push({ type: 'circle', center: { x: 0, y: (BELT_TOP + BELT_BOTTOM) / 2 }, r: (BELT_TOP - BELT_BOTTOM) / 2 + 0.04, fill: PALETTE.beltRoller, stroke: PALETTE.ground, lineWidth: 1.5 });
  prims.push({ type: 'circle', center: { x: L, y: (BELT_TOP + BELT_BOTTOM) / 2 }, r: (BELT_TOP - BELT_BOTTOM) / 2 + 0.04, fill: PALETTE.beltRoller, stroke: PALETTE.ground, lineWidth: 1.5 });

  // 带面斜纹随带运动，直观显示带速
  const stripeGap = 0.7;
  const offset = ((vb * t) % stripeGap + stripeGap) % stripeGap;
  for (let x = -stripeGap + offset; x < L + stripeGap; x += stripeGap) {
    const x0 = clamp(x, 0, L);
    const x1 = clamp(x + 0.16, 0, L);
    if (x1 <= x0) continue;
    prims.push({ type: 'line', a: { x: x0, y: BELT_BOTTOM + 0.02 }, b: { x: x1, y: BELT_TOP - 0.02 }, color: PALETTE.beltStripe, width: 2 });
  }

  prims.push(
    text({ x: L * 0.62, y: BELT_TOP + 0.2 }, `v带 = ${fmt(vb)} m/s ${vb >= 0 ? '→' : '←'}`, {
      size: 11,
      align: 'center',
      color: PALETTE.muted,
    }),
  );

  const track = [];
  const end = Math.min(t, run.duration_s);
  for (let i = 0; i <= 80; i++) {
    const time = (end * i) / 80;
    const sample = stateAt(run, time).bodies[BLOCK];
    if (sample) track.push({ x: sample.x, y: BELT_TOP + 0.02 });
  }
  if (track.length > 1) prims.push({ type: 'polyline', pts: track, color: PALETTE.trajectory, width: 1.6, dash: true });

  const center: Pt = { x: body.x, y: BELT_TOP + HALF_H };
  prims.push(blockPrimitive(center, HALF_W * 2, HALF_H * 2, 0));
  prims.push(
    text({ x: body.x, y: BELT_TOP + HALF_H }, `m = ${fmt(mass(params))} kg`, {
      size: 10,
      align: 'center',
      weight: 600,
      color: PALETTE.white,
    }),
  );

  for (const force of st.forces) {
    const len = Math.min(Math.max(forceArrowLength(force.magnitude), 0.34), 0.95);
    if (len <= EPS) continue;
    const from: Pt =
      force.kind === 'gravity'
        ? center
        : force.kind === 'normal'
          ? { x: body.x + 0.18, y: BELT_TOP }
          : force.kind === 'friction'
            ? { x: body.x - 0.18, y: BELT_TOP + 0.03 }
            : { x: body.x, y: BELT_TOP + HALF_H * 2 };
    prims.push({
      type: 'arrow',
      from,
      to: { x: from.x + force.dir.x * len, y: from.y + force.dir.y * len },
      color:
        force.kind === 'gravity'
          ? PALETTE.gravity
          : force.kind === 'normal'
            ? PALETTE.normal
            : force.kind === 'friction'
              ? PALETTE.friction
              : PALETTE.applied,
      width: 2,
    });
  }

  const vLen = velocityArrowLength(body.v);
  if (vLen > 0.02) {
    const from = { x: body.x, y: BELT_TOP + HALF_H * 2 + 0.03 };
    prims.push({
      type: 'arrow',
      from,
      to: { x: from.x + Math.sign(body.v) * vLen, y: from.y },
      color: PALETTE.velocity,
      width: 2.4,
      label: `v = ${fmt(Math.abs(body.v))} m/s`,
      labelSide: 'above',
    });
  }

  return {
    primitives: prims,
    bodies: [{ id: BLOCK, label: '滑块', mass: mass(params), color: PALETTE.block }],
  };
}

export const conveyorModel: ModelDefinition = {
  id: 'conveyor-block',
  name: '传送带上的滑块',
  category: '多体与摩擦',
  summary: '水平传送带以恒定带速运行：演示摩擦带动物体、达到带速后同步、外力过大时无法同步与到达端点离开。',
  primaryBody: BLOCK,
  axisHint: 's 轴沿带面指向右端为正；v带 为带面速度',
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
