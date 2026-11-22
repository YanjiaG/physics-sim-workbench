import type { ModelDefinition, Params, Run, Scene } from '../types';
import { simulate } from '../solver';
import { horizontalModel } from './horizontal';
import { inclineModel } from './incline';
import { boardModel } from './board';
import { conveyorModel } from './conveyor';

export const MODELS: ModelDefinition[] = [horizontalModel, inclineModel, boardModel, conveyorModel];

const MODEL_MAP = new Map(MODELS.map((model) => [model.id, model]));

const DEFAULT_DURATION: Record<string, number> = {
  'horizontal-block': 6,
  'incline-block': 6,
  'board-block': 8,
  'conveyor-block': 8,
};

export function getModel(modelId: string): ModelDefinition | undefined {
  return MODEL_MAP.get(modelId);
}

export function requireModel(modelId: string): ModelDefinition {
  const model = MODEL_MAP.get(modelId);
  if (!model) throw new Error(`未注册的模型「${modelId}」`);
  return model;
}

export function defaultDuration(modelId: string): number {
  return DEFAULT_DURATION[modelId] ?? 6;
}

export function simulateScene(scene: Scene): Run {
  const model = requireModel(scene.modelId);
  return simulate(model, scene);
}

/** 模型参数中文名，用于 UI 与 AI 文本 */
export function paramLabel(modelId: string, key: string): string {
  const model = getModel(modelId);
  return model?.parameters.find((spec) => spec.key === key)?.label ?? key;
}

export function modelParams(modelId: string): Params {
  const model = requireModel(modelId);
  return model.createDefaultParams();
}
