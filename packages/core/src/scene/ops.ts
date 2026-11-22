import type { ApplyResult, Issue, ParamDiff, ParamValue, Params, ProposalOp, Scene } from '../types';
import { SCENE_SCHEMA_VERSION } from '../types';
import { defaultDuration, getModel, requireModel } from '../models';
import { checkParamValue, validateScene } from './schema';

function nowISO(): string {
  return new Date().toISOString();
}

export function newSceneId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `scene_${Date.now().toString(36)}_${rand}`;
}

export function createScene(
  modelId: string,
  options: { name?: string; params?: Params; duration?: number } = {},
): Scene {
  const model = requireModel(modelId);
  const params: Params = { ...model.createDefaultParams(), ...(options.params ?? {}) };
  const createdAt = nowISO();
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    sceneId: newSceneId(),
    name: options.name?.trim() || `${model.name}场景`,
    revision: 1,
    modelId: model.id,
    params,
    settings: { duration_s: options.duration ?? defaultDuration(model.id) },
    observables: model.observables.map((obs) => obs.key),
    createdAt,
    updatedAt: createdAt,
  };
}

export function cloneScene(scene: Scene): Scene {
  return {
    ...scene,
    params: { ...scene.params },
    settings: { ...scene.settings },
    observables: [...scene.observables],
  };
}

/** 任何改动都写回一个新对象并递增 revision，保证「场景 = 唯一事实来源」 */
export function touchScene(scene: Scene, patch: Partial<Scene>): Scene {
  return {
    ...scene,
    ...patch,
    params: patch.params ? { ...patch.params } : { ...scene.params },
    settings: patch.settings ? { ...patch.settings } : { ...scene.settings },
    observables: patch.observables ? [...patch.observables] : [...scene.observables],
    revision: scene.revision + 1,
    updatedAt: nowISO(),
  };
}

export function setSceneParam(scene: Scene, key: string, value: ParamValue): { scene: Scene; issue: Issue | null } {
  const error = checkParamValue(scene, key, value);
  if (error) {
    return { scene, issue: { level: 'error', key, message: error } };
  }
  return { scene: touchScene(scene, { params: { ...scene.params, [key]: value } }), issue: null };
}

export function setSceneDuration(scene: Scene, duration: number): { scene: Scene; issue: Issue | null } {
  if (!(duration >= 0.2 && duration <= 60)) {
    return { scene, issue: { level: 'error', key: 'duration_s', message: '模拟时长需在 0.2 s 与 60 s 之间。' } };
  }
  return { scene: touchScene(scene, { settings: { ...scene.settings, duration_s: duration } }), issue: null };
}

export function switchSceneModel(scene: Scene, modelId: string, params?: Params): { scene: Scene; issue: Issue | null } {
  const model = getModel(modelId);
  if (!model) return { scene, issue: { level: 'error', key: 'modelId', message: `未注册的模型「${modelId}」。` } };
  if (modelId === scene.modelId) return { scene, issue: null };
  const next: Scene = {
    ...scene,
    modelId,
    params: { ...model.createDefaultParams(), ...(params ?? {}) },
    observables: model.observables.map((obs) => obs.key),
    settings: { duration_s: defaultDuration(modelId) },
    updatedAt: nowISO(),
    revision: scene.revision + 1,
  };
  return { scene: next, issue: null };
}

export function diffScenes(before: Scene, after: Scene): ParamDiff[] {
  const diff: ParamDiff[] = [];
  if (before.modelId !== after.modelId) {
    const model = getModel(after.modelId);
    diff.push({ key: 'modelId', label: '问题模型', from: before.modelId, to: model?.name ?? after.modelId });
  }
  const keys = new Set([...Object.keys(before.params), ...Object.keys(after.params)]);
  for (const key of keys) {
    if (before.modelId !== after.modelId && !(key in after.params)) continue;
    const from = before.params[key];
    const to = after.params[key];
    if (from === to) continue;
    if (typeof from === 'number' && typeof to === 'number' && Math.abs(from - to) < 1e-12) continue;
    const spec = getModel(after.modelId)?.parameters.find((item) => item.key === key);
    diff.push({
      key,
      label: spec?.label ?? key,
      ...(spec?.unit ? { unit: spec.unit } : {}),
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    });
  }
  if (Math.abs(before.settings.duration_s - after.settings.duration_s) > 1e-9) {
    diff.push({ key: 'duration_s', label: '模拟时长', unit: 's', from: before.settings.duration_s, to: after.settings.duration_s });
  }
  return diff;
}

const OP_LABEL: Record<ProposalOp['op'], string> = {
  set_param: '修改参数',
  switch_model: '切换模型',
};

/**
 * 把 AI / 规则的提案作用到场景上。
 * 关键约束：baseRevision 必须与当前 revision 一致，否则拒绝（避免覆盖用户的新改动）。
 */
export function applyOps(scene: Scene, ops: ProposalOp[], baseRevision?: number): ApplyResult {
  if (baseRevision !== undefined && baseRevision !== scene.revision) {
    return {
      ok: false,
      scene,
      diff: [],
      error: `提案基于修订版本 r${baseRevision}，当前场景已是 r${scene.revision}。为避免覆盖你的新改动，提案被拒绝，请重新生成。`,
    };
  }
  if (ops.length === 0) {
    return { ok: false, scene, diff: [], error: '提案没有任何改动。' };
  }

  let next = cloneScene(scene);
  const issues: Issue[] = [];
  for (const op of ops) {
    if (op.op === 'set_param') {
      const check = checkParamValue(next, op.key, op.value);
      if (check) {
        issues.push({ level: 'error', key: op.key, message: check });
        continue;
      }
      next.params = { ...next.params, [op.key]: op.value };
    } else if (op.op === 'switch_model') {
      const model = getModel(op.modelId);
      if (!model) {
        issues.push({ level: 'error', key: 'modelId', message: `未注册的模型「${op.modelId}」。` });
        continue;
      }
      next.modelId = model.id;
      next.params = { ...model.createDefaultParams(), ...(op.params ?? {}) };
      next.observables = model.observables.map((obs) => obs.key);
      next.settings = { ...next.settings, duration_s: defaultDuration(model.id) };
    } else {
      issues.push({ level: 'error', message: `未知的提案操作「${String((op as { op?: string }).op)}」。` });
    }
  }

  const errors = issues.filter((issue) => issue.level === 'error');
  if (errors.length > 0) {
    return { ok: false, scene, diff: [], error: errors.map((issue) => issue.message).join('；') };
  }

  next.revision = scene.revision + 1;
  next.updatedAt = nowISO();
  const sceneIssues = validateScene(next);
  const sceneErrors = sceneIssues.filter((issue) => issue.level === 'error');
  if (sceneErrors.length > 0) {
    return { ok: false, scene, diff: [], error: sceneErrors.map((issue) => issue.message).join('；') };
  }

  return { ok: true, scene: next, diff: diffScenes(scene, next) };
}

export function describeOp(op: ProposalOp): string {
  if (op.op === 'set_param') return `${OP_LABEL.set_param} ${op.key} = ${String(op.value)}`;
  return `${OP_LABEL.switch_model} → ${op.modelId}`;
}

export function sceneToJSON(scene: Scene): string {
  return JSON.stringify(scene, null, 2);
}

export function sceneFileName(scene: Scene): string {
  const safe = scene.name.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'scene';
  return `${safe}-r${scene.revision}.json`;
}
