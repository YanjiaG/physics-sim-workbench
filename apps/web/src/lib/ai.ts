import type { Proposal, Run, Scene } from '@psw/core';
import { getModel, MODELS, proposeFromText } from '@psw/core';

export interface ProposalResponse {
  proposal: Proposal;
  source: 'llm' | 'rules';
  note?: string;
}

interface ServerPayload {
  ok?: boolean;
  proposal?: Proposal;
  reason?: string;
}

const REQUEST_TIMEOUT_MS = 9000;

/**
 * 先走离线规则；规则识别不了时再请求本地 AI 服务（有 API 密钥才会成功）。
 * 无论哪条路径，都只返回「提案」，永远不直接改场景。
 */
export async function requestProposal(text: string, scene: Scene, run: Run): Promise<ProposalResponse> {
  const local = proposeFromText(text, scene, run);
  if (local.intent !== 'unknown') return { proposal: local, source: 'rules' };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const model = getModel(scene.modelId);
    const spec = (model?.parameters ?? []).map((item) => ({
      key: item.key,
      label: item.label,
      unit: item.unit ?? null,
      type: item.type,
      min: item.min ?? null,
      max: item.max ?? null,
      default: item.default,
    }));
    const models = MODELS.map((item) => ({
      id: item.id,
      name: item.name,
      params: item.parameters.map((param) => param.key),
    }));
    const response = await fetch('/api/ai/propose', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        scene,
        spec,
        models,
        run: { summary: run.summary, events: run.events, duration_s: run.duration_s },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as ServerPayload;
    if (data.ok && data.proposal) {
      return { proposal: { ...data.proposal, source: 'llm' }, source: 'llm' };
    }
    return { proposal: local, source: 'rules', ...(data.reason ? { note: data.reason } : {}) };
  } catch (error) {
    const note = error instanceof Error ? error.message : '请求 AI 服务失败';
    return { proposal: local, source: 'rules', note };
  }
}

export async function fetchAiStatus(): Promise<{ enabled: boolean; model?: string }> {
  try {
    const response = await fetch('/api/ai/status');
    if (!response.ok) return { enabled: false };
    const data = (await response.json()) as { enabled?: boolean; model?: string };
    return { enabled: Boolean(data.enabled), ...(data.model ? { model: data.model } : {}) };
  } catch {
    return { enabled: false };
  }
}
