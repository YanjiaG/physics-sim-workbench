import type {
  ComparePlan,
  ModelDefinition,
  ParamDiff,
  ParamSpec,
  Params,
  PendingItem,
  Proposal,
  ProposalOp,
  Run,
  Scene,
} from '../types';
import { applyOps, createScene, diffScenes } from '../scene/ops';
import { validateScene } from '../scene/schema';
import { getModel, MODELS } from '../models';
import { explainRun } from './explain';

// ---------------------------------------------------------------------------
// 文本归一化
// ---------------------------------------------------------------------------

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

/** 把「零点三」「三十」这类常见中文数字转成阿拉伯数字，覆盖到 99。 */
export function normalizeText(input: string): string {
  return input
    .replace(/[０-９]/g, (ch) => String(ch.charCodeAt(0) - 0xff10))
    .replace(/[．。]/g, '.')
    .replace(/[＋]/g, '+')
    .replace(/[－−]/g, '-')
    .replace(/([零〇一二两三四五六七八九])点([零〇一二两三四五六七八九]+)/g, (_all, intPart: string, decPart: string) => `${CN_DIGITS[intPart] ?? 0}.${[...decPart].map((ch) => CN_DIGITS[ch] ?? 0).join('')}`)
    .replace(/[十][零〇一二两三四五六七八九]/g, (all) => String(10 + (CN_DIGITS[all[1] ?? '零'] ?? 0)))
    .replace(/[二两三四五六七八九]十/g, (all) => String((CN_DIGITS[all[0] ?? '零'] ?? 0) * 10))
    .replace(/(?<![零〇一二两三四五六七八九十])十(?![零〇一二两三四五六七八九])/g, '10')
    .replace(/[零〇一二两三四五六七八九]/g, (ch) => String(CN_DIGITS[ch] ?? ch));
}

// ---------------------------------------------------------------------------
// 参数别名表
// ---------------------------------------------------------------------------

interface AliasEntry {
  key: string;
  /** 'both' 表示同时写入静摩擦与动摩擦 */
  mode?: 'both';
  aliases: string[];
}

const ALIASES: AliasEntry[] = [
  { key: 'mass_kg', aliases: ['质量', '物块质量', '滑块质量', '物体质量'] },
  { key: 'mass_board_kg', aliases: ['木板质量', '板质量', '板的质量'] },
  { key: 'gravity_m_s2', aliases: ['重力加速度', '重力场'] },
  { key: 'mu_static_bb', aliases: ['界面静摩擦系数', '界面静摩擦因数', '滑块与木板静摩擦系数', '滑块与木板间静摩擦系数'] },
  { key: 'mu_kinetic_bb', aliases: ['界面动摩擦系数', '界面动摩擦因数', '滑块与木板动摩擦系数', '滑块与木板间动摩擦系数'] },
  { key: 'mu_static_ground', aliases: ['地面静摩擦系数', '地面静摩擦因数', '木板与地面静摩擦系数', '木板与地面间静摩擦系数'] },
  { key: 'mu_kinetic_ground', aliases: ['地面动摩擦系数', '地面动摩擦因数', '木板与地面动摩擦系数', '木板与地面间动摩擦系数'] },
  { key: 'mu_static', aliases: ['静摩擦系数', '静摩擦因数', '最大静摩擦系数', 'μs', 'μ_s'] },
  { key: 'mu_kinetic', aliases: ['动摩擦系数', '动摩擦因数', '滑动摩擦系数', '滑动摩擦因数', 'μk', 'μ_k'] },
  { key: 'applied_force_N', aliases: ['水平外力', '外力', '推力', '拉力', '水平推力', '水平拉力', '施加的力'] },
  { key: 'initial_velocity_m_s', aliases: ['初速度', '起始速度', '初始速度', 'v0', 'v₀'] },
  { key: 'initial_velocity_block_m_s', aliases: ['滑块初速度', '物块初速度'] },
  { key: 'initial_velocity_board_m_s', aliases: ['木板初速度', '板初速度', '板的初速度'] },
  { key: 'initial_position_m', aliases: ['初始位置', '起始位置', '初位置', '起点位置', 'x0', 'x₀'] },
  { key: 'initial_offset_m', aliases: ['初始偏移', '滑块初始位置', '距左端距离', '离左端'] },
  { key: 'angle_deg', aliases: ['倾角', '斜面倾角', '倾角Δ', '角度', 'θ'] },
  { key: 'incline_length_m', aliases: ['斜面长度', '斜面长', '斜面总长'] },
  { key: 'board_length_m', aliases: ['木板长度', '木板长', '板长'] },
  { key: 'belt_length_m', aliases: ['传送带长度', '传送带长', '带长'] },
  { key: 'belt_speed_m_s', aliases: ['传送带速度', '带速', '传送带速率', '皮带速度', 'v带', 'vb'] },
  { key: 'mu', aliases: ['摩擦系数', '摩擦因数', 'mu'], mode: 'both' },
];

const MODEL_KEYWORDS: { modelId: string; keywords: string[] }[] = [
  { modelId: 'incline-block', keywords: ['斜面', '斜坡', '倾斜', '倾角'] },
  { modelId: 'board-block', keywords: ['长木板', '木板', '板块'] },
  { modelId: 'conveyor-block', keywords: ['传送带', '皮带', '履带'] },
  { modelId: 'horizontal-block', keywords: ['水平面', '水平', '地面'] },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasPattern(alias: string): string {
  const escaped = escapeRegExp(alias);
  // 纯 ASCII 别名两侧要求不是字母，避免 'mu' 命中 'mu_static'
  if (/^[A-Za-z_]+$/.test(alias)) return `(?<![A-Za-z_])${escaped}(?![A-Za-z_])`;
  return escaped;
}

const SEP = '(?:\\s*(?:=|＝|:|：|是|为|等于|改成|改为|改到|设成|设为|调到|调成|变成|取|到|变成))*\\s*';

interface ParsedValue {
  key: string;
  mode?: 'both';
  value: number;
  raw: string;
  alias: string;
}

function parseParamValues(text: string): ParsedValue[] {
  const found: ParsedValue[] = [];
  const consumed: [number, number][] = [];

  for (const entry of ALIASES) {
    // 长别名优先，避免「静摩擦系数」被「摩擦系数」抢先
    const sorted = [...entry.aliases].sort((a, b) => b.length - a.length);
    for (const alias of sorted) {
      const re = new RegExp(`(${aliasPattern(alias)})${SEP}([-+]?\\d+(?:\\.\\d+)?)`, 'g');
      let match: RegExpExecArray | null;
      while ((match = re.exec(text))) {
        const start = match.index;
        if (consumed.some(([s, e]) => start < e && start + match![0].length > s)) continue;
        const value = Number(match[2]);
        if (!Number.isFinite(value)) continue;
        found.push({ key: entry.key, ...(entry.mode ? { mode: entry.mode } : {}), value, raw: match[0], alias });
        consumed.push([start, start + match[0].length]);
      }
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 意图识别
// ---------------------------------------------------------------------------

function detectModelSwitch(text: string, scene: Scene): string | null {
  const switchVerb = /(换成|换到|改用|改到|切换到|切换成|切换|用|做个|来个|演示|变成)/;
  if (!switchVerb.test(text)) return null;
  for (const entry of MODEL_KEYWORDS) {
    if (entry.modelId === scene.modelId) continue;
    if (entry.keywords.some((keyword) => text.includes(keyword))) return entry.modelId;
  }
  return null;
}

function detectCompare(text: string): { key: string; a: number; b: number } | null {
  if (!/对比|比较|比比|相比/.test(text)) return null;
  const pair = text.match(/([-+]?\d+(?:\.\d+)?)\s*(?:和|与|跟|、|vs\.?|VS)\s*([-+]?\d+(?:\.\d+)?)/);
  if (!pair) return null;
  const a = Number(pair[1]);
  const b = Number(pair[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // 找出数字前后提到的参数；没有就默认动摩擦系数
  const before = text.slice(0, pair.index ?? 0);
  const aliasHit = ALIASES.find((entry) => entry.aliases.some((alias) => before.includes(alias)));
  const key = aliasHit && aliasHit.key !== 'mu' ? aliasHit.key : aliasHit ? 'mu_kinetic' : 'mu_kinetic';
  return { key, a, b };
}

const EXAMPLE_UTTERANCES = [
  '把质量改成 2 kg',
  '摩擦系数 0.15，初速度 6 m/s',
  '换成斜面，倾角 30 度',
  '为什么滑块最后停下来了',
];

// ---------------------------------------------------------------------------
// 提案构造
// ---------------------------------------------------------------------------

function paramSpec(model: ModelDefinition | undefined, key: string): ParamSpec | undefined {
  return model?.parameters.find((spec) => spec.key === key);
}

function fmtValue(spec: ParamSpec | undefined, value: unknown): string {
  if (typeof value === 'number') return `${Number(value.toFixed(4))}${spec?.unit ? ` ${spec.unit}` : ''}`;
  return String(value);
}

function signFrom(text: string, key: string, value: number): number {
  if (!/initial_velocity/.test(key)) return value;
  if (/向左|负方向|往左/.test(text)) return -Math.abs(value);
  if (/向右|正方向|往右/.test(text)) return Math.abs(value);
  return value;
}

function buildMessage(scene: Scene, ops: ProposalOp[], diff: ParamDiff[], pending: PendingItem[]): string {
  const parts: string[] = [];
  if (ops.some((op) => op.op === 'switch_model')) {
    const target = ops.find((op) => op.op === 'switch_model');
    if (target && target.op === 'switch_model') {
      parts.push(`把问题模型切换为「${getModel(target.modelId)?.name ?? target.modelId}」。`);
    }
  }
  if (diff.length > 0) {
    const text = diff
      .filter((item) => item.key !== 'modelId')
      .map((item) => `${item.label}：${fmtValue(paramSpec(requireModelOrNull(scene.modelId), item.key), item.from)} → ${fmtValue(paramSpec(requireModelOrNull(scene.modelId), item.key), item.to)}`)
      .join('；');
    if (text) parts.push(`${text}。`);
  }
  if (pending.length > 0) parts.push('有信息需要你确认，见下方待确认项。');
  parts.push('其余条件保持不变，应用后会立即重新计算。');
  return parts.join('');
}

function requireModelOrNull(modelId: string): ModelDefinition | undefined {
  return getModel(modelId);
}

export interface ProposeOptions {
  text: string;
  scene: Scene;
  run?: Run;
}

/** 离线规则解析：确定性、可测试、无网络依赖。 */
export function proposeFromText(input: string, scene: Scene, run?: Run): Proposal {
  const text = normalizeText(input.trim());
  const base = { id: `prop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, baseRevision: scene.revision, source: 'rules' as const };

  if (!text) {
    return {
      ...base,
      intent: 'unknown',
      ops: [],
      message: '我没有读到内容。可以直接描述要改的参数，例如「质量 2 kg」。',
      pending: [{ question: '你想修改什么？' }],
      warnings: [],
    };
  }

  // 1) 解释类
  if (/为什么|为啥|解释|分析一下|怎么回事|原理|讲讲/.test(text) && !parseParamValues(text).length) {
    return {
      ...base,
      intent: 'explain',
      ops: [],
      message: run ? explainRun(run, scene) : '还没有可解释的运行结果，请先点「运行」或调整参数。',
      pending: [],
      warnings: [],
    };
  }

  // 2) 对比类
  const compare = detectCompare(text);
  if (compare) {
    const model = getModel(scene.modelId);
    const spec = model?.parameters.find((item) => item.key === compare.key);
    const plan: ComparePlan = {
      key: compare.key,
      a: compare.a,
      b: compare.b,
      ...(spec?.unit ? { unit: spec.unit } : {}),
      ...(spec?.label ? { label: spec.label } : {}),
    };
    return {
      ...base,
      intent: 'compare',
      ops: [],
      message: `将对比 ${spec?.label ?? compare.key} = ${compare.a} 与 ${compare.b} 两组结果，其余参数相同。`,
      pending: [],
      warnings: [],
      compare: plan,
    };
  }

  // 3) 切换模型（可同时带参数）
  const switchTo = detectModelSwitch(text, scene);
  const parsed = parseParamValues(text);
  if (switchTo) {
    const target = getModel(switchTo);
    const carried: Params = {};
    const dropped: string[] = [];
    const warnings: string[] = [];
    if (target) {
      const defaults = target.createDefaultParams();
      for (const [key, value] of Object.entries(scene.params)) {
        if (key in defaults) carried[key] = value;
        else dropped.push(paramSpec(getModel(scene.modelId), key)?.label ?? key);
      }
      for (const item of parsed) {
        const keys = item.mode === 'both' ? ['mu_static', 'mu_kinetic'] : item.key === 'mu' ? ['mu_kinetic'] : [item.key];
        for (const key of keys) {
          if (key in defaults) carried[key] = signFrom(text, key, item.value);
        }
      }
      // 逐个剔除在新模型里不成立的参数，而不是带一个非法值过去
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const issues = validateScene(createScene(switchTo, { params: carried })).filter((issue) => issue.level === 'error');
        const removable = issues.find((issue) => issue.key && issue.key in carried);
        if (!removable || !removable.key) break;
        const key = removable.key;
        const label = paramSpec(target, key)?.label ?? key;
        delete carried[key];
        warnings.push(`「${label}」在新模型里不适用（${removable.message}），已改用默认值。`);
      }
    }
    const ops: ProposalOp[] = [{ op: 'switch_model', modelId: switchTo, params: carried }];
    if (dropped.length > 0) warnings.push(`以下参数在新模型里没有对应项，已忽略：${dropped.join('、')}。`);
    return {
      ...base,
      intent: 'switch_model',
      ops,
      message: `切换为「${target?.name ?? switchTo}」，保留可复用的参数（质量、g、摩擦、初速度等）。`,
      pending: [],
      warnings,
    };
  }

  // 4) 参数修改
  const model = getModel(scene.modelId);
  if (!model) {
    return { ...base, intent: 'unknown', ops: [], message: `当前场景的模型「${scene.modelId}」未注册。`, pending: [], warnings: [] };
  }

  const ops: ProposalOp[] = [];
  const pending: PendingItem[] = [];
  const warnings: string[] = [];
  const applied = new Set<string>();
  const defaults = model.createDefaultParams();

  for (const item of parsed) {
    const keys = item.mode === 'both' ? ['mu_static', 'mu_kinetic'] : [item.key];
    let matched = false;
    for (const key of keys) {
      const spec = model.parameters.find((entry) => entry.key === key);
      if (!spec || !(key in defaults)) continue;
      const value = signFrom(text, key, item.value);
      if (spec.type === 'number') {
        if (spec.min !== undefined && value < spec.min) {
          warnings.push(`${spec.label} = ${value} 低于允许的最小值 ${spec.min}，已按范围限制。`);
          ops.push({ op: 'set_param', key, value: spec.min });
          matched = true;
          applied.add(key);
          continue;
        }
        if (spec.max !== undefined && value > spec.max) {
          warnings.push(`${spec.label} = ${value} 超过允许的最大值 ${spec.max}，已按范围限制。`);
          ops.push({ op: 'set_param', key, value: spec.max });
          matched = true;
          applied.add(key);
          continue;
        }
      }
      ops.push({ op: 'set_param', key, value });
      matched = true;
      applied.add(key);
    }
    if (!matched) {
      warnings.push(`这条参数在「${model.name}」里没有对应项，已忽略：${item.alias}。`);
    }
  }

  // 省略数值时，给出待确认问题而不是静默猜测
  if (ops.length === 0 && parsed.length === 0) {
    const mentioned = ALIASES.find((entry) => entry.aliases.some((alias) => text.includes(alias)));
    if (mentioned) {
      const spec = model.parameters.find((entry) => entry.key === mentioned.key);
      pending.push({ key: mentioned.key, question: `${spec?.label ?? mentioned.key} 想设成多少？` });
    }
    if (pending.length > 0) {
      return {
        ...base,
        intent: 'unknown',
        ops: [],
        message: '我识别到了参数名称，但缺少数值。',
        pending,
        warnings,
      };
    }
    return {
      ...base,
      intent: 'unknown',
      ops: [],
      message: `这句话我还没理解。可以试着说：${EXAMPLE_UTTERANCES.slice(0, 3).map((item) => `「${item}」`).join('、')}。`,
      pending: [{ question: '你想修改哪个参数，或者想换成哪种问题模型？' }],
      warnings,
    };
  }

  const preview = applyOps(scene, ops, scene.revision);
  const diff = preview.ok ? diffScenes(scene, preview.scene) : [];
  if (!preview.ok && preview.error) warnings.push(preview.error);

  return {
    ...base,
    intent: 'modify',
    ops,
    message: buildMessage(scene, ops, diff, pending),
    pending,
    warnings,
  };
}

/** 提案预览：返回逐项 diff，不修改场景。 */
export function previewProposal(scene: Scene, proposal: Proposal): { diff: ParamDiff[]; error?: string } {
  if (proposal.ops.length === 0) return { diff: [] };
  const result = applyOps(scene, proposal.ops, scene.revision);
  if (!result.ok) return { diff: [], ...(result.error ? { error: result.error } : {}) };
  return { diff: diffScenes(scene, result.scene) };
}

/** 能力清单：告诉 LLM / 界面当前支持哪些模型与参数。 */
export function capabilityBrief(): { models: { id: string; name: string; summary: string; params: string[] }[] } {
  return {
    models: MODELS.map((model) => ({
      id: model.id,
      name: model.name,
      summary: model.summary,
      params: model.parameters.map((spec) => `${spec.key}(${spec.label}${spec.unit ? `, ${spec.unit}` : ''})`),
    })),
  };
}

export { EXAMPLE_UTTERANCES };
