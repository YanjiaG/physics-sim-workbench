import { describe, expect, it } from 'vitest';
import {
  createScene,
  diffScenes,
  getModel,
  parseScene,
  sampleRun,
  sceneToJSON,
  simulateScene,
  stateAt,
  validateScene,
  applyOps,
  setSceneParam,
} from '../src/index';

describe('求解器不变量', () => {
  const scene = createScene('horizontal-block', { duration: 4 });

  it('同一场景两次模拟得到相同 runId 与结果', () => {
    const a = simulateScene(scene);
    const b = simulateScene(scene);
    expect(a.runId).toBe(b.runId);
    expect(a.summary).toEqual(b.summary);
    expect(a.segments.length).toBe(b.segments.length);
  });

  it('分段边界单调递增且无零长分段', () => {
    const run = simulateScene(scene);
    for (const segment of run.segments) {
      expect(segment.t1).toBeGreaterThan(segment.t0);
    }
    for (let i = 1; i < run.segments.length; i += 1) {
      expect(run.segments[i]?.t0).toBeGreaterThanOrEqual(run.segments[i - 1]?.t1 ?? 0);
    }
  });

  it('事件时间单调不减', () => {
    const run = simulateScene(scene);
    for (let i = 1; i < run.events.length; i += 1) {
      expect(run.events[i]?.t).toBeGreaterThanOrEqual(run.events[i - 1]?.t ?? 0);
    }
  });

  it('stateAt 在分段边界连续', () => {
    const run = simulateScene(scene);
    for (const segment of run.segments.slice(0, -1)) {
      const before = stateAt(run, segment.t1 - 1e-7);
      const after = stateAt(run, segment.t1 + 1e-7);
      expect(after.bodies.block?.v).toBeCloseTo(before.bodies.block?.v ?? 0, 4);
      expect(after.bodies.block?.x).toBeCloseTo(before.bodies.block?.x ?? 0, 4);
    }
  });

  it('sampleRun 返回等长且单调的时间序列', () => {
    const run = simulateScene(scene);
    const samples = sampleRun(run, 50);
    expect(samples.ts.length).toBeGreaterThan(2);
    const positions = samples.bodies.block?.x ?? [];
    expect(positions.length).toBe(samples.ts.length);
    for (let i = 1; i < samples.ts.length; i += 1) {
      expect(samples.ts[i]).toBeGreaterThan(samples.ts[i - 1] ?? 0);
    }
    expect(samples.ts[0]).toBeCloseTo(0, 9);
    expect(samples.ts[samples.ts.length - 1]).toBeCloseTo(run.duration_s, 6);
  });
});

describe('场景校验与提案', () => {
  it('默认场景通过校验', () => {
    const scene = createScene('incline-block');
    expect(validateScene(scene).filter((issue) => issue.level === 'error')).toEqual([]);
  });

  it('JSON 往返保持一致', () => {
    const scene = createScene('board-block');
    const parsed = parseScene(JSON.parse(sceneToJSON(scene)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.scene).toEqual(scene);
  });

  it('非法参数被拦截而不是抛异常', () => {
    const scene = createScene('horizontal-block');
    const result = setSceneParam(scene, 'mass_kg', -1);
    expect(result.scene).toBe(scene);
    expect(result.issue?.level).toBe('error');
    const model = getModel('horizontal-block');
    expect(model?.validate({ ...scene.params, mass_kg: -1 }).some((issue) => issue.level === 'error')).toBe(true);
  });

  it('提案 revision 过期时被拒绝', () => {
    const scene = createScene('horizontal-block');
    const result = applyOps(scene, [{ op: 'set_param', key: 'mass_kg', value: 2 }], scene.revision - 1);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('修订版本');
  });

  it('合法提案应用后 revision 加一且 diff 正确', () => {
    const scene = createScene('horizontal-block');
    const result = applyOps(scene, [{ op: 'set_param', key: 'mass_kg', value: 2 }], scene.revision);
    expect(result.ok).toBe(true);
    expect(result.scene.revision).toBe(scene.revision + 1);
    const diff = diffScenes(scene, result.scene);
    expect(diff.find((item) => item.key === 'mass_kg')?.to).toBe(2);
  });

  it('切换模型提案重置参数与时长', () => {
    const scene = createScene('horizontal-block');
    const result = applyOps(scene, [{ op: 'switch_model', modelId: 'conveyor-block' }], scene.revision);
    expect(result.ok).toBe(true);
    expect(result.scene.modelId).toBe('conveyor-block');
    expect(result.scene.params.belt_speed_m_s).toBe(2);
    expect(result.scene.settings.duration_s).toBe(8);
  });
});
