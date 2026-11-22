/**
 * 内核共享类型。所有物理量使用 SI 单位（m, kg, s, N, m/s, m/s²），
 * 世界坐标 x 向右、y 向上；角度在界面上用度，内部用弧度。
 */

export interface Pt {
  x: number;
  y: number;
}

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------

export interface SceneSettings {
  duration_s: number;
}

export interface Scene {
  schemaVersion: '0.1';
  sceneId: string;
  name: string;
  revision: number;
  modelId: string;
  params: Params;
  settings: SceneSettings;
  observables: string[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type IssueLevel = 'error' | 'warning';

export interface Issue {
  level: IssueLevel;
  key?: string;
  message: string;
}

export type ParamGroup = 'object' | 'environment' | 'initial' | 'run';

export interface ParamSpec {
  key: string;
  label: string;
  unit?: string;
  group: ParamGroup;
  type: 'number' | 'boolean';
  default: number | boolean;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  axis?: string;
  advanced?: boolean;
}

export interface AssumptionSpec {
  key: string;
  label: string;
  locked?: boolean;
  note?: string;
}

export interface ObservableSpec {
  key: string;
  label: string;
  unit: string;
}

// ---------------------------------------------------------------------------
// 求解结果
// ---------------------------------------------------------------------------

export interface BodyMotion {
  x0: number;
  v0: number;
  a: number;
}

export interface Force {
  id: string;
  label: string;
  on: string;
  kind: 'gravity' | 'normal' | 'friction' | 'applied';
  /** N，非负；方向由 dir 给出 */
  magnitude: number;
  /** 世界坐标单位向量，y 向上 */
  dir: Pt;
}

export type HeatRef =
  | { kind: 'ground' }
  | { kind: 'body'; bodyId: string }
  | { kind: 'speed'; v: number };

export interface HeatTerm {
  /** 摩擦力大小 N */
  magnitude: number;
  /** 受力物体 */
  bodyId: string;
  /** 相对运动参考 */
  ref: HeatRef;
}

export type SimEventKind = 'start' | 'stop' | 'reverse' | 'sync' | 'slip' | 'leave' | 'end';

export interface SimEvent {
  t: number;
  kind: SimEventKind;
  title: string;
  detail: string;
  bodyIds?: string[];
}

export interface Segment {
  t0: number;
  t1: number;
  label: string;
  mode: string;
  bodies: Record<string, BodyMotion>;
  forces: Force[];
  heatStart: number;
  heatEnd: number;
}

export interface RunSummary {
  stop_time_s: number | null;
  final_position_m: number | null;
  final_velocity_m_s: number | null;
  total_distance_m: number;
  max_speed_m_s: number;
  friction_heat_J: number;
  initial_energy_J: number;
  final_energy_J: number;
  energy_residual_J: number;
  extra: Record<string, number | string | null>;
}

export interface Run {
  runId: string;
  sceneId: string;
  sceneRevision: number;
  modelId: string;
  solverVersion: string;
  requested_duration_s: number;
  /** 实际模拟时长，可能因物体离开模型边界而提前结束 */
  duration_s: number;
  segments: Segment[];
  events: SimEvent[];
  warnings: string[];
  summary: RunSummary;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 模型
// ---------------------------------------------------------------------------

export interface BodyKinematics {
  x: number;
  v: number;
}

/** 模型内部连续状态 + 离散模式 */
export interface ModelState {
  time: number;
  bodies: Record<string, BodyKinematics>;
  mode: string;
}

export interface Acceleration {
  /** 每个物体的恒定加速度 m/s² */
  bodies: Record<string, number>;
  mode: string;
  label: string;
  forces: Force[];
  heat: HeatTerm[];
}

export interface EventCandidate {
  /** 绝对时间 */
  time: number;
  kind: SimEventKind;
  title: string;
  detail: string;
  bodyIds?: string[];
  /** 在事件时刻（已按常加速度推进后）修改状态 */
  apply(state: ModelState): ModelState;
  /** 物体离开模型定义域，模拟在此结束 */
  terminal?: boolean;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ModelDefinition {
  id: string;
  name: string;
  category: string;
  summary: string;
  /** 主物体 id，用于汇总与镜头 */
  primaryBody: string;
  axisHint: string;
  parameters: ParamSpec[];
  assumptions: AssumptionSpec[];
  observables: ObservableSpec[];
  createDefaultParams(): Params;
  validate(params: Params): Issue[];
  /** 模型正方向的单位向量，用于把一维位移映射到世界坐标计算功 */
  axis(params: Params): Pt;
  init(params: Params): ModelState;
  accel(state: ModelState, params: Params): Acceleration;
  nextEvent(
    state: ModelState,
    params: Params,
    accel: Acceleration,
    deadline: number,
  ): EventCandidate | null;
  energy(state: ModelState, params: Params): number;
  frame(params: Params, run: Run, t: number): SceneFrame;
  bounds(params: Params, run: Run): Bounds;
}

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

export type Primitive =
  | { type: 'line'; a: Pt; b: Pt; color: string; width?: number; dash?: boolean }
  | {
      type: 'rect';
      center: Pt;
      w: number;
      h: number;
      angle?: number;
      fill?: string;
      stroke?: string;
      lineWidth?: number;
      rx?: number;
    }
  | { type: 'circle'; center: Pt; r: number; fill?: string; stroke?: string; lineWidth?: number }
  | { type: 'polyline'; pts: Pt[]; color: string; width?: number; dash?: boolean }
  | { type: 'polygon'; pts: Pt[]; fill?: string; stroke?: string; lineWidth?: number }
  | {
      type: 'arrow';
      from: Pt;
      to: Pt;
      color: string;
      width?: number;
      label?: string;
      labelSide?: 'above' | 'below';
    }
  | {
      type: 'text';
      at: Pt;
      text: string;
      color?: string;
      size?: number;
      weight?: number;
      align?: 'left' | 'center' | 'right';
      baseline?: 'top' | 'middle' | 'bottom';
    }
  | { type: 'spring'; a: Pt; b: Pt; coils: number; amplitude: number; color: string }
  | {
      type: 'arc';
      center: Pt;
      r: number;
      from: number;
      to: number;
      color: string;
      width?: number;
      dash?: boolean;
    };

export interface SceneFrame {
  primitives: Primitive[];
  bodies: { id: string; label: string; mass: number; color: string }[];
}

// ---------------------------------------------------------------------------
// AI 提案
// ---------------------------------------------------------------------------

export type ProposalIntent = 'modify' | 'switch_model' | 'compare' | 'explain' | 'unknown';

export type ProposalOp =
  | { op: 'set_param'; key: string; value: ParamValue }
  | { op: 'switch_model'; modelId: string; params?: Params };

export interface PendingItem {
  key?: string;
  question: string;
}

export interface ComparePlan {
  key: string;
  a: number;
  b: number;
  unit?: string;
  label?: string;
}

export interface Proposal {
  id: string;
  baseRevision: number;
  intent: ProposalIntent;
  ops: ProposalOp[];
  message: string;
  pending: PendingItem[];
  warnings: string[];
  compare?: ComparePlan;
  source: 'rules' | 'llm';
}

export interface ParamDiff {
  key: string;
  label: string;
  unit?: string;
  from?: ParamValue;
  to?: ParamValue;
}

export interface ApplyResult {
  ok: boolean;
  scene: Scene;
  diff: ParamDiff[];
  error?: string;
}

// ---------------------------------------------------------------------------
// 配色与比例常量
// ---------------------------------------------------------------------------

export const PALETTE = {
  gravity: '#7C3AED',
  normal: '#0D9488',
  friction: '#EA580C',
  applied: '#2563EB',
  velocity: '#16A34A',
  block: '#1E293B',
  blockEdge: '#0F172A',
  board: '#B45309',
  boardEdge: '#92400E',
  boardTop: '#D97706',
  belt: '#475569',
  beltStripe: '#CBD5E1',
  beltRoller: '#64748B',
  ground: '#475569',
  incline: '#94A3B8',
  inclineFill: '#F1F5F9',
  trajectory: '#94A3B8',
  text: '#0F172A',
  muted: '#64748B',
  white: '#FFFFFF',
  marker: '#F59E0B',
  surface: '#CBD5E1',
} as const;

/** 力箭头：每牛顿对应的世界长度（米） */
export const FORCE_ARROW_SCALE = 0.05;
/** 速度箭头：每 m/s 对应的世界长度（米） */
export const VELOCITY_ARROW_SCALE = 0.22;
export const ARROW_MIN_M = 0.12;
export const ARROW_MAX_M = 2.6;

export const SOLVER_VERSION = '0.1.0';
export const SCENE_SCHEMA_VERSION = '0.1';
export const EPS = 1e-9;
