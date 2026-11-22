import type { Bounds, ModelDefinition, Pt, Run, Scene, Segment, SimEvent, HeatTerm } from '../types';
import { EPS, SOLVER_VERSION } from '../types';

/** 稳定字符串哈希（FNV-1a 32 位），用于生成确定性的 runId */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function advanceBodies(
  state: { bodies: Record<string, { x: number; v: number }> },
  accel: Record<string, number>,
  dt: number,
): Record<string, { x: number; v: number }> {
  const next: Record<string, { x: number; v: number }> = {};
  for (const [id, body] of Object.entries(state.bodies)) {
    const a = accel[id] ?? 0;
    next[id] = {
      x: body.x + body.v * dt + 0.5 * a * dt * dt,
      v: body.v + a * dt,
    };
  }
  return next;
}

function displacement(motion: { x0: number; v0: number; a: number }, dt: number): number {
  return motion.v0 * dt + 0.5 * motion.a * dt * dt;
}

/** 单段内的摩擦生热：|f| × |相对位移| */
function segmentHeat(terms: HeatTerm[], dt: number, motions: Record<string, { x0: number; v0: number; a: number }>): number {
  let heat = 0;
  for (const term of terms) {
    const bodyMotion = motions[term.bodyId];
    if (!bodyMotion) continue;
    const dxBody = displacement(bodyMotion, dt);
    let dxRef = 0;
    if (term.ref.kind === 'body') {
      const refMotion = motions[term.ref.bodyId];
      if (!refMotion) continue;
      dxRef = displacement(refMotion, dt);
    } else if (term.ref.kind === 'speed') {
      dxRef = term.ref.v * dt;
    }
    heat += Math.abs(term.magnitude) * Math.abs(dxBody - dxRef);
  }
  return heat;
}

/** 单段内的功：沿模型轴的有符号力 × 位移（重力/支持力不计，重力已由势能表示） */
function segmentWork(
  forces: { kind: string; magnitude: number; dir: Pt; on: string }[],
  axis: Pt,
  dt: number,
  motions: Record<string, { x0: number; v0: number; a: number }>,
): { applied: number; friction: number } {
  let applied = 0;
  let friction = 0;
  for (const force of forces) {
    if (force.kind !== 'applied' && force.kind !== 'friction') continue;
    const motion = motions[force.on];
    if (!motion) continue;
    const signed = force.magnitude * (force.dir.x * axis.x + force.dir.y * axis.y);
    const work = signed * displacement(motion, dt);
    if (force.kind === 'applied') applied += work;
    else friction += work;
  }
  return { applied, friction };
}

/**
 * 通用分段求解器：模型只提供「当前加速度」与「下一个事件」，
 * 求解器负责推进、记录段、积分摩擦生热、汇总与自检。
 */
export function simulate(model: ModelDefinition, scene: Scene): Run {
  const params = scene.params;
  const deadline = scene.settings.duration_s;
  const axis = model.axis(params);
  const initialState = model.init(params);

  let state = { ...initialState, time: 0 };
  let t = 0;
  let endTime = deadline;
  let heat = 0;
  let workApplied = 0;
  let workFriction = 0;
  let guard = 0;
  const segments: Segment[] = [];
  const events: SimEvent[] = [];
  const warnings: string[] = [];

  const initialAccel = model.accel(state, params);
  events.push({
    t: 0,
    kind: 'start',
    title: '初始状态',
    detail: initialAccel.label,
  });

  while (t < deadline - EPS && guard++ < 200) {
    const accel = model.accel(state, params);
    const candidate = model.nextEvent(state, params, accel, deadline);
    const hasEvent = candidate !== null && candidate.time > t + EPS && candidate.time <= deadline + EPS;
    const tEnd = hasEvent ? Math.min(candidate!.time, deadline) : deadline;

    const dt = tEnd - t;
    const motions: Record<string, { x0: number; v0: number; a: number }> = {};
    for (const [id, body] of Object.entries(state.bodies)) {
      motions[id] = { x0: body.x, v0: body.v, a: accel.bodies[id] ?? 0 };
    }

    const segHeat = segmentHeat(accel.heat, dt, motions);
    const segWork = segmentWork(accel.forces, axis, dt, motions);

    const segment: Segment = {
      t0: t,
      t1: tEnd,
      label: accel.label,
      mode: accel.mode,
      bodies: motions,
      forces: accel.forces,
      heatStart: heat,
      heatEnd: heat + segHeat,
    };
    segments.push(segment);
    heat += segHeat;
    workApplied += segWork.applied;
    workFriction += segWork.friction;

    const endState = advanceBodies(state, accel.bodies, dt);

    if (hasEvent && candidate) {
      const next = candidate.apply({ ...state, bodies: endState, time: tEnd, mode: accel.mode });
      events.push({
        t: tEnd,
        kind: candidate.kind,
        title: candidate.title,
        detail: candidate.detail,
        ...(candidate.bodyIds ? { bodyIds: candidate.bodyIds } : {}),
      });
      state = { ...next, time: tEnd };
      t = tEnd;
      endTime = tEnd;
      if (candidate.terminal) break;
    } else {
      state = { ...state, bodies: endState, time: tEnd, mode: accel.mode };
      t = tEnd;
      endTime = tEnd;
      break;
    }
  }

  if (guard >= 200) {
    warnings.push('阶段数量超过上限，模拟被截断。请检查是否存在反复切换的临界参数。');
  }

  // 终态：若模型给了结束事件，末段的终点即事件时刻
  const finalBodies = state.bodies;
  const primary = model.primaryBody;
  const initialBody = initialState.bodies[primary];

  let totalDistance = 0;
  let maxSpeed = 0;
  for (const segment of segments) {
    const motion = segment.bodies[primary];
    if (motion) {
      totalDistance += Math.abs(displacement(motion, segment.t1 - segment.t0));
      maxSpeed = Math.max(maxSpeed, Math.abs(motion.v0), Math.abs(motion.v0 + motion.a * (segment.t1 - segment.t0)));
    }
  }
  if (maxSpeed === 0 && initialBody) maxSpeed = Math.abs(initialBody.v);

  const stopEvent = events.find((event) => event.kind === 'stop');
  const initialEnergy = model.energy(initialState, params);
  const finalEnergy = model.energy({ ...state, time: endTime }, params);

  const run: Run = {
    runId: '',
    sceneId: scene.sceneId,
    sceneRevision: scene.revision,
    modelId: model.id,
    solverVersion: SOLVER_VERSION,
    requested_duration_s: deadline,
    duration_s: endTime,
    segments,
    events,
    warnings,
    summary: {
      stop_time_s: stopEvent ? Number(stopEvent.t.toFixed(6)) : null,
      final_position_m: finalBodies[primary] ? Number(finalBodies[primary].x.toFixed(6)) : null,
      final_velocity_m_s: finalBodies[primary] ? Number(finalBodies[primary].v.toFixed(6)) : null,
      total_distance_m: Number(totalDistance.toFixed(6)),
      max_speed_m_s: Number(maxSpeed.toFixed(6)),
      friction_heat_J: Number(heat.toFixed(6)),
      initial_energy_J: Number(initialEnergy.toFixed(6)),
      final_energy_J: Number(finalEnergy.toFixed(6)),
      energy_residual_J: Number((initialEnergy + workApplied + workFriction - finalEnergy).toFixed(6)),
      extra: {
        applied_work_J: Number(workApplied.toFixed(6)),
        friction_work_J: Number(workFriction.toFixed(6)),
      },
    },
    createdAt: new Date().toISOString(),
  };

  run.runId = `run_${hashString(
    JSON.stringify({
      scene: scene.sceneId,
      revision: scene.revision,
      model: model.id,
      params: scene.params,
      duration: scene.settings.duration_s,
    }),
  )}`;

  return run;
}

// ---------------------------------------------------------------------------
// 求值与采样
// ---------------------------------------------------------------------------

export interface StateAtResult {
  t: number;
  segmentIndex: number;
  bodies: Record<string, { x: number; v: number; a: number }>;
  forces: Segment['forces'];
}

export function stateAt(run: Run, time: number): StateAtResult {
  const t = Math.min(Math.max(time, 0), run.duration_s);
  const segments = run.segments;
  if (segments.length === 0) {
    return { t, segmentIndex: -1, bodies: {}, forces: [] };
  }

  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if ((segments[mid]?.t0 ?? 0) <= t) lo = mid;
    else hi = mid - 1;
  }
  const segment = segments[lo] ?? segments[0]!;
  const dt = Math.max(0, t - segment.t0);
  const bodies: Record<string, { x: number; v: number; a: number }> = {};
  for (const [id, motion] of Object.entries(segment.bodies)) {
    bodies[id] = {
      x: motion.x0 + motion.v0 * dt + 0.5 * motion.a * dt * dt,
      v: motion.v0 + motion.a * dt,
      a: motion.a,
    };
  }
  return { t, segmentIndex: lo, bodies, forces: segment.forces };
}

export interface RunSamples {
  ts: number[];
  bodies: Record<string, { x: number[]; v: number[]; a: number[] }>;
}

/** 曲线采样：等距点 + 段边界 + 事件时刻；绘图使用，物理读数仍走 stateAt */
export function sampleRun(run: Run, count = 400): RunSamples {
  const times = new Set<number>();
  const steps = Math.max(2, Math.min(1200, count));
  for (let i = 0; i <= steps; i++) {
    times.add(Number(((run.duration_s * i) / steps).toFixed(6)));
  }
  for (const segment of run.segments) {
    times.add(Number(segment.t0.toFixed(6)));
    times.add(Number(segment.t1.toFixed(6)));
  }
  for (const event of run.events) times.add(Number(event.t.toFixed(6)));

  const ts = [...times].sort((a, b) => a - b);
  const bodyIds = Object.keys(run.segments[0]?.bodies ?? {});
  const bodies: RunSamples['bodies'] = {};
  for (const id of bodyIds) bodies[id] = { x: [], v: [], a: [] };

  for (const t of ts) {
    const state = stateAt(run, t);
    for (const id of bodyIds) {
      const body = state.bodies[id];
      const series = bodies[id]!;
      series.x.push(Number((body?.x ?? 0).toFixed(6)));
      series.v.push(Number((body?.v ?? 0).toFixed(6)));
      series.a.push(Number((body?.a ?? 0).toFixed(6)));
    }
  }
  return { ts, bodies };
}

/** 运行包络，用于相机适配 */
export function runBounds(model: ModelDefinition, scene: Scene, run: Run): Bounds {
  return model.bounds(scene.params, run);
}
