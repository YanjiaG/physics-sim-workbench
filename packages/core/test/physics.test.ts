import { describe, expect, it } from 'vitest';
import { createScene, simulateScene, stateAt } from '../src/index';

function sceneOf(modelId: string, params: Record<string, number>, duration = 8) {
  return createScene(modelId, { params, duration });
}

describe('水平面滑块', () => {
  it('H1：v₀=4 m/s、μk=0.2 匀减速到停止', () => {
    const run = simulateScene(
      sceneOf('horizontal-block', { applied_force_N: 0, mu_kinetic: 0.2, initial_velocity_m_s: 4 }, 4),
    );
    expect(run.summary.stop_time_s).toBeCloseTo(2.040816, 3);
    expect(run.summary.final_position_m).toBeCloseTo(4.081633, 3);
    expect(run.summary.final_velocity_m_s).toBeCloseTo(0, 6);
    expect(run.summary.total_distance_m).toBeCloseTo(4.081633, 3);
    expect(run.events.map((event) => event.kind)).toContain('stop');
  });

  it('H1：能量收支闭合（摩擦热 = 初动能）', () => {
    const run = simulateScene(
      sceneOf('horizontal-block', { applied_force_N: 0, mu_kinetic: 0.2, initial_velocity_m_s: 4 }, 4),
    );
    expect(run.summary.friction_heat_J).toBeCloseTo(8.0, 3);
    expect(Math.abs(run.summary.energy_residual_J)).toBeLessThan(1e-6);
  });

  it('H1：stateAt 与解析式一致（t=1 s）', () => {
    const run = simulateScene(
      sceneOf('horizontal-block', { applied_force_N: 0, mu_kinetic: 0.2, initial_velocity_m_s: 4 }, 4),
    );
    const state = stateAt(run, 1);
    expect(state.bodies.block?.v).toBeCloseTo(2.04, 6);
    expect(state.bodies.block?.x).toBeCloseTo(3.02, 6);
    expect(state.bodies.block?.a).toBeCloseTo(-1.96, 6);
  });

  it('H2：外力未超过最大静摩擦时保持静止', () => {
    const run = simulateScene(
      sceneOf(
        'horizontal-block',
        { applied_force_N: 2, mu_static: 0.3, mu_kinetic: 0.2, initial_velocity_m_s: 0 },
        2,
      ),
    );
    expect(run.summary.final_position_m).toBeCloseTo(0, 9);
    expect(run.summary.final_velocity_m_s).toBeCloseTo(0, 9);
    expect(run.segments.length).toBe(1);
    const friction = run.segments[0]?.forces.find((force) => force.kind === 'friction');
    expect(friction?.magnitude).toBeCloseTo(2, 6);
    expect(run.events.map((event) => event.kind)).toEqual(['start']);
  });

  it('H3：外力 5 N 启动后匀加速', () => {
    const run = simulateScene(
      sceneOf(
        'horizontal-block',
        { applied_force_N: 5, mu_static: 0.3, mu_kinetic: 0.2, initial_velocity_m_s: 0 },
        2,
      ),
    );
    expect(run.segments[0]?.bodies.block?.a).toBeCloseTo(3.04, 6);
    const state = stateAt(run, 1);
    expect(state.bodies.block?.x).toBeCloseTo(1.52, 6);
    expect(state.bodies.block?.v).toBeCloseTo(3.04, 6);
  });

  it('H4：反向外力使滑块先减速再反向加速', () => {
    const run = simulateScene(
      sceneOf(
        'horizontal-block',
        { applied_force_N: -10, mu_kinetic: 0.2, initial_velocity_m_s: 4 },
        2,
      ),
    );
    const reverse = run.events.find((event) => event.kind === 'reverse');
    expect(reverse?.t).toBeCloseTo(0.334448, 4);
    expect(run.segments[0]?.bodies.block?.a).toBeCloseTo(-11.96, 6);
    const state = stateAt(run, 1);
    expect(state.bodies.block?.v).toBeCloseTo(-5.3511, 3);
  });
});

describe('斜面滑块', () => {
  it('I1：从 s=4 m 静止下滑到底端', () => {
    const run = simulateScene(
      sceneOf(
        'incline-block',
        { angle_deg: 30, mu_static: 0.3, mu_kinetic: 0.2, initial_position_m: 4, initial_velocity_m_s: 0 },
        4,
      ),
    );
    expect(run.segments[0]?.bodies.block?.a).toBeCloseTo(-3.20259, 4);
    const leave = run.events.find((event) => event.kind === 'leave');
    expect(leave?.t).toBeCloseTo(1.5803, 3);
    const state = stateAt(run, leave ? leave.t : 1.5803);
    expect(state.bodies.block?.v).toBeCloseTo(-5.063, 2);
  });

  it('I2：以 5 m/s 上滑后减速到最高点', () => {
    const run = simulateScene(
      sceneOf(
        'incline-block',
        { angle_deg: 30, mu_kinetic: 0.2, initial_position_m: 0, initial_velocity_m_s: 5 },
        4,
      ),
    );
    expect(run.segments[0]?.bodies.block?.a).toBeCloseTo(-6.59741, 4);
    const stop = run.events.find((event) => event.kind === 'reverse' || event.kind === 'stop');
    expect(stop?.t).toBeCloseTo(0.7579, 3);
    expect(stateAt(run, stop ? stop.t : 0).bodies.block?.x).toBeCloseTo(1.8948, 3);
  });

  it('I3：倾角小、静摩擦足够时保持静止', () => {
    const run = simulateScene(
      sceneOf(
        'incline-block',
        { angle_deg: 10, mu_static: 0.3, mu_kinetic: 0.2, initial_position_m: 4, initial_velocity_m_s: 0 },
        2,
      ),
    );
    expect(run.segments.length).toBe(1);
    expect(run.summary.final_position_m).toBeCloseTo(4, 6);
  });

  it('I4：45° 斜面下滑加速度', () => {
    const run = simulateScene(
      sceneOf(
        'incline-block',
        { angle_deg: 45, mu_static: 0.5, mu_kinetic: 0.3, initial_position_m: 6, initial_velocity_m_s: 0 },
        2,
      ),
    );
    expect(run.segments[0]?.bodies.block?.a).toBeCloseTo(-4.851, 3);
  });
});

describe('滑块与长木板', () => {
  it('B1：地面摩擦足够大时木板不动', () => {
    const run = simulateScene(
      sceneOf(
        'board-block',
        {
          mass_block_kg: 1,
          mass_board_kg: 2,
          board_length_m: 12,
          mu_static_bb: 0.3,
          mu_kinetic_bb: 0.2,
          mu_static_ground: 0.1,
          mu_kinetic_ground: 0.08,
          initial_velocity_block_m_s: 6,
          initial_velocity_board_m_s: 0,
        },
        6,
      ),
    );
    const board = run.segments[0]?.bodies.board;
    expect(board?.a).toBeCloseTo(0, 6);
    expect(board?.v0).toBeCloseTo(0, 9);
    const stop = run.events.find((event) => event.kind === 'stop');
    expect(stop?.t).toBeCloseTo(3.0612, 3);
    expect(run.summary.friction_heat_J).toBeCloseTo(18.0, 2);
    expect(stateAt(run, 3.0612).bodies.block?.x).toBeCloseTo(9.1837, 2);
  });

  it('B2：地面摩擦不足时木板被带动，最终共速', () => {
    const run = simulateScene(
      sceneOf(
        'board-block',
        {
          mass_block_kg: 1,
          mass_board_kg: 1,
          board_length_m: 20,
          mu_static_bb: 0.3,
          mu_kinetic_bb: 0.2,
          mu_static_ground: 0.02,
          mu_kinetic_ground: 0.015,
          initial_velocity_block_m_s: 6,
          initial_velocity_board_m_s: 0,
        },
        8,
      ),
    );
    const sync = run.events.find((event) => event.kind === 'sync');
    expect(sync?.t).toBeCloseTo(1.6547, 3);
    const afterSync = run.segments.find((segment) => segment.label.includes('共同') || segment.mode === 'together');
    expect(afterSync?.bodies.block?.a).toBeCloseTo(-0.147, 3);
  });

  it('B3：木板太短时滑块从右端滑离', () => {
    const run = simulateScene(
      sceneOf(
        'board-block',
        {
          mass_block_kg: 1,
          mass_board_kg: 2,
          board_length_m: 2,
          mu_static_bb: 0.3,
          mu_kinetic_bb: 0.2,
          mu_static_ground: 0.1,
          mu_kinetic_ground: 0.08,
          initial_velocity_block_m_s: 6,
          initial_velocity_board_m_s: 0,
        },
        4,
      ),
    );
    const leave = run.events.find((event) => event.kind === 'leave');
    expect(leave?.t).toBeCloseTo(0.3538, 3);
    expect(stateAt(run, leave ? leave.t : 0).bodies.block?.v).toBeCloseTo(5.3066, 2);
  });
});

describe('传送带上的滑块', () => {
  it('C1：滑块加速到与带共速后随带匀速', () => {
    const run = simulateScene(
      sceneOf(
        'conveyor-block',
        { belt_speed_m_s: 2, mu_static: 0.3, mu_kinetic: 0.2, initial_velocity_m_s: 0, initial_position_m: 0 },
        3,
      ),
    );
    const sync = run.events.find((event) => event.kind === 'sync');
    expect(sync?.t).toBeCloseTo(1.0204, 3);
    expect(stateAt(run, 1.0204).bodies.block?.x).toBeCloseTo(1.0204, 2);
    expect(stateAt(run, 3).bodies.block?.x).toBeCloseTo(4.98, 2);
  });

  it('C2：带速向左时滑块被带到左端离开', () => {
    const run = simulateScene(
      sceneOf(
        'conveyor-block',
        { belt_speed_m_s: -2, mu_static: 0.3, mu_kinetic: 0.2, initial_velocity_m_s: 0, initial_position_m: 3 },
        3,
      ),
    );
    const leave = run.events.find((event) => event.kind === 'leave');
    expect(leave).toBeDefined();
    expect(leave?.t).toBeCloseTo(2.0102, 3);
  });

  it('C3：外力过大时越过带速也无法同步', () => {
    const run = simulateScene(
      sceneOf(
        'conveyor-block',
        {
          belt_speed_m_s: 2,
          mu_static: 0.3,
          mu_kinetic: 0.2,
          applied_force_N: 5,
          initial_velocity_m_s: 0,
          initial_position_m: 0,
        },
        4,
      ),
    );
    const slip = run.events.find((event) => event.kind === 'slip');
    expect(slip?.t).toBeCloseTo(0.2874, 3);
    expect(run.events.some((event) => event.kind === 'sync')).toBe(false);
  });
});
