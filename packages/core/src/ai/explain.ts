import type { Run, Scene, Segment } from '../types';
import { getModel } from '../models';

function num(value: number, digits = 3): string {
  return Number(value.toFixed(digits)).toString();
}

function maybe(value: number | null, digits = 3): string {
  return value === null ? '—' : num(value, digits);
}

function bodySummary(seg: Segment): string {
  const body = seg.bodies['block'] ?? Object.values(seg.bodies)[0];
  if (!body) return '';
  const t1 = body.v0 + body.a * (seg.t1 - seg.t0);
  const dx = body.x0 + body.v0 * (seg.t1 - seg.t0) + 0.5 * body.a * (seg.t1 - seg.t0) ** 2 - body.x0;
  const motion =
    Math.abs(body.a) < 1e-6
      ? Math.abs(body.v0) < 1e-6
        ? '保持静止'
        : '做匀速运动'
      : body.a > 0
        ? '做匀加速运动'
        : '做匀减速运动';
  return `滑块${motion}，加速度 a = ${num(body.a)} m/s²，速度从 ${num(body.v0)} m/s 变为 ${num(t1)} m/s，位移 ${num(dx)} m`;
}

function eventSentence(event: { t: number; kind: string; title: string; detail: string }): string {
  const time = `t = ${num(event.t)} s`;
  switch (event.kind) {
    case 'start':
      return `${time}：${event.detail}。`;
    case 'stop':
      return `${time}：${event.title}，摩擦继续存在，但速度为零后不再产生滑动摩擦（静摩擦可以平衡外力）。`;
    case 'reverse':
      return `${time}：${event.title}，速度方向改变，滑动摩擦力也随之反向。`;
    case 'sync':
      return `${time}：${event.title}，${event.detail}，之后两者之间的相对运动消失。`;
    case 'slip':
      return `${time}：${event.title}，${event.detail}。`;
    case 'leave':
      return `${time}：${event.title}，${event.detail}。`;
    case 'end':
      return `${time}：${event.title}。`;
    default:
      return `${time}：${event.title} — ${event.detail}。`;
  }
}

/**
 * 模板化解释：所有数字都取自本次运行结果与场景参数，不引入新数值。
 * 没有 API 密钥时由它兜底，保证「解释」这一层永远可用。
 */
export function explainRun(run: Run, scene: Scene): string {
  const model = getModel(scene.modelId);
  const name = model?.name ?? scene.modelId;
  const summary = run.summary;
  const lines: string[] = [];

  const initial = run.segments[0];
  const firstBody = initial?.bodies['block'] ?? (initial ? Object.values(initial.bodies)[0] : undefined);
  lines.push(
    `这是「${name}」的一次运行：${firstBody ? `初始位置 x₀ = ${num(firstBody.x0)} m，初速度 v₀ = ${num(firstBody.v0)} m/s` : '初始条件见参数面板'}，模拟时长 ${num(run.duration_s, 2)} s。`,
  );

  if (run.segments.length > 0) {
    const parts: string[] = [];
    for (const seg of run.segments) {
      const text = bodySummary(seg);
      if (text) parts.push(`${num(seg.t0, 2)}–${num(seg.t1, 2)} s：${text}`);
    }
    if (parts.length > 0) lines.push(`运动过程：${parts.join('；')}。`);
  }

  const keyEvents = run.events.filter((event) => event.kind !== 'start' && event.kind !== 'end');
  if (keyEvents.length > 0) {
    lines.push(`关键时刻：${keyEvents.map((event) => eventSentence(event)).join(' ')}`);
  }

  const facts: string[] = [];
  if (summary.stop_time_s !== null) facts.push(`停止时间 ${num(summary.stop_time_s)} s`);
  facts.push(`末位置 ${maybe(summary.final_position_m)} m`);
  facts.push(`末速度 ${maybe(summary.final_velocity_m_s)} m/s`);
  if (summary.max_speed_m_s > 0) facts.push(`最大速率 ${num(summary.max_speed_m_s)} m/s`);
  facts.push(`总路程 ${num(summary.total_distance_m)} m`);
  lines.push(`结果：${facts.join('，')}。`);

  const energy: string[] = [];
  energy.push(`初动能 ${num(summary.initial_energy_J)} J`);
  energy.push(`末动能 ${num(summary.final_energy_J)} J`);
  if (summary.friction_heat_J > 0) energy.push(`摩擦生热 ${num(summary.friction_heat_J)} J`);
  const applied = Number(summary.extra['work_applied_J'] ?? 0);
  const frictionWork = Number(summary.extra['work_friction_J'] ?? 0);
  if (applied !== 0) energy.push(`外力做功 ${num(applied)} J`);
  if (frictionWork !== 0) energy.push(`摩擦力做功 ${num(frictionWork)} J`);
  energy.push(`能量闭合残差 ${num(summary.energy_residual_J)} J`);
  lines.push(`能量：${energy.join('，')}。`);

  if (run.warnings.length > 0) lines.push(`注意：${run.warnings.join(' ')}`);
  return lines.join('\n');
}
