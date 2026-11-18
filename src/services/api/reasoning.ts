/**
 * 按模型名自动推断思考参数的发送方式。
 *
 * 依据各厂商公开文档与第三方实测：
 * - DeepSeek V4：OpenAI 格式用 thinking.type 开关，reasoning_effort 没有关闭档；
 *   Anthropic 格式用 reasoning.effort = none。
 * - Qwen / GLM / Kimi：thinking.type = disabled 可关闭（Kimi 会忽略 budget）。
 * - GPT-5 系列：reasoning_effort 支持 none~max；gpt-5.6 拒绝 thinking 字段。
 * - Gemini Flash：thinking 或 reasoning_effort: none 均可关闭；
 *   Gemini Pro 无法关闭，传关闭参数会 400。
 * - Claude：output_config.effort。
 * - MiniMax：accepts but may ignore；统一用 thinking.type。
 *
 * 这里只做名字匹配，不发起试探请求，也不记录历史结果。
 */

/** 关闭思考时发送的请求片段 */
export type ReasoningParam = Record<string, unknown>

/** 手动指定的发送方式；auto 表示按模型名推断 */
export type ReasoningMode =
  | 'auto'
  | 'thinking-disabled'
  | 'effort-none'
  | 'effort-off'
  | 'effort-low'
  | 'template-thinking'
  | 'none'

/** 推断出的模型族，用于决定关闭思考的写法 */
type Family =
  | 'deepseek'
  | 'qwen'
  | 'glm'
  | 'kimi'
  | 'minimax'
  | 'gpt'
  | 'gemini-pro'
  | 'gemini'
  | 'claude'
  | 'unknown'

const familyOf = (model: string): Family => {
  const name = model.toLowerCase()
  if (name.includes('deepseek')) {
    return 'deepseek'
  }
  if (name.includes('qwen') || name.includes('qwq')) {
    return 'qwen'
  }
  if (name.includes('glm') || name.includes('chatglm')) {
    return 'glm'
  }
  if (name.includes('kimi') || name.includes('moonshot')) {
    return 'kimi'
  }
  if (name.includes('minimax')) {
    return 'minimax'
  }
  if (name.includes('gemini')) {
    // pro 层级无法关闭思考，传关闭参数会被拒绝
    return name.includes('pro') ? 'gemini-pro' : 'gemini'
  }
  if (name.includes('claude')) {
    return 'claude'
  }
  if (/^(gpt|o[134])/.test(name) || name.includes('gpt-')) {
    return 'gpt'
  }
  return 'unknown'
}

/** 各模型族「关闭思考」的写法 */
const offParamFor = (family: Family): ReasoningParam => {
  switch (family) {
    case 'gemini-pro':
      // 官方立场是该层级思考不可停用，不发任何关闭参数，避免 400
      return {}
    case 'claude':
      return { output_config: { effort: 'low' } }
    case 'gpt':
      return { reasoning_effort: 'none' }
    case 'deepseek':
    case 'qwen':
    case 'glm':
    case 'kimi':
    case 'minimax':
      // 这些模型用 thinking.type = disabled 才能真正归零
      return { thinking: { type: 'disabled' } }
    case 'gemini':
      return { thinking: { type: 'disabled' } }
    default:
      // 未知模型优先用兼容性最好的写法
      return { thinking: { type: 'disabled' } }
  }
}

/** 各模型族「开启深思考」的写法 */
const onParamFor = (family: Family): ReasoningParam => {
  switch (family) {
    case 'claude':
      return { output_config: { effort: 'high' } }
    case 'gemini-pro':
    case 'gemini':
      return { reasoning_effort: 'high' }
    default:
      return { reasoning_effort: 'high' }
  }
}

/** 开启思考时可手动指定的发送方式；auto 表示按模型名推断 */
export type ReasoningOnMode =
  | 'auto'
  | 'effort-high'
  | 'effort-medium'
  | 'thinking-enabled'
  | 'output-config-high'
  | 'template-thinking'
  | 'none'

/** 手动指定「开启思考」时的固定写法 */
const manualOnParam = (mode: Exclude<ReasoningOnMode, 'auto'>): ReasoningParam => {
  switch (mode) {
    case 'effort-high':
      return { reasoning_effort: 'high' }
    case 'effort-medium':
      return { reasoning_effort: 'medium' }
    case 'thinking-enabled':
      return { thinking: { type: 'enabled' } }
    case 'output-config-high':
      return { output_config: { effort: 'high' } }
    case 'template-thinking':
      return { chat_template_kwargs: { thinking: true } }
    default:
      return {}
  }
}

/** 手动模式对应的固定写法 */
const manualOffParam = (mode: Exclude<ReasoningMode, 'auto'>): ReasoningParam => {
  switch (mode) {
    case 'thinking-disabled':
      return { thinking: { type: 'disabled' } }
    case 'effort-none':
      return { reasoning_effort: 'none' }
    case 'effort-off':
      return { reasoning_effort: 'off' }
    case 'effort-low':
      return { reasoning_effort: 'low' }
    case 'template-thinking':
      return { chat_template_kwargs: { thinking: false } }
    default:
      return {}
  }
}

/**
 * 计算本次请求的思考参数。
 * 手动指定了具体方式就用它，否则按模型名推断。
 */
export const buildReasoningParam = (
  model: string,
  thinking: boolean,
  mode: ReasoningMode,
  /** 开启思考时的手动写法；缺省按模型名推断 */
  onMode: ReasoningOnMode = 'auto'
): ReasoningParam => {
  if (thinking) {
    return onMode === 'auto' ? onParamFor(familyOf(model)) : manualOnParam(onMode)
  }
  return mode === 'auto' ? offParamFor(familyOf(model)) : manualOffParam(mode)
}

/** 当前模型族是否支持关闭思考，用于界面上给出提示 */
export const canDisableThinking = (model: string): boolean => familyOf(model) !== 'gemini-pro'

/** 生成给用户看的说明，例如「gemini-2.5-pro：该模型无法关闭思考」 */
export const describeReasoning = (model: string): string => {
  const family = familyOf(model)
  switch (family) {
    case 'gemini-pro':
      return 'gemini-pro'
    case 'claude':
      return 'claude'
    case 'gpt':
      return 'gpt'
    case 'deepseek':
      return 'deepseek'
    case 'qwen':
      return 'qwen'
    case 'glm':
      return 'glm'
    case 'kimi':
      return 'kimi'
    case 'minimax':
      return 'minimax'
    case 'gemini':
      return 'gemini'
    default:
      return 'unknown'
  }
}

/** 诊断结果：一次真实请求，返回网关到底怎么响应 */
export type ProbeResult = {
  /** 发送的请求体里与思考相关的字段 */
  sentParam: ReasoningParam
  /** 网关返回的 HTTP 状态 */
  status: number
  /** 网关是否在思维链里产出了内容 */
  producedReasoning: boolean
  /** 思维链前 200 字，用于肉眼确认 */
  reasoningSample: string
  /**
   * 用量里的推理 token 数；-1 表示网关没有返回该字段。
   * 这是判断「是否真在思考」的硬指标，不受是否回传内容影响。
   */
  reasoningTokens: number
  /** 失败时的原始报错 */
  error?: string
}

/**
 * 用给定参数发一次最小请求，观察网关实际行为：
 * 是否报错、是否仍然产出思维链。用于确认某个写法是否真的生效。
 */
export const probeReasoning = async ({
  baseUrl,
  apiKey,
  model,
  param,
  signal,
}: {
  baseUrl: string
  apiKey: string
  model: string
  param: ReasoningParam
  /** 外部中止：用户点停止时立即结束请求 */
  signal?: AbortSignal
}): Promise<ProbeResult> => {
  const { normalizeBaseUrl } = await import('./openai.js')
  const { readServerSentEvents } = await import('./sse.js')
  const empty: ProbeResult = {
    sentParam: param,
    status: 0,
    producedReasoning: false,
    reasoningSample: '',
    reasoningTokens: -1,
  }
  let response: Response
  try {
    response = await fetch(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '9.11 和 9.8 哪个大？' }],
        stream: true,
        max_tokens: 200,
        // 让流里带上 usage，才能读到 reasoning_tokens
        stream_options: { include_usage: true },
        ...param,
      }),
      signal,
    })
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { ...empty, status: response.status, error: text.slice(0, 500) || response.statusText }
  }
  if (!response.body) {
    return { ...empty, status: response.status, error: '没有响应体' }
  }
  let reasoning = ''
  let reasoningTokens = -1
  let sawUsage = false
  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      break
    }
    try {
      const chunk = JSON.parse(data) as {
        choices?: { delta?: { reasoning_content?: string; reasoning?: string } }[]
        usage?: {
          completion_tokens_details?: { reasoning_tokens?: number }
          completion_tokens?: number
        }
      }
      const delta = chunk.choices?.[0]?.delta
      const piece = delta?.reasoning_content ?? delta?.reasoning
      // 空字符串不算产出内容，避免把空帧误判成在思考
      if (typeof piece === 'string' && piece) {
        reasoning += piece
      }
      // 有的网关把 usage 放在最后一个分片，也可能放在每个分片里
      if (chunk.usage) {
        sawUsage = true
        const tokens = chunk.usage.completion_tokens_details?.reasoning_tokens
        if (typeof tokens === 'number') {
          reasoningTokens = Math.max(reasoningTokens, tokens)
        } else if (reasoningTokens < 0) {
          // 网关只给总输出、不给细分时记 0，表示「没有可观测的推理用量」
          reasoningTokens = 0
        }
      }
    } catch {
      // 忽略无法解析的分片
    }
  }
  if (!sawUsage) {
    reasoningTokens = -1
  }
  return {
    sentParam: param,
    status: response.status,
    producedReasoning: reasoning.length > 0,
    reasoningSample: reasoning.slice(0, 200),
    reasoningTokens,
  }
}
