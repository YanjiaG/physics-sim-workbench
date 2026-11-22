import { create } from 'zustand';
import type { Issue, ParamValue, Proposal, Run, Scene } from '@psw/core';
import {
  applyOps,
  createScene,
  getModel,
  MODELS,
  simulateScene,
  validateScene,
} from '@psw/core';
import { deleteScene, listScenes, putScene, type SavedScene } from './lib/db';
import { fetchAiStatus, requestProposal } from './lib/ai';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  proposal?: Proposal;
  warnings?: string[];
  pending?: { key?: string; question: string }[];
  source?: 'llm' | 'rules';
}

export interface CompareState {
  key: string;
  label: string;
  unit?: string;
  values: [number, number];
  runs: [Run, Run];
}

interface AppState {
  scene: Scene;
  run: Run;
  issues: Issue[];
  time: number;
  playing: boolean;
  speed: number;
  messages: ChatMessage[];
  busy: boolean;
  compare: CompareState | null;
  library: SavedScene[];
  libraryOpen: boolean;
  toast: string | null;
  aiEnabled: boolean;
  aiModel: string | null;

  setScene: (scene: Scene) => void;
  setParam: (key: string, value: ParamValue) => void;
  resetParams: () => void;
  selectModel: (modelId: string) => void;
  setDuration: (duration: number) => void;
  rename: (name: string) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  seek: (time: number) => void;
  tick: (dt: number) => void;
  send: (text: string) => Promise<void>;
  applyProposal: (messageId: string) => void;
  dismissProposal: (messageId: string) => void;
  runCompare: (messageId: string) => void;
  clearCompare: () => void;
  refreshLibrary: () => Promise<void>;
  saveCurrent: () => Promise<void>;
  loadSaved: (sceneId: string) => Promise<void>;
  removeSaved: (sceneId: string) => Promise<void>;
  setLibraryOpen: (open: boolean) => void;
  notify: (text: string) => void;
  checkAi: () => Promise<void>;
}

let messageSeq = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function nextId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}_${messageSeq}`;
}

function derive(scene: Scene): { run: Run; issues: Issue[] } {
  return { run: simulateScene(scene), issues: validateScene(scene) };
}

const bootstrapScene = createScene('horizontal-block');

export const useApp = create<AppState>((set, get) => ({
  scene: bootstrapScene,
  ...derive(bootstrapScene),
  time: 0,
  playing: false,
  speed: 1,
  messages: [
    {
      id: nextId('msg'),
      role: 'assistant',
      text: '我是这个工作台的建模助手。你可以直接说要改什么参数，或者问「为什么滑块最后停下来了」。所有计算都由经过验证的物理模型完成，我只负责把你的话变成结构化提案。',
    },
  ],
  busy: false,
  compare: null,
  library: [],
  libraryOpen: false,
  toast: null,
  aiEnabled: false,
  aiModel: null,

  setScene: (scene) => {
    const { run, issues } = derive(scene);
    set({ scene, run, issues, time: 0, playing: false });
  },

  setParam: (key, value) => {
    const { scene } = get();
    get().setScene({ ...scene, params: { ...scene.params, [key]: value }, updatedAt: new Date().toISOString() });
  },

  resetParams: () => {
    const { scene } = get();
    const model = getModel(scene.modelId);
    if (!model) return;
    get().setScene({ ...scene, params: model.createDefaultParams(), updatedAt: new Date().toISOString() });
  },

  selectModel: (modelId) => {
    const model = getModel(modelId);
    if (!model) return;
    const { scene } = get();
    get().setScene(
      createScene(modelId, {
        name: `${model.name}场景`,
        params: model.createDefaultParams(),
        duration: scene.settings.duration_s,
      }),
    );
    set({ compare: null, time: 0 });
  },

  setDuration: (duration) => {
    const { scene } = get();
    const clamped = Math.min(60, Math.max(0.2, Number(duration.toFixed(2))));
    get().setScene({ ...scene, settings: { ...scene.settings, duration_s: clamped } });
  },

  rename: (name) => {
    const { scene } = get();
    set({ scene: { ...scene, name: name.slice(0, 160) } });
  },

  setPlaying: (playing) => {
    const { time, run } = get();
    if (playing && time >= run.duration_s) set({ time: 0 });
    set({ playing });
  },

  setSpeed: (speed) => set({ speed }),

  seek: (time) => {
    const { run } = get();
    set({ time: Math.min(run.duration_s, Math.max(0, time)), playing: false });
  },

  tick: (dt) => {
    const { playing, time, speed, run } = get();
    if (!playing) return;
    const next = time + dt * speed;
    if (next >= run.duration_s) {
      set({ time: run.duration_s, playing: false });
      return;
    }
    set({ time: next });
  },

  send: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().busy) return;
    const userMessage: ChatMessage = { id: nextId('msg'), role: 'user', text: trimmed };
    set((state) => ({ messages: [...state.messages, userMessage], busy: true }));

    const { scene, run } = get();
    const response = await requestProposal(trimmed, scene, run);
    const proposal = response.proposal;
    const assistant: ChatMessage = {
      id: nextId('msg'),
      role: 'assistant',
      text: proposal.message,
      source: response.source,
      ...(proposal.warnings.length > 0 ? { warnings: proposal.warnings } : {}),
      ...(proposal.pending.length > 0 ? { pending: proposal.pending } : {}),
      ...(proposal.ops.length > 0 || proposal.compare ? { proposal } : {}),
    };
    set((state) => ({ messages: [...state.messages, assistant], busy: false }));
  },

  applyProposal: (messageId) => {
    const { messages, scene } = get();
    const message = messages.find((item) => item.id === messageId);
    const proposal = message?.proposal;
    if (!proposal) return;
    if (proposal.compare) {
      get().runCompare(messageId);
      return;
    }
    const result = applyOps(scene, proposal.ops, proposal.baseRevision);
    if (!result.ok) {
      set((state) => ({
        messages: [
          ...state.messages,
          { id: nextId('msg'), role: 'assistant', text: `应用失败：${result.error ?? '未知原因'}` },
        ],
      }));
      return;
    }
    get().setScene(result.scene);
    set((state) => ({
      messages: [
        ...state.messages.filter((item) => item.id !== messageId),
        ...(message ? [{ ...message, proposal: undefined }] : []),
        {
          id: nextId('msg'),
          role: 'assistant',
          text: `已应用，场景更新为修订 r${result.scene.revision}，结果已重新计算。`,
        },
      ],
    }));
    get().notify('提案已应用');
  },

  dismissProposal: (messageId) => {
    set((state) => ({
      messages: state.messages.map((item) =>
        item.id === messageId ? { ...item, proposal: undefined } : item,
      ),
    }));
  },

  runCompare: (messageId) => {
    const message = get().messages.find((item) => item.id === messageId);
    const plan = message?.proposal?.compare;
    if (!plan) return;
    const { scene } = get();
    const runWith = (value: number): Run =>
      simulateScene({ ...scene, params: { ...scene.params, [plan.key]: value } });
    const runs: [Run, Run] = [runWith(plan.a), runWith(plan.b)];
    set({
      compare: {
        key: plan.key,
        label: plan.label ?? plan.key,
        ...(plan.unit ? { unit: plan.unit } : {}),
        values: [plan.a, plan.b],
        runs,
      },
    });
    get().notify('对比已生成');
  },

  clearCompare: () => set({ compare: null }),

  refreshLibrary: async () => {
    const items = await listScenes();
    set({ library: items });
  },

  saveCurrent: async () => {
    const { scene } = get();
    const stamped: Scene = { ...scene, updatedAt: new Date().toISOString() };
    set({ scene: stamped });
    await putScene(stamped);
    await get().refreshLibrary();
    get().notify('场景已保存到本地场景库');
  },

  loadSaved: async (sceneId) => {
    const items = await listScenes();
    const found = items.find((item) => item.sceneId === sceneId);
    if (!found) return;
    get().setScene(found.scene);
    set({ libraryOpen: false, compare: null });
    get().notify(`已打开「${found.name}」`);
  },

  removeSaved: async (sceneId) => {
    await deleteScene(sceneId);
    await get().refreshLibrary();
  },

  setLibraryOpen: (open) => set({ libraryOpen: open }),

  notify: (text) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: text });
    toastTimer = setTimeout(() => set({ toast: null }), 2400);
  },

  checkAi: async () => {
    const status = await fetchAiStatus();
    set({ aiEnabled: status.enabled, aiModel: status.model ?? null });
  },
}));

export const MODEL_LIST = MODELS;
