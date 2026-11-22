import { describe, expect, it } from 'vitest';
import {
  applyOps,
  createScene,
  explainRun,
  previewProposal,
  proposeFromText,
  simulateScene,
} from '../src';

const scene = createScene('horizontal-block', { duration: 6 });

describe('AI 规则解析', () => {
  it('识别质量修改', () => {
    const proposal = proposeFromText('把质量改成 2 kg', scene);
    expect(proposal.intent).toBe('modify');
    expect(proposal.ops).toContainEqual({ op: 'set_param', key: 'mass_kg', value: 2 });
  });

  it('「摩擦系数」同时写入静摩擦与动摩擦', () => {
    const proposal = proposeFromText('摩擦系数 0.15', scene);
    const keys = proposal.ops.map((op) => (op.op === 'set_param' ? op.key : '')).sort();
    expect(keys).toEqual(['mu_kinetic', 'mu_static']);
  });

  it('切换模型时剔除不适用参数', () => {
    const proposal = proposeFromText('换成斜面，倾角 30 度', scene);
    expect(proposal.intent).toBe('switch_model');
    const result = applyOps(scene, proposal.ops, scene.revision);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scene.modelId).toBe('incline-block');
    expect(result.scene.params.angle_deg).toBe(30);
    expect(result.scene.params.initial_position_m).toBe(4);
    expect(proposal.warnings.length).toBeGreaterThan(0);
  });

  it('方向词决定速度符号', () => {
    const proposal = proposeFromText('初速度 4 m/s 向左', scene);
    expect(proposal.ops).toContainEqual({ op: 'set_param', key: 'initial_velocity_m_s', value: -4 });
  });

  it('解析对比意图', () => {
    const proposal = proposeFromText('对比 0.1 和 0.5 的摩擦系数', scene);
    expect(proposal.intent).toBe('compare');
    expect(proposal.compare).toMatchObject({ key: 'mu_kinetic', a: 0.1, b: 0.5 });
  });

  it('只给参数名时追问数值', () => {
    const proposal = proposeFromText('质量', scene);
    expect(proposal.intent).toBe('unknown');
    expect(proposal.pending[0]?.key).toBe('mass_kg');
  });

  it('无法识别时给出示例', () => {
    const proposal = proposeFromText('今天天气不错', scene);
    expect(proposal.intent).toBe('unknown');
    expect(proposal.message).toContain('可以试着说');
  });

  it('预览 diff 不修改场景', () => {
    const proposal = proposeFromText('质量 2 kg', scene);
    const preview = previewProposal(scene, proposal);
    expect(preview.diff).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'mass_kg', to: 2 })]));
    expect(scene.revision).toBe(1);
  });

  it('解释文案取自运行结果', () => {
    const run = simulateScene(scene);
    const proposal = proposeFromText('为什么滑块最后停下来了', scene, run);
    expect(proposal.intent).toBe('explain');
    expect(proposal.message).toContain('摩擦生热 8 J');
    expect(proposal.message).toContain('停止时间 2.041 s');
  });

  it('explainRun 说明能量闭合', () => {
    const run = simulateScene(scene);
    expect(explainRun(run, scene)).toContain('能量闭合残差 0 J');
  });

  it('参数越界时夹取并给出警告', () => {
    const proposal = proposeFromText('质量 0.01 kg', scene);
    const op = proposal.ops.find((item) => item.op === 'set_param' && item.key === 'mass_kg');
    expect(op && op.op === 'set_param' ? op.value : null).toBeGreaterThan(0.01);
    expect(proposal.warnings.length).toBeGreaterThan(0);
  });

  it('中文数字可解析', () => {
    const proposal = proposeFromText('摩擦系数零点三', scene);
    expect(proposal.ops).toContainEqual({ op: 'set_param', key: 'mu_static', value: 0.3 });
    expect(proposal.ops).toContainEqual({ op: 'set_param', key: 'mu_kinetic', value: 0.3 });
  });
});
