import type {
  Acceleration,
  AssumptionSpec,
  Bounds,
  EventCandidate,
  Force,
  HeatTerm,
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
const BOARD = 'board';
const HALF_W = 0.34;
const HALF_H = 0.2;
const BOARD_H = 0.14;

const parameters: ParamSpec[] = [
  { key: 'mass_block_kg', label: '滑块质量 m₁', unit: 'kg', group: 'object', type: 'number', default: 1, min: 0.1, max: 50, step: 0.1 },
  { key: 'mass_board_kg', label: '木板质量 m₂', unit: 'kg', group: 'object', type: 'number', default: 2, min: 0.1, max: 50, step: 0.1 },
  { key: 'board_length_m', label: '木板长度 L', unit: 'm', group: 'object', type: 'number', default: 12, min: 0.5, max: 40, step: 0.5 },
  { key: 'gravity_m_s2', label: '重力加速度 g', unit: 'm/s²', group: 'environment', type: 'number', default: 9.8, min: 0.5, max: 20, step: 0.1, advanced: true },
  { key: 'mu_static_bb', label: '滑块-木板 μs', group: 'environment', type: 'number', default: 0.3, min: 0, max: 2, step: 0.01 },
  { key: 'mu_kinetic_bb', label: '滑块-木板 μk', group: 'environment', type: 'number', default: 0.2, min: 0, max: 2, step: 0.01 },
  { key: 'mu_static_ground', label: '木板-地面 μs', group: 'environment', type: 'number', default: 0.1, min: 0, max: 2, step: 0.01 },
  { key: 'mu_kinetic_ground', label: '木板-地面 μk', group: 'environment', type: 'number', default: 0.08, min: 0, max: 2, step: 0.01 },
  { key: 'applied_force_N', label: '水平外力 F', unit: 'N', group: 'environment', type: 'number', default: 0, min: -500, max: 500, step: 0.5, hint: '作用在滑块上，正值指向 +x' },
  { key: 'initial_offset_m', label: '初始相对位置 s₀', unit: 'm', group: 'initial', type: 'number', default: 0, min: 0, max: 40, step: 0.1, hint: '滑块距木板左端的距离，0 表示位于左端' },
  { key: 'initial_velocity_block_m_s', label: '滑块初速度 v₁', unit: 'm/s', group: 'initial', type: 'number', default: 6, min: -60, max: 60, step: 0.1 },
  { key: 'initial_velocity_board_m_s', label: '木板初速度 v₂', unit: 'm/s', group: 'initial', type: 'number', default: 0, min: -60, max: 60, step: 0.1 },
];

const assumptions: AssumptionSpec[] = [
  { key: 'flat', label: '地面水平且固定', locked: true },
  { key: 'rigid', label: '滑块与木板均为刚体，木板不弯曲', locked: true },
  { key: 'vertical', label: '竖直方向始终平衡：木板受地面支持力 (m₁+m₂)g', note: '因此竖直方向不出现弹跳' },
  { key: 'coulomb', label: '两处接触均服从库仑摩擦', locked: true },
  { key: 'edge', label: '滑块相对木板滑到两端即离开，之后不再模拟', note: '离开后木板仍可能继续运动，但本模型提前结束' },
];

const observables: ObservableSpec[] = [
  { key: 'position_block', label: '滑块位置 x₁', unit: 'm' },
  { key: 'position_board', label: '木板左端 x₂', unit: 'm' },
  { key: 'velocity_block', label: '滑块速度 v₁', unit: 'm/s' },
  { key: 'velocity_board', label: '木板速度 v₂', unit: 'm/s' },
  { key: 'relative', label: '相对位移 s', unit: 'm' },
  { key: 'energy', label: '总动能 Ek', unit: 'J' },
];

function m1(params: Params): number {
  return num(params, 'mass_block_kg', 1);
}
function m2(params: Params): number {
  return num(params, 'mass_board_kg', 2);
}
function g(params: Params): number {
  return num(params, 'gravity_m_s2', 9.8);
}
function boardLength(params: Params): number {
  return num(params, 'board_length_m', 12);
}
function applied(params: Params): number {
  return num(params, 'applied_force_N', 0);
}
function maxStaticBB(params: Params): number {
  return num(params, 'mu_static_bb', 0.3) * m1(params) * g(params);
}
function kineticBB(params: Params): number {
  return num(params, 'mu_kinetic_bb', 0.2) * m1(params) * g(params);
}
function totalWeight(params: Params): number {
  return (m1(params) + m2(params)) * g(params);
}
function maxStaticGround(params: Params): number {
  return num(params, 'mu_static_ground', 0.1) * totalWeight(params);
}
function kineticGround(params: Params): number {
  return num(params, 'mu_kinetic_ground', 0.08) * totalWeight(params);
}

function createDefaultParams(): Params {
  return {
    mass_block_kg: 1,
    mass_board_kg: 2,
    board_length_m: 12,
    gravity_m_s2: 9.8,
    mu_static_bb: 0.3,
    mu_kinetic_bb: 0.2,
    mu_static_ground: 0.1,
    mu_kinetic_ground: 0.08,
    applied_force_N: 0,
    initial_offset_m: 0,
    initial_velocity_block_m_s: 6,
    initial_velocity_board_m_s: 0,
  };
}

function validate(params: Params): Issue[] {
  const issues: Issue[] = [];
  const s0 = num(params, 'initial_offset_m', 0);
  const length = boardLength(params);
  if (m1(params) <= 0 || m2(params) <= 0) issues.push({ level: 'error', message: '滑块与木板的质量都必须大于 0。' });
  if (g(params) <= 0) issues.push({ level: 'error', key: 'gravity_m_s2', message: '重力加速度必须大于 0。' });
  if (length <= 0) issues.push({ level: 'error', key: 'board_length_m', message: '木板长度必须大于 0。' });
  if (s0 < 0 || s0 > length) {
    issues.push({ level: 'error', key: 'initial_offset_m', message: `初始相对位置需满足 0 ≤ s₀ ≤ ${fmt(length)} m。` });
  }
  if (num(params, 'mu_static_bb', 0.3) < num(params, 'mu_kinetic_bb', 0.2)) {
    issues.push({ level: 'warning', key: 'mu_static_bb', message: '滑块-木板：静摩擦系数小于动摩擦系数。' });
  }
  if (num(params, 'mu_static_ground', 0.1) < num(params, 'mu_kinetic_ground', 0.08)) {
    issues.push({ level: 'warning', key: 'mu_static_ground', message: '木板-地面：静摩擦系数小于动摩擦系数。' });
  }
  for (const key of ['mu_static_bb', 'mu_kinetic_bb', 'mu_static_ground', 'mu_kinetic_ground']) {
    if (num(params, key, 0.2) < 0) issues.push({ level: 'error', key, message: '摩擦系数不能为负。' });
  }
  if (s0 === 0) {
    issues.push({ level: 'warning', key: 'initial_offset_m', message: '滑块位于木板左端，若相对速度向左会立即离开木板。' });
  }
  return issues;
}

function init(params: Params): ModelState {
  const s0 = num(params, 'initial_offset_m', 0);
  const v1 = num(params, 'initial_velocity_block_m_s', 6);
  const v2 = num(params, 'initial_velocity_board_m_s', 0);
  return {
    time: 0,
    bodies: { [BLOCK]: { x: s0, v: v1 }, [BOARD]: { x: 0, v: v2 } },
    mode: Math.abs(v1 - v2) > EPS ? 'slip' : 'together',
  };
}

interface GroundResult {
  /** 有符号的地面摩擦力（+x 为正） */
  fg: number;
  kinetic: boolean;
}

/** 木板受到除地面摩擦外的驱动力 drive，判断地面摩擦能托住还是滑动 */
function groundFriction(drive: number, vBoard: number, params: Params): GroundResult {
  const fsMax = maxStaticGround(params);
  if (Math.abs(vBoard) > EPS) {
    return { fg: -Math.sign(vBoard) * kineticGround(params), kinetic: true };
  }
  if (Math.abs(drive) <= fsMax + EPS) return { fg: -drive, kinetic: false };
  return { fg: -Math.sign(drive) * kineticGround(params), kinetic: true };
}

interface Derived {
  a1: number;
  a2: number;
  mode: 'slip' | 'together' | 'stuck';
  label: string;
  fBlock: number;
  fBoard: number;
  fg: number;
  groundKinetic: boolean;
  heat: HeatTerm[];
}

/** 由瞬时速度推导加速度、模式与热源；纯函数，事件只在改变速度/位置后重新推导 */
function derive(params: Params, v1: number, v2: number): Derived {
  const F = applied(params);
  const vrel = v1 - v2;

  if (Math.abs(vrel) > EPS) {
    return slip(params, vrel > 0 ? 1 : -1, v2);
  }

  // 尝试整体运动
  const drive = F;
  const ground = groundFriction(drive, v2, params);
  const a = (F + ground.fg) / (m1(params) + m2(params));
  const fReq = m1(params) * a - F;
  if (Math.abs(fReq) <= maxStaticBB(params) + EPS) {
    const heat: HeatTerm[] = [];
    if (ground.kinetic) heat.push({ magnitude: Math.abs(ground.fg), bodyId: BOARD, ref: { kind: 'ground' } });
    const stuck = Math.abs(v2) <= EPS && Math.abs(a) <= EPS;
    return {
      a1: a,
      a2: a,
      mode: stuck ? 'stuck' : 'together',
      label: stuck
        ? '整体静止：地面静摩擦与外力平衡'
        : `整体运动：a = (F + f地) / (m₁+m₂) = ${fmt(a)} m/s²，f地 = ${fmt(ground.fg)} N`,
      fBlock: fReq,
      fBoard: -fReq,
      fg: ground.fg,
      groundKinetic: ground.kinetic,
      heat,
    };
  }

  // 界面静摩擦不足：即将发生相对滑动，方向由所需静摩擦的反号决定
  return slip(params, fReq > 0 ? -1 : 1, v2);
}

function slip(params: Params, sgn: number, v2: number): Derived {
  const F = applied(params);
  const fkBB = kineticBB(params);
  const fBlock = -sgn * fkBB;
  const fBoard = -fBlock;
  const ground = groundFriction(fBoard, v2, params);
  const a1 = (F + fBlock) / m1(params);
  const a2 = (fBoard + ground.fg) / m2(params);

  const heat: HeatTerm[] = [];
  if (fkBB > EPS) heat.push({ magnitude: fkBB, bodyId: BLOCK, ref: { kind: 'body', bodyId: BOARD } });
  if (ground.kinetic) heat.push({ magnitude: Math.abs(ground.fg), bodyId: BOARD, ref: { kind: 'ground' } });

  const boardStatic = Math.abs(a2) < 1e-9;
  return {
    a1,
    a2,
    mode: 'slip',
    label: boardStatic
      ? `相对滑动（木板被地面静摩擦托住）：a₁ = ${fmt(a1)} m/s²，a₂ = 0，f = ${fmt(fkBB)} N`
      : `相对滑动：a₁ = ${fmt(a1)} m/s²，a₂ = ${fmt(a2)} m/s²，f = ${fmt(fkBB)} N`,
    fBlock,
    fBoard,
    fg: ground.fg,
    groundKinetic: ground.kinetic,
    heat,
  };
}

function buildForces(params: Params, d: Derived): Force[] {
  const forces: Force[] = [
    makeForce('gravity', 'G₁', m1(params) * g(params), { x: 0, y: -1 }, BLOCK, 'g1'),
    makeForce('normal', 'N₁', m1(params) * g(params), { x: 0, y: 1 }, BLOCK, 'n1'),
    makeForce('gravity', 'G₂', m2(params) * g(params), { x: 0, y: -1 }, BOARD, 'g2'),
    makeForce('normal', 'N地', totalWeight(params), { x: 0, y: 1 }, BOARD, 'ng'),
  ];
  if (Math.abs(applied(params)) > EPS) {
    forces.push(makeForce('applied', 'F', Math.abs(applied(params)), { x: Math.sign(applied(params)), y: 0 }, BLOCK, 'applied'));
  }
  if (Math.abs(d.fBlock) > EPS) {
    forces.push(makeForce('friction', 'f₁₂', Math.abs(d.fBlock), { x: Math.sign(d.fBlock), y: 0 }, BLOCK, 'f12'));
    forces.push(makeForce('friction', 'f₂₁', Math.abs(d.fBoard), { x: Math.sign(d.fBoard), y: 0 }, BOARD, 'f21'));
  }
  if (Math.abs(d.fg) > EPS) {
    forces.push(makeForce('friction', 'f地', Math.abs(d.fg), { x: Math.sign(d.fg), y: 0 }, BOARD, 'fg'));
  }
  // 板受滑块的竖直压力（与 N₁ 大小相等，作用在木板上）
  forces.push(makeForce('normal', 'N₁′', m1(params) * g(params), { x: 0, y: -1 }, BOARD, 'p1'));
  return forces;
}

function accel(state: ModelState, params: Params): Acceleration {
  const b1 = state.bodies[BLOCK] ?? { x: 0, v: 0 };
  const b2 = state.bodies[BOARD] ?? { x: 0, v: 0 };
  const d = derive(params, b1.v, b2.v);
  return {
    bodies: { [BLOCK]: d.a1, [BOARD]: d.a2 },
    mode: d.mode,
    label: d.label,
    forces: buildForces(params, d),
    heat: d.heat,
  };
}

function nextEvent(state: ModelState, params: Params, accelResult: Acceleration, deadline: number): EventCandidate | null {
  const b1 = state.bodies[BLOCK];
  const b2 = state.bodies[BOARD];
  if (!b1 || !b2) return null;
  const a1 = accelResult.bodies[BLOCK] ?? 0;
  const a2 = accelResult.bodies[BOARD] ?? 0;
  const length = boardLength(params);
  const candidates: EventCandidate[] = [];

  const vrel = b1.v - b2.v;
  const arel = a1 - a2;
  if (Math.abs(vrel) > EPS && Math.abs(arel) > EPS && vrel * arel < 0) {
    const dtSync = -vrel / arel;
    const tSync = state.time + dtSync;
    if (tSync > state.time + EPS && tSync <= deadline + EPS) {
      const vCommon = b1.v + a1 * dtSync;
      // 共速时两者速度都为 0，语义上是「一起停下」而不是「达到共同速度」
      const bothStop = Math.abs(vCommon) <= EPS;
      candidates.push({
        time: tSync,
        kind: bothStop ? 'stop' : 'sync',
        title: bothStop ? '滑块与木板一起停下' : '达到共速',
        bodyIds: [BLOCK, BOARD],
        detail: bothStop
          ? '滑块相对木板滑动到速度同为 0，界面静摩擦足以让两者保持相对静止，系统停在原处。'
          : '滑块与木板速度相等，相对滑动停止；之后是否继续一起运动由界面静摩擦与地面摩擦决定。',
        apply: (s) => {
          const v1 = s.bodies[BLOCK]?.v ?? 0;
          const v2 = s.bodies[BOARD]?.v ?? 0;
          const common = (v1 + v2) / 2;
          return {
            ...s,
            bodies: { ...s.bodies, [BLOCK]: { x: s.bodies[BLOCK]?.x ?? 0, v: common }, [BOARD]: { x: s.bodies[BOARD]?.x ?? 0, v: common } },
            mode: 'together',
          };
        },
      });
    }
  }

  if (Math.abs(b2.v) > EPS && Math.abs(a2) > EPS && b2.v * a2 < 0) {
    const tStop = state.time + -b2.v / a2;
    if (tStop > state.time + EPS && tStop <= deadline + EPS) {
      candidates.push({
        time: tStop,
        kind: 'stop',
        title: '木板停止',
        bodyIds: [BOARD],
        detail: '木板速度降为 0；地面摩擦能否让它停住，取决于滑块对它的摩擦力是否超过最大静摩擦。',
        apply: (s) => ({
          ...s,
          bodies: { ...s.bodies, [BOARD]: { x: s.bodies[BOARD]?.x ?? 0, v: 0 } },
          mode: s.mode,
        }),
      });
    }
  }

  for (const target of [0, length]) {
    const tEdge = timeToReach(target, b1.x - b2.x, vrel, arel);
    if (tEdge === null) continue;
    const tAbs = state.time + tEdge;
    if (tAbs > deadline + EPS) continue;
    const left = target === 0;
    candidates.push({
      time: tAbs,
      kind: 'leave',
      title: left ? '滑块从左端离开木板' : '滑块从右端离开木板',
      bodyIds: [BLOCK],
      terminal: true,
      detail: `滑块相对木板滑到${left ? '左端' : '右端'}（s = ${fmt(target)} m），离开木板，模拟结束。`,
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
  const b1 = state.bodies[BLOCK];
  const b2 = state.bodies[BOARD];
  return 0.5 * m1(params) * (b1?.v ?? 0) ** 2 + 0.5 * m2(params) * (b2?.v ?? 0) ** 2;
}

function bounds(params: Params, run: Run): Bounds {
  const length = boardLength(params);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const segment of run.segments) {
    const bm = segment.bodies[BOARD];
    const km = segment.bodies[BLOCK];
    if (!bm || !km) continue;
    const dt = segment.t1 - segment.t0;
    const boardX1 = bm.x0 + bm.v0 * dt + 0.5 * bm.a * dt * dt;
    const blockX1 = km.x0 + km.v0 * dt + 0.5 * km.a * dt * dt;
    minX = Math.min(minX, bm.x0, boardX1);
    maxX = Math.max(maxX, bm.x0 + length, boardX1 + length, km.x0, blockX1);
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = length;
  }
  const arrowRoom = Math.min(Math.max(totalWeight(params), Math.abs(applied(params))) * FORCE_ARROW_SCALE, 2.6);
  return {
    minX: minX - 1.2,
    maxX: maxX + 1.6,
    minY: -0.9,
    maxY: clamp(BOARD_H + HALF_H * 2 + arrowRoom + 0.9, 1.8, 3.6),
  };
}

function frame(params: Params, run: Run, t: number): SceneFrame {
  const length = boardLength(params);
  const st = stateAt(run, t);
  const block = st.bodies[BLOCK] ?? { x: 0, v: 0, a: 0 };
  const board = st.bodies[BOARD] ?? { x: 0, v: 0, a: 0 };
  const box = bounds(params, run);
  const prims: Primitive[] = [];

  prims.push({ type: 'line', a: { x: box.minX, y: 0 }, b: { x: box.maxX, y: 0 }, color: PALETTE.ground, width: 2.5 });
  prims.push(...groundHatch(box.minX, box.maxX, 0, 0.22, 0.5));

  prims.push({
    type: 'rect',
    center: { x: board.x + length / 2, y: BOARD_H / 2 },
    w: length,
    h: BOARD_H,
    fill: PALETTE.board,
    stroke: PALETTE.boardEdge,
    lineWidth: 1.5,
    rx: 1,
  });
  prims.push({
    type: 'line',
    a: { x: board.x, y: BOARD_H },
    b: { x: board.x + length, y: BOARD_H },
    color: PALETTE.boardTop,
    width: 2,
  });

  const blockCenter: Pt = { x: block.x, y: BOARD_H + HALF_H };
  prims.push(blockPrimitive(blockCenter, HALF_W * 2, HALF_H * 2, 0));
  prims.push(
    text({ x: block.x - HALF_W - 0.14, y: BOARD_H + HALF_H - 0.02 }, `m₁ = ${fmt(m1(params))} kg`, {
      size: 11,
      align: 'right',
      weight: 600,
    }),
  );
  prims.push(text({ x: board.x + length / 2, y: -0.5 }, `m₂ = ${fmt(m2(params))} kg · L = ${fmt(length)} m`, { size: 11, align: 'center', color: PALETTE.muted }));

  const rel = block.x - board.x;
  prims.push(
    text({ x: box.minX + 0.15, y: -0.5 }, `s = ${fmt(rel)} m（滑块相对木板）`, {
      size: 11,
      align: 'left',
      color: PALETTE.marker,
    }),
  );

  for (const force of st.forces) {
    const len = Math.min(Math.max(forceArrowLength(force.magnitude), 0.3), 1.1);
    if (len <= EPS) continue;
    let from: Pt = blockCenter;
    if (force.kind === 'gravity' && force.on === BOARD) from = { x: board.x + length * 0.5, y: BOARD_H / 2 };
    else if (force.kind === 'normal' && force.on === BOARD && force.label === 'N地') from = { x: board.x + length * 0.72, y: 0 };
    else if (force.kind === 'normal' && force.on === BOARD) from = { x: block.x, y: BOARD_H - 0.01 };
    else if (force.kind === 'gravity') from = blockCenter;
    else if (force.kind === 'normal') from = { x: block.x + 0.16, y: BOARD_H };
    else if (force.kind === 'friction' && force.on === BOARD) from = { x: board.x + length * 0.3, y: 0.02 };
    else if (force.kind === 'friction') from = { x: block.x - 0.16, y: BOARD_H + 0.03 };
    else from = { x: block.x, y: BOARD_H + HALF_H * 2 };

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
      width: force.on === BOARD && force.kind !== 'friction' ? 1.4 : 2,
    });
  }

  const v1Len = velocityArrowLength(block.v);
  if (v1Len > 0.02) {
    const from = { x: block.x, y: BOARD_H + HALF_H * 2 + 0.03 };
    prims.push({
      type: 'arrow',
      from,
      to: { x: from.x + Math.sign(block.v) * v1Len, y: from.y },
      color: PALETTE.velocity,
      width: 2.4,
      label: `v₁ = ${fmt(Math.abs(block.v))} m/s`,
      labelSide: 'above',
    });
  }
  const v2Len = velocityArrowLength(board.v);
  if (v2Len > 0.02) {
    const from = { x: board.x + length * 0.88, y: BOARD_H + 0.03 };
    prims.push({
      type: 'arrow',
      from,
      to: { x: from.x + Math.sign(board.v) * v2Len, y: from.y },
      color: PALETTE.velocity,
      width: 2,
      label: `v₂ = ${fmt(Math.abs(board.v))} m/s`,
      labelSide: 'above',
    });
  }

  return {
    primitives: prims,
    bodies: [
      { id: BLOCK, label: '滑块', mass: m1(params), color: PALETTE.block },
      { id: BOARD, label: '木板', mass: m2(params), color: PALETTE.board },
    ],
  };
}

export const boardModel: ModelDefinition = {
  id: 'board-block',
  name: '滑块与长木板',
  category: '多体与摩擦',
  summary: '滑块在可被地面摩擦托住（或滑动）的长木板上运动：演示相对滑动、共速、整体运动与滑落。',
  primaryBody: BLOCK,
  axisHint: 'x 轴水平向右为正；s = x₁ − x₂ 为滑块相对木板左端的位移',
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
