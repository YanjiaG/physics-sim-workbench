import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 8787);
const API_KEY = process.env.OPENAI_API_KEY ?? '';
const BASE_URL = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
const MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 20000);

const ALLOWED_INTENTS = new Set(['modify', 'switch_model', 'compare', 'explain', 'unknown']);

function cors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function systemPrompt(scene, spec, models) {
  const paramLines = spec
    .map((item) => {
      const range = item.min !== null && item.max !== null ? `，范围 ${item.min}–${item.max}` : '';
      const unit = item.unit ? ` ${item.unit}` : '';
      return `- ${item.key}：${item.label}${unit}（当前 ${JSON.stringify(scene.params?.[item.key] ?? null)}${range}）`;
    })
    .join('\n');
  const modelLines = models.map((item) => `- ${item.id}：${item.name}，参数 ${item.params.join(', ')}`).join('\n');
  return [
    '你是一个物理仿真工作台的建模助手。用户会用中文描述对当前场景的修改意愿。',
    '你只能输出一个 JSON 对象，不要输出 Markdown 代码块或任何解释性文字。',
    'JSON 结构：',
    '{"intent":"modify|switch_model|compare|explain|unknown","ops":[{"op":"set_param","key":"参数键","value":数值或布尔}],"message":"给用户看的一句中文说明","pending":[]}',
    '规则：',
    '1. 只允许使用下面列出的参数键；不确定用户意图时 intent 用 unknown，message 请用户补充。',
    '2. 切换模型时 ops 为 [{"op":"switch_model","modelId":"模型 id","params":{可选公共参数}}]，只搬运目标模型也支持的参数。',
    '3. compare 意图请输出 {"intent":"compare","ops":[],"message":"...","compare":{"key":"参数键","a":数,"b":数}}。',
    '4. 数值必须在给定范围内；用户没说单位时按国际单位理解。',
    '5. 不要编造物理计算结果，计算由工作台的物理模型完成。',
    '',
    `当前模型：${scene.modelId}`,
    '当前参数：',
    paramLines,
    '',
    '可用模型：',
    modelLines,
  ].join('\n');
}

async function callModel(scene, text, spec, models) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt(scene, spec, models) },
          { role: 'user', content: text },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`上游返回 ${response.status}: ${detail.slice(0, 300)}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') throw new Error('上游返回空内容');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(content) {
  const trimmed = content.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('模型输出不是合法 JSON');
  }
}

function clampNumber(value, min, max) {
  let next = value;
  if (typeof min === 'number' && next < min) next = min;
  if (typeof max === 'number' && next > max) next = max;
  return next;
}

/** 把模型输出收敛成工作台能安全应用的提案：白名单操作、范围夹取、丢弃未知键。 */
function sanitize(raw, scene, spec, models) {
  const specByKey = new Map(spec.map((item) => [item.key, item]));
  const modelIds = new Set(models.map((item) => item.id));
  const warnings = [];
  const ops = [];

  const intent = ALLOWED_INTENTS.has(raw?.intent) ? raw.intent : 'modify';
  const rawOps = Array.isArray(raw?.ops) ? raw.ops : [];

  for (const op of rawOps) {
    if (!op || typeof op !== 'object') continue;
    if (op.op === 'set_param') {
      const key = typeof op.key === 'string' ? op.key : '';
      const paramSpec = specByKey.get(key);
      if (!paramSpec) {
        warnings.push(`模型给出了当前模型没有的参数「${key}」，已忽略。`);
        continue;
      }
      if (paramSpec.type === 'boolean') {
        if (typeof op.value === 'boolean') ops.push({ op: 'set_param', key, value: op.value });
        else warnings.push(`参数「${paramSpec.label}」需要一个开关值，已忽略。`);
        continue;
      }
      const numeric = typeof op.value === 'number' ? op.value : Number.parseFloat(String(op.value));
      if (!Number.isFinite(numeric)) {
        warnings.push(`参数「${paramSpec.label}」的数值无法识别，已忽略。`);
        continue;
      }
      const clamped = clampNumber(numeric, paramSpec.min, paramSpec.max);
      if (clamped !== numeric) warnings.push(`参数「${paramSpec.label}」超出范围，已收到 ${clamped}。`);
      ops.push({ op: 'set_param', key, value: clamped });
      continue;
    }
    if (op.op === 'switch_model') {
      const modelId = typeof op.modelId === 'string' ? op.modelId : '';
      if (!modelIds.has(modelId)) {
        warnings.push(`模型「${modelId}」不在可用列表里，已忽略。`);
        continue;
      }
      ops.push({ op: 'switch_model', modelId });
      continue;
    }
    warnings.push(`不支持的操作「${String(op.op)}」，已忽略。`);
  }

  let compare;
  if (raw?.compare && typeof raw.compare === 'object') {
    const key = typeof raw.compare.key === 'string' ? raw.compare.key : '';
    const a = Number(raw.compare.a);
    const b = Number(raw.compare.b);
    if (specByKey.has(key) && Number.isFinite(a) && Number.isFinite(b)) {
      compare = { key, a, b };
    } else {
      warnings.push('对比请求缺少有效的参数或数值，已忽略。');
    }
  }

  const effectiveIntent = compare ? 'compare' : ops.length > 0 ? intent : intent === 'explain' || intent === 'unknown' ? intent : 'unknown';
  const message =
    typeof raw?.message === 'string' && raw.message.trim() !== ''
      ? raw.message.trim()
      : effectiveIntent === 'unknown'
        ? '我没有从这句话里识别出要修改的参数。可以说「把质量改成 2 kg」或「换成斜面」。'
        : '已按你的描述生成提案。';

  const pending = Array.isArray(raw?.pending)
    ? raw.pending
        .filter((item) => item && typeof item.question === 'string')
        .slice(0, 3)
        .map((item) => ({ question: String(item.question), ...(typeof item.key === 'string' ? { key: item.key } : {}) }))
    : [];

  return {
    id: `llm_${Date.now().toString(36)}`,
    baseRevision: scene.revision,
    intent: effectiveIntent,
    ops,
    message,
    pending,
    warnings,
    ...(compare ? { compare } : {}),
    source: 'llm',
  };
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

  if (req.method === 'GET' && url.pathname === '/api/ai/status') {
    sendJson(res, 200, { enabled: Boolean(API_KEY), model: API_KEY ? MODEL : null });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ai/propose') {
    if (!API_KEY) {
      sendJson(res, 200, { ok: false, reason: '未配置 OPENAI_API_KEY，使用离线规则解析' });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      sendJson(res, 400, { ok: false, reason: '请求体不是合法 JSON' });
      return;
    }
    const { text, scene, spec, models } = payload ?? {};
    if (typeof text !== 'string' || !text.trim() || !scene || typeof scene !== 'object') {
      sendJson(res, 400, { ok: false, reason: '缺少 text 或 scene' });
      return;
    }
    try {
      const content = await callModel(scene, text.trim(), Array.isArray(spec) ? spec : [], Array.isArray(models) ? models : []);
      const raw = extractJson(content);
      const proposal = sanitize(raw, scene, Array.isArray(spec) ? spec : [], Array.isArray(models) ? models : []);
      sendJson(res, 200, { ok: true, proposal });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '调用模型失败';
      sendJson(res, 200, { ok: false, reason });
    }
    return;
  }

  sendJson(res, 404, { ok: false, reason: '未找到该接口' });
});

server.listen(PORT, '127.0.0.1', () => {
  const mode = API_KEY ? `LLM 模式（${MODEL}）` : '离线模式（未配置 OPENAI_API_KEY）';
  console.log(`physics-sim-workbench AI service → http://127.0.0.1:${PORT}  ${mode}`);
});
