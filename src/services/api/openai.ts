/**
 * OpenAI 兼容接口（Chat Completions）客户端。
 *
 * 只负责把「OpenAI 格式的流式分片」翻译成应用内部使用的 MessageStreamEvent，
 * 这样上层（会话、渲染、续写）不需要知道当前用的是哪家服务。
 * 参考：https://platform.openai.com/docs/api-reference/chat-streaming
 */

import { ApiError, readErrorResponse, request } from './client.js'
import { readServerSentEvents } from './sse.js'
import type {
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
  TextBlockParam,
} from './types.js'

/**
 * 关闭思考时发送的请求片段，不同网关形式不同：
 * - reasoning_effort：OpenAI 风格，如 { reasoning_effort: 'none' }
 * - thinking：DeepSeek 官方风格，如 { thinking: { type: 'disabled' } }
 * - chat_template_kwargs：vLLM 等风格，如 { chat_template_kwargs: { thinking: false } }
 */
export type ReasoningParam = Record<string, unknown>

/** 用户没填地址时的兜底值 */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

/**
 * 规范化用户填写的调用地址：
 * - 自动补 https://，去掉末尾多余的斜杠；
 * - 用户把完整的 /chat/completions 或者兼容层前缀贴进来时，去掉重复后缀。
 */
export const normalizeBaseUrl = (input: string): string => {
  let url = input.trim().replace(/\/+$/, '')
  if (!url) {
    return ''
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  url = url.replace(/\/chat\/completions$/i, '')
  url = url.replace(/\/+$/, '')
  return url
}

// ---------- 请求：转换成 OpenAI 的 messages ----------

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[]
  /** assistant 发起的工具调用 */
  tool_calls?: {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }[]
  /** role 为 tool 时对应的调用 id */
  tool_call_id?: string
}

/** 附件本地 id → data URL；已在内联图片时才需要 */
export type ImageDataUrls = ReadonlyMap<string, string>

/** 把 Anthropic 风格的文本块拼成一个字符串，非文本块（工具、思考）不发送 */
const textOf = (content: unknown): string => {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((block) => ((block as TextBlockParam | undefined)?.type === 'text' ? block.text : ''))
    .join('')
}

/**
 * 会话请求转 OpenAI messages：
 * - 省去 latest_reminder 这类扩展角色；
 * - 用户附件里的图片按 data URL 内联（不依赖 Files API），文档附件没有对应格式，直接跳过；
 * - assistant 的思考、引用、工具块都不回传，只发正文。
 */
export const toOpenAIMessages = (
  system: string,
  messages: MessageParam[],
  images: ImageDataUrls
): OpenAIMessage[] => {
  const result: OpenAIMessage[] = system ? [{ role: 'system', content: system }] : []
  for (const message of messages) {
    if (message.role === 'latest_reminder') {
      continue
    }
    if (message.role === 'assistant') {
      result.push({ role: 'assistant', content: textOf(message.content) })
      continue
    }
    if (typeof message.content === 'string') {
      result.push({ role: 'user', content: message.content })
      continue
    }
    const parts: OpenAIContentPart[] = []
    for (const block of message.content) {
      if (block.type === 'text') {
        if (block.text) {
          parts.push({ type: 'text', text: block.text })
        }
        continue
      }
      if (block.type !== 'image' || block.source.type !== 'file') {
        continue
      }
      const url = images.get(block.source.file_id)
      if (url) {
        parts.push({ type: 'image_url', image_url: { url } })
      }
    }
    // 只有图片时也必须带上 content 数组；空数组会被部分服务端拒绝
    result.push({ role: 'user', content: parts.length > 0 ? parts : '' })
  }
  return result
}

// ---------- 响应：OpenAI 分片 → MessageStreamEvent ----------

type OpenAIUsage = {
  prompt_tokens?: number
  completion_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

export type OpenAIChunk = {
  id?: string
  model?: string
  error?: { message?: string }
  usage?: OpenAIUsage
  choices?: {
    delta?: {
      content?: string | null
      /** DeepSeek 等推理模型使用的字段 */
      reasoning_content?: string | null
      /** 部分服务商使用的同义字段 */
      reasoning?: string | null
      role?: string
    }
    finish_reason?: string | null
  }[]
}

const toUsage = (usage: OpenAIUsage | undefined): MessageUsage | undefined => {
  if (!usage) {
    return undefined
  }
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  return {
    input_tokens: Math.max(0, (usage.prompt_tokens ?? 0) - cached),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: usage.completion_tokens ?? 0,
  }
}

/** OpenAI 的结束原因映射成应用内的 stop_reason；content_filter 按安全拒绝处理 */
const toStopReason = (reason: string | null | undefined): StopReason => {
  switch (reason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'content_filter':
      return 'refusal'
    default:
      return 'end_turn'
  }
}

/** 用 GET /models 校验地址与 Key（不产生费用）；没有该接口的网关只校验可达性 */
export const verifyOpenAIEndpoint = async (
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<void> => {
  const url = `${normalizeBaseUrl(baseUrl)}/models`
  try {
    await request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
  } catch (error) {
    // 部分兼容网关不实现 /models，此时无法预先校验 Key，交给首次对话暴露问题
    if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
      return
    }
    throw error
  }
}

/**
 * GET {baseUrl}/models：拉取端点支持的模型列表。
 * 部分网关不实现该接口或返回结构不同，失败时返回空数组由界面兜底。
 */
export const fetchOpenAIModels = async (
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> => {
  try {
    const response = await request(`${normalizeBaseUrl(baseUrl)}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
    const payload = (await response.json()) as { data?: { id?: string }[] }
    return (payload.data ?? [])
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/**
 * POST {baseUrl}/chat/completions（stream: true），把分片翻译成 MessageStreamEvent。
 * 正文与思考内容各自成块，切换时先结束上一个块；收到 [DONE] 或流结束时补齐收尾事件。
 */
export async function* streamOpenAIMessage({
  baseUrl,
  apiKey,
  model,
  system,
  messages,
  images,
  reasoningParam = {},
  signal,
}: {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  messages: MessageParam[]
  images: ImageDataUrls
  /** 思考相关参数；关闭时不发送则传空对象 */
  reasoningParam?: ReasoningParam
  signal: AbortSignal
}): AsyncGenerator<MessageStreamEvent> {
  const response = await request(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      messages: toOpenAIMessages(system, messages, images),
      stream: true,
      ...reasoningParam,
    }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  let started = false
  let nextIndex = 0
  /** 当前打开（尚未结束）的内容块索引 */
  let openIndex: number | null = null
  let openKind: 'text' | 'thinking' | null = null
  let finishReason: string | null = null
  let usage: MessageUsage | undefined

  const startMessage = (chunk: OpenAIChunk): MessageStreamEvent => {
    started = true
    return {
      type: 'message_start',
      message: {
        id: chunk.id ?? '',
        model: chunk.model ?? model,
        ...(toUsage(chunk.usage) ? { usage: toUsage(chunk.usage) } : {}),
      },
    }
  }

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      if (openIndex !== null) {
        yield { type: 'content_block_stop', index: openIndex }
        openIndex = null
        openKind = null
      }
      yield {
        type: 'message_delta',
        delta: { stop_reason: toStopReason(finishReason), stop_sequence: null },
        ...(usage ? { usage } : {}),
      }
      yield { type: 'message_stop' }
      return
    }
    let chunk: OpenAIChunk
    try {
      chunk = JSON.parse(data) as OpenAIChunk
    } catch {
      continue
    }
    if (chunk.error) {
      throw new ApiError('stream', chunk.error.message ?? data)
    }
    if (!started) {
      yield startMessage(chunk)
    }
    if (chunk.usage) {
      usage = toUsage(chunk.usage)
    }
    const choice = chunk.choices?.[0]
    if (!choice) {
      continue
    }
    const delta = choice.delta ?? {}
    const reasoning = delta.reasoning_content ?? delta.reasoning
    // 思考内容优先成块，正文到达时自动切换到文本块
    if (typeof reasoning === 'string' && reasoning) {
      if (openKind !== 'thinking') {
        if (openIndex !== null) {
          yield { type: 'content_block_stop', index: openIndex }
        }
        openIndex = nextIndex++
        openKind = 'thinking'
        yield {
          type: 'content_block_start',
          index: openIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: openIndex ?? 0,
        delta: { type: 'thinking_delta', thinking: reasoning },
      }
    }
    if (typeof delta.content === 'string' && delta.content) {
      if (openKind !== 'text') {
        if (openIndex !== null) {
          yield { type: 'content_block_stop', index: openIndex }
        }
        openIndex = nextIndex++
        openKind = 'text'
        yield {
          type: 'content_block_start',
          index: openIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: openIndex ?? 0,
        delta: { type: 'text_delta', text: delta.content },
      }
    }
    if (choice.finish_reason) {
      finishReason = choice.finish_reason
    }
  }

  // 没有收到 [DONE]：按已收到的内容正常收尾，而不是报错
  if (!started) {
    throw new ApiError('protocol', '')
  }
  if (openIndex !== null) {
    yield { type: 'content_block_stop', index: openIndex }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: toStopReason(finishReason), stop_sequence: null },
    ...(usage ? { usage } : {}),
  }
  yield { type: 'message_stop' }
}
