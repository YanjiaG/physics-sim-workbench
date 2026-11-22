// 沙箱内可运行的物理正确性检查（vitest 需要创建子进程，在受限 sandbox 中会失败）。
// 用法：node --import ./scripts/register-ts.mjs scripts/verify-core.mjs
import {
  applyOps,
  createScene,
  diffScenes,
  explainRun,
  parseScene,
  previewProposal,
  proposeFromText,
  sampleRun,
  sceneToJSON,
  simulateScene,
  stateAt,
  validateScene,
} from '../packages/core/src/index.ts';

let failed = 0;
let passed = 0;

function check(label, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${label}\n      ${error.message}`);
  }
}

function close(actual, expected, tolerance, note = '') {
  if (typeof actual !== 'number' || Number.isNaN(actual)) {
    throw new Error(`期望 ${expected}，实际 ${String(actual)} ${note}`);
  }
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`期望 ${expected} ± ${tolerance}，实际 ${actual} ${note}`);
  }
}

function equal(actual, expected, note = '') {
  if (actual !== expected) throw new Error(`期望 ${String(expected)}，实际 ${String(actual)} ${note}`);
}

function sceneOf(modelId, params, duration = 8) {
  return createScene(modelId, { params, duration });
}

function section(title) {
  console.log(`\n${title}`);
}

section('水平面滑块');
{
  const run = simulateScene(sceneOf('horizontal-block', { applied_force_N: 0, mu_kinetic: 0.2, initial_velocity_m_s: 4 }, 4));
  check('H1 停止时间 2.040816 s', () => close(run.summary.stop_time_s, 2.040816, 2e-3));
  check('H1 停止位置 4.081633 m', () => close(run.summary.final_position_m, 4.081633, 2e-3));
  check('H1 末速度 0', () => close(run.summary.final_velocity_m_s, 0, 1e-6));
  check('H1 摩擦热 8 J', () => close(run.summary.friction_heat_J, 8, 1e-3));
  check('H1 能量残差 ≈ 0', () => close(run.summary.energy_residual_J, 0, 1e-6));
  check('H1 含 stop 事件', () => equal(run.events.some((event) => event.kind === 'stop'), true));
  check('H1 事件时间单调', () => {
    for (let i = 1; i < run.events.length; i += 1) {
      if (run.events[i].t < run.events[i - 1].t - 1e-9) throw new Error(`事件 ${i} 时间倒流`);
    }
  });
  check('H1 t=1 s 时 v=2.04、x=3.02', () => {
    const state = stateAt(run, 1);
    close(state.bodies.block.v, 2.04, 1e-6);
    close(state.bodies.block.x, 3.02, 1e-6);
    close(state.bodies.block.a, -1.96, 1e-9);
  });
}
{
  const run = simulateScene(
    sceneOf('horizontal-block', { applied_force_N: 2, mu_static: 0.3, mu_kinetic: 0.2, initial_velocity_m_s: 0 }, 2),
  );
  check('H2 保持静止', () => close(run.summary.final_position_m, 0, 1e-9));
  check('H2 只有一段', () => equal(run.segments.length, 1));
  check('H2 静摩擦力 2 N', () => {
    const friction = run.segments[0].forces.find((force) => force.kind === 'friction');
    close(friction.magnitude, 2, 1e-6);
  });
  check('H2 仅 start 事件', () => equal(run.events.length, 1));
}
{
  const run = simulateScene(
    sceneOf('horizontal-block', { applied_force_N: 5, mu_static: 0.3, mu_kinetic: 0.2, initial_velocity_m_s: 0 }, 2),
  );
  check('H3 加速度 3.04', () => close(run.segments[0].bodies.block.a, 3.04, 1e-9));
  check('H3 t=1 时 x=1.52、v=3.04', () => {
    const state = stateAt(run, 1);
    close(state.bodies.block.x, 1.52, 1e-6);
    close(state.bodies.block.v, 3.04, 1e-6);
  });
}
{
  const run = simulateScene(
    sceneOf('horizontal-block', { applied_force_N: -10, mu_kinetic: 0.2, initial_velocity_m_s: 4 }, 2),
  );
  check('H4 反向时刻 0.334448 s', () => {
    const reverse = run.events.find((event) => event.kind === 'reverse');
    close(reverse.t, 0.334448, 2e-4);
  });
  check('H4 第一段 a=-11.96', () => close(run.segments[0].bodies.block.a, -11.96, 1e-9));
  check('H4 t=1 时 v≈-5.351', () => close(stateAt(run, 1).bodies.block.v, -5.3511, 2e-3));
}

section('斜面滑块');
{
  const run = simulateScene(
    sceneOf('incline-block', { angle_deg: 30, mu_static: 0.3, mu_kinetic: 0.2, initial_position_m: 4, initial_velocity_m_s: 0 }, 4),
  );
  check('I1 a=-3.20259', () => close(run.segments[0].bodies.block.a, -3.20259, 1e-4));
  check('I1 到底 1.5803 s', () => {
    const leave = run.events.find((event) => event.kind === 'leave');
    close(leave.t, 1.5803, 2e-3);
  });
  check('I1 末速 -5.063', () => close(run.summary.final_velocity_m_s, -5.063, 5e-3));
}
{
  const run = simulateScene(
    sceneOf('incline-block', { angle_deg: 30, mu_kinetic: 0.2, initial_position_m: 0, initial_velocity_m_s: 5 }, 4),
  );
  check('I2 上滑 a=-6.59741', () => close(run.segments[0].bodies.block.a, -6.59741, 1e-4));
  check('I2 最高点 0.7579 s', () => {
    const stop = run.events.find((event) => event.kind === 'reverse' || event.kind === 'stop');
    if (!stop) throw new Error(`没有 reverse/stop 事件：${run.events.map((e) => e.kind).join(',')}`);
    close(stop.t, 0.7579, 2e-3);
  });
  check('I2 上行 1.8948 m', () => {
    const stop = run.events.find((event) => event.kind === 'reverse' || event.kind === 'stop');
    close(stateAt(run, stop.t).bodies.block.x, 1.8948, 2e-3);
  });
}
{
  const run = simulateScene(
    sceneOf('incline-block', { angle_deg: 10, mu_static: 0.3, mu_kinetic: 0.2, initial_position_m: 4, initial_velocity_m_s: 0 }, 2),
  );
  check('I3 静止', () => {
    equal(run.segments.length, 1);
    close(run.summary.final_position_m, 4, 1e-9);
  });
}
{
  const run = simulateScene(
    sceneOf('incline-block', { angle_deg: 45, mu_static: 0.5, mu_kinetic: 0.3, initial_position_m: 6, initial_velocity_m_s: 0 }, 2),
  );
  check('I4 a≈-4.851', () => close(run.segments[0].bodies.block.a, -4.851, 2e-3));
}

section('滑块与长木板');
{
  const run = simulateScene(
    sceneOf('board-block', {
      mass_block_kg: 1,
      mass_board_kg: 2,
      board_length_m: 12,
      mu_static_bb: 0.3,
      mu_kinetic_bb: 0.2,
      mu_static_ground: 0.1,
      mu_kinetic_ground: 0.08,
      initial_velocity_block_m_s: 6,
      initial_velocity_board_m_s: 0,
    }, 6),
  );
  check('B1 木板加速度 0', () => close(run.segments[0].bodies.board.a, 0, 1e-9));
  check('B1 滑块停止 3.0612 s', () => {
    const stop = run.events.find((event) => event.kind === 'stop');
    close(stop.t, 3.0612, 2e-3);
  });
  check('B1 摩擦热 18 J', () => close(run.summary.friction_heat_J, 18, 0.1));
  check('B1 滑块位移 9.1837 m', () => close(stateAt(run, 3.0612).bodies.block.x, 9.1837, 2e-2));
}
{
  const run = simulateScene(
    sceneOf('board-block', {
      mass_block_kg: 1,
      mass_board_kg: 1,
      board_length_m: 20,
      mu_static_bb: 0.3,
      mu_kinetic_bb: 0.2,
      mu_static_ground: 0.02,
      mu_kinetic_ground: 0.015,
      initial_velocity_block_m_s: 6,
      initial_velocity_board_m_s: 0,
    }, 8),
  );
  check('B2 共速 1.6547 s', () => {
    const sync = run.events.find((event) => event.kind === 'sync');
    close(sync.t, 1.6547, 2e-3);
  });
  check('B2 共速后 a=-0.147', () => {
    const index = run.segments.findIndex((segment) => segment.mode === 'together');
    if (index < 0) throw new Error(`没有 together 段，实际段落：${run.segments.map((s) => s.mode).join(',')}`);
    close(run.segments[index].bodies.block.a, -0.147, 1e-3);
  });
}
{
  const run = simulateScene(
    sceneOf('board-block', {
      mass_block_kg: 1,
      mass_board_kg: 2,
      board_length_m: 2,
      mu_static_bb: 0.3,
      mu_kinetic_bb: 0.2,
      mu_static_ground: 0.1,
      mu_kinetic_ground: 0.08,
      initial_velocity_block_m_s: 6,
      initial_velocity_board_m_s: 0,
    }, 4),
  );
  check('B3 离开 0.3538 s', () => {
    const leave = run.events.find((event) => event.kind === 'leave');
    close(leave.t, 0.3538, 2e-3);
  });
  check('B3 末速 5.3066', () => close(run.summary.final_velocity_m_s, 5.3066, 5e-3));
}

section('传送带上的滑块');
{
  const run = simulateScene(
    sceneOf('conveyor-block', { belt_speed_m_s: 2, mu_static: 0.3, mu_kinetic: 0.2, initial_velocity_m_s: 0, initial_position_m: 0 }, 3),
  );
  check('C1 同步 1.0204 s', () => {
    const sync = run.events.find((event) => event.kind === 'sync');
    close(sync.t, 1.0204, 2e-3);
  });
  check('C1 同步点 1.0204 m', () => close(stateAt(run, 1.0204).bodies.block.x, 1.0204, 2e-2));
  check('C1 t=3 时 s=4.98', () => close(stateAt(run, 3).bodies.block.x, 4.98, 2e-2));
}
{
  const run = simulateScene(
    sceneOf('conveyor-block', { belt_speed_m_s: -2, mu_static: 0.3, mu_kinetic: 0.2, initial_velocity_m_s: 0, initial_position_m: 3 }, 3),
  );
  check('C2 左端离开 2.0102 s', () => {
    const leave = run.events.find((event) => event.kind === 'leave');
    if (!leave) throw new Error(`没有 leave 事件：${run.events.map((e) => `${e.kind}@${e.t.toFixed(3)}`).join(',')}`);
    close(leave.t, 2.0102, 2e-3);
  });
}
{
  const run = simulateScene(
    sceneOf('conveyor-block', {
      belt_speed_m_s: 2,
      mu_static: 0.3,
      mu_kinetic: 0.2,
      applied_force_N: 5,
      initial_velocity_m_s: 0,
      initial_position_m: 0,
    }, 4),
  );
  check('C3 越过带速但未同步', () => {
    const slip = run.events.find((event) => event.kind === 'slip');
    if (!slip) throw new Error(`没有 slip 事件：${run.events.map((e) => `${e.kind}@${e.t.toFixed(3)}`).join(',')}`);
    close(slip.t, 0.2874, 2e-3);
    if (run.events.some((event) => event.kind === 'sync')) throw new Error('不应出现 sync 事件');
  });
}

section('求解器与场景不变量');
{
  const scene = createScene('horizontal-block', { duration: 4 });
  const a = simulateScene(scene);
  const b = simulateScene(scene);
  check('相同输入 runId 相同', () => equal(a.runId, b.runId));
  check('分段单调且非零长', () => {
    for (const segment of a.segments) {
      if (!(segment.t1 > segment.t0)) throw new Error(`零长分段 ${segment.t0}-${segment.t1}`);
    }
  });
  check('stateAt 在边界连续', () => {
    for (const segment of a.segments.slice(0, -1)) {
      const before = stateAt(a, segment.t1 - 1e-7).bodies.block;
      const after = stateAt(a, segment.t1 + 1e-7).bodies.block;
      close(after.x, before.x, 1e-4);
      close(after.v, before.v, 1e-4);
    }
  });
  check('sampleRun 时间单调且覆盖全过程', () => {
    const samples = sampleRun(a, 50);
    for (let i = 1; i < samples.ts.length; i += 1) {
      if (!(samples.ts[i] > samples.ts[i - 1])) throw new Error('采样时间非单调');
    }
    close(samples.ts[samples.ts.length - 1], a.duration_s, 1e-6);
  });
  check('场景 JSON 往返一致', () => {
    const parsed = parseScene(JSON.parse(sceneToJSON(createScene('board-block'))));
    if (!parsed.ok) throw new Error('解析失败');
  });
  check('非法参数返回错误而非异常', () => {
    const issues = validateScene({ ...scene, params: { ...scene.params, mass_kg: -1 } });
    if (!issues.some((issue) => issue.level === 'error')) throw new Error('未检出非法质量');
  });
  check('过期提案被拒绝', () => {
    const result = applyOps(scene, [{ op: 'set_param', key: 'mass_kg', value: 2 }], scene.revision - 1);
    if (result.ok) throw new Error('过期提案未被拒绝');
  });
  check('合法提案 revision+1 且 diff 正确', () => {
    const result = applyOps(scene, [{ op: 'set_param', key: 'mass_kg', value: 2 }], scene.revision);
    if (!result.ok) throw new Error(`提案被拒绝：${result.error}`);
    close(result.scene.revision, scene.revision + 1, 0);
    const diff = diffScenes(scene, result.scene);
    if (!diff.some((item) => item.key === 'mass_kg' && item.to === 2)) throw new Error('diff 缺少 mass_kg');
  });
  check('切换模型重置参数与时长', () => {
    const result = applyOps(scene, [{ op: 'switch_model', modelId: 'conveyor-block' }], scene.revision);
    if (!result.ok) throw new Error(`切换被拒绝：${result.error}`);
    close(result.scene.params.belt_speed_m_s, 2, 0);
    close(result.scene.settings.duration_s, 8, 0);
  });
}

section('AI 规则解析');
{
  const scene = createScene('horizontal-block', { duration: 6 });
  const quality = proposeFromText('把质量改成 2 kg', scene);
  check('识别「质量 2 kg」', () => {
    equal(quality.intent, 'modify');
    if (!quality.ops.some((op) => op.op === 'set_param' && op.key === 'mass_kg' && op.value === 2)) {
      throw new Error(`ops 不符：${JSON.stringify(quality.ops)}`);
    }
  });
  check('「摩擦系数」同时写静摩擦与动摩擦', () => {
    const proposal = proposeFromText('摩擦系数 0.15', scene);
    const keys = proposal.ops.map((op) => (op.op === 'set_param' ? op.key : '')).sort();
    equal(keys.join(','), 'mu_kinetic,mu_static');
  });
  check('「换成斜面，倾角 30 度」切换并可应用', () => {
    const proposal = proposeFromText('换成斜面，倾角 30 度', scene);
    equal(proposal.intent, 'switch_model');
    const result = applyOps(scene, proposal.ops, scene.revision);
    if (!result.ok) throw new Error(`应用失败：${result.error}`);
    equal(result.scene.modelId, 'incline-block');
    close(result.scene.params.angle_deg, 30, 0);
    if (result.scene.params.initial_position_m !== 4) throw new Error('非法初始位置未被替换为默认值');
  });
  check('方向词决定速度符号', () => {
    const proposal = proposeFromText('初速度 4 m/s 向左', scene);
    if (!proposal.ops.some((op) => op.op === 'set_param' && op.key === 'initial_velocity_m_s' && op.value === -4)) {
      throw new Error(`ops 不符：${JSON.stringify(proposal.ops)}`);
    }
  });
  check('对比意图解析出两组参数', () => {
    const proposal = proposeFromText('对比 0.1 和 0.5 的摩擦系数', scene);
    equal(proposal.intent, 'compare');
    if (!proposal.compare) throw new Error('缺少 compare');
    equal(proposal.compare.key, 'mu_kinetic');
    close(proposal.compare.a, 0.1, 0);
    close(proposal.compare.b, 0.5, 0);
  });
  check('只给参数名时追问数值', () => {
    const proposal = proposeFromText('质量', scene);
    equal(proposal.intent, 'unknown');
    equal(proposal.pending[0]?.key, 'mass_kg');
  });
  check('无法识别时给出示例而不是崩溃', () => {
    const proposal = proposeFromText('今天天气不错', scene);
    equal(proposal.intent, 'unknown');
    if (!proposal.message.includes('可以试着说')) throw new Error('缺少引导文案');
  });
  check('预览 diff 不改动场景', () => {
    const proposal = proposeFromText('质量 2 kg', scene);
    const preview = previewProposal(scene, proposal);
    if (!preview.diff.some((item) => item.key === 'mass_kg' && item.to === 2)) throw new Error('diff 缺少 mass_kg');
    equal(scene.revision, 1);
  });
  check('解释文案的数字来自运行结果', () => {
    const run = simulateScene(scene);
    const proposal = proposeFromText('为什么滑块最后停下来了', scene, run);
    equal(proposal.intent, 'explain');
    if (!proposal.message.includes('摩擦生热 8 J')) throw new Error(`解释缺少生热：${proposal.message}`);
    if (!proposal.message.includes('停止时间 2.041 s')) throw new Error('解释缺少停止时间');
  });
  check('explainRun 覆盖能量闭合', () => {
    const run = simulateScene(scene);
    const text = explainRun(run, scene);
    if (!text.includes('能量闭合残差 0 J')) throw new Error('缺少能量残差');
  });
}

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed === 0 ? 0 : 1);
