import { z } from 'zod';
import type { Issue, ParamValue, Params, Scene } from '../types';
import { SCENE_SCHEMA_VERSION } from '../types';
import { getModel } from '../models';

export const paramValueSchema = z.union([z.number(), z.boolean(), z.string()]);

export const sceneSchema = z.object({
  schemaVersion: z.literal(SCENE_SCHEMA_VERSION),
  sceneId: z.string().min(1).max(120),
  name: z.string().max(160),
  revision: z.number().int().nonnegative(),
  modelId: z.string().min(1).max(80),
  params: z.record(paramValueSchema),
  settings: z.object({ duration_s: z.number().positive().max(600) }),
  observables: z.array(z.string().max(80)).max(40),
  notes: z.string().max(4000).optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type ParsedScene = z.infer<typeof sceneSchema>;

export interface ParseOk {
  ok: true;
  scene: Scene;
}
export interface ParseFail {
  ok: false;
  issues: Issue[];
}
export type ParseResult = ParseOk | ParseFail;

function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return '场景';
  return path.reduce<string>((acc, part) => (typeof part === 'number' ? `${acc}[${part}]` : acc ? `${acc}.${part}` : String(part)), '');
}

export function parseScene(input: unknown): ParseResult {
  const result = sceneSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        level: 'error',
        key: formatPath(issue.path),
        message: issue.message,
      })),
    };
  }
  return { ok: true, scene: result.data as Scene };
}

export function sceneFromJSON(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, issues: [{ level: 'error', message: `不是合法的 JSON：${error instanceof Error ? error.message : String(error)}` }] };
  }
  return parseScene(data);
}

/** 场景自检：结构 + 注册表 + 模型参数语义 */
export function validateScene(scene: Scene): Issue[] {
  const issues: Issue[] = [];
  const model = getModel(scene.modelId);
  if (!model) {
    issues.push({ level: 'error', key: 'modelId', message: `未注册的模型「${scene.modelId}」。` });
    return issues;
  }

  const known = new Map(model.parameters.map((spec) => [spec.key, spec]));
  for (const spec of model.parameters) {
    const value = scene.params[spec.key];
    if (value === undefined) {
      issues.push({ level: 'error', key: spec.key, message: `缺少参数「${spec.label}」。` });
      continue;
    }
    if (spec.type === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({ level: 'error', key: spec.key, message: `「${spec.label}」必须是有限数值。` });
        continue;
      }
      if (spec.min !== undefined && value < spec.min - 1e-9) {
        issues.push({ level: 'error', key: spec.key, message: `「${spec.label}」不能小于 ${spec.min}${spec.unit ? ` ${spec.unit}` : ''}。` });
      }
      if (spec.max !== undefined && value > spec.max + 1e-9) {
        issues.push({ level: 'error', key: spec.key, message: `「${spec.label}」不能大于 ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}。` });
      }
    } else if (typeof value !== spec.type) {
      issues.push({ level: 'error', key: spec.key, message: `「${spec.label}」类型应为 ${spec.type}。` });
    }
  }

  for (const key of Object.keys(scene.params)) {
    if (!known.has(key)) {
      issues.push({ level: 'warning', key, message: `参数「${key}」不属于模型「${model.name}」，将被忽略。` });
    }
  }

  for (const key of scene.observables) {
    if (!model.observables.some((obs) => obs.key === key)) {
      issues.push({ level: 'warning', key, message: `输出量「${key}」不属于模型「${model.name}」。` });
    }
  }

  const severity = scene.settings.duration_s;
  if (!(severity >= 0.2 && severity <= 60)) {
    issues.push({ level: 'error', key: 'duration_s', message: '模拟时长需在 0.2 s 与 60 s 之间。' });
  }

  issues.push(...model.validate(scene.params));
  return issues;
}

export function sceneIsValid(scene: Scene): boolean {
  return !validateScene(scene).some((issue) => issue.level === 'error');
}

/** 逐项校验单个参数值（用于 AI 提案与表单），返回错误说明或 null */
export function checkParamValue(scene: Scene, key: string, value: ParamValue): string | null {
  const model = getModel(scene.modelId);
  if (!model) return `未注册的模型「${scene.modelId}」。`;
  const spec = model.parameters.find((item) => item.key === key);
  if (!spec) return `参数「${key}」不属于模型「${model.name}」。`;
  if (spec.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `「${spec.label}」必须是有限数值。`;
    if (spec.min !== undefined && value < spec.min - 1e-9) return `「${spec.label}」不能小于 ${spec.min}${spec.unit ? ` ${spec.unit}` : ''}。`;
    if (spec.max !== undefined && value > spec.max + 1e-9) return `「${spec.label}」不能大于 ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}。`;
    return null;
  }
  return typeof value === spec.type ? null : `「${spec.label}」类型应为 ${spec.type}。`;
}

export function paramsOf(scene: Scene): Params {
  return { ...scene.params };
}
