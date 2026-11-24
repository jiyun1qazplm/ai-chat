/**
 * Google Gemini 原生格式客户端（generateContent / streamGenerateContent）。
 *
 * 与 OpenAI 格式差异很大：内容用 parts 数组、角色是 user/model、
 * 系统提示在 systemInstruction、流式返回的是完整 chunk 而非增量。
 * 这里负责把应用的内部结构翻译成 Gemini 请求，再把响应翻回内部的 MessageStreamEvent。
 *
 * 文档：https://ai.google.dev/api/generate-content
 */

import { ApiError, readErrorResponse } from './client.js'
import { toGeminiFunctionDeclarations } from '../tools/localTools.js'
import type {
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
  TextBlockParam,
} from './types.js'

/** Gemini 默认接口地址；用户也可以填自己的代理 */
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/** 规范化地址：补 https、去末尾斜杠与多余路径 */
export const normalizeGeminiBaseUrl = (input: string): string => {
  let url = input.trim().replace(/\/+$/, '')
  if (!url) {
    return ''
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  url = url.replace(/\/models\/.*$/i, '')
  url = url.replace(/:generateContent.*$/i, '')
  return url.replace(/\/+$/, '')
}

// ---------- 请求 ----------

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  /** 工具往返：调用与结果 */
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { result: string } } }

type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

/** 附件本地 id → data URL，用于把图片转成 inlineData */
export type ImageDataUrls = ReadonlyMap<string, string>

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

/** 把 data URL 拆成 inlineData 需要的 mimeType 与 base64 */
const toInlineData = (url: string): { mimeType: string; data: string } | null => {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url)
  return match ? { mimeType: match[1], data: match[2] } : null
}

/**
 * 会话请求转 Gemini 的 contents：
 * - 跳过 latest_reminder 扩展角色；
 * - assistant 变 role: model，只发正文；
 * - 图片附件内联为 inlineData，其余附件跳过。
 */
export const toGeminiContents = (
  messages: MessageParam[],
  images: ImageDataUrls
): GeminiContent[] => {
  const contents: GeminiContent[] = []
  for (const message of messages) {
    if (message.role === 'latest_reminder') {
      continue
    }
    if (message.role === 'assistant') {
      const text = textOf(message.content)
      if (text) {
        contents.push({ role: 'model', parts: [{ text }] })
      }
      continue
    }
    if (typeof message.content === 'string') {
      contents.push({ role: 'user', parts: [{ text: message.content }] })
      continue
    }
    const parts: GeminiPart[] = []
    for (const block of message.content) {
      if (block.type === 'text') {
        if (block.text) {
          parts.push({ text: block.text })
        }
        continue
      }
      if (block.type !== 'image' || block.source.type !== 'file') {
        continue
      }
      const url = images.get(block.source.file_id)
      const inline = url ? toInlineData(url) : null
      if (inline) {
        parts.push({ inlineData: inline })
      }
    }
    if (parts.length > 0) {
      contents.push({ role: 'user', parts })
    }
  }
  return contents
}

/** 用 GET /models 校验 Key */
export const verifyGeminiEndpoint = async (
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<void> => {
  const response = await fetch(
    `${normalizeGeminiBaseUrl(baseUrl)}/models?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'GET',
      signal,
    }
  )
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
}

/** GET /models 拉取可用模型名 */
export const fetchGeminiModels = async (
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> => {
  try {
    const response = await fetch(
      `${normalizeGeminiBaseUrl(baseUrl)}/models?key=${encodeURIComponent(apiKey)}`,
      { method: 'GET', signal }
    )
    if (!response.ok) {
      return []
    }
    const payload = (await response.json()) as { models?: { name?: string }[] }
    return (payload.models ?? [])
      .map((item) => (item.name ?? '').replace(/^models\//, ''))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

// ---------- 响应 ----------

type GeminiChunk = {
  candidates?: {
    content?: {
      parts?: {
        text?: string
        thought?: boolean
        functionCall?: { name?: string; args?: Record<string, unknown> }
      }[]
    }
    finishReason?: string
  }[]
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    thoughtsTokenCount?: number
    cachedContentTokenCount?: number
  }
  error?: { message?: string }
}

const toStopReason = (reason: string | undefined): StopReason => {
  switch (reason) {
    case 'MAX_TOKENS':
      return 'max_tokens'
    case 'SAFETY':
    case 'RECITATION':
    case 'PROHIBITED_CONTENT':
      return 'refusal'
    default:
      return 'end_turn'
  }
}

/** 把一次工具往返翻译成 Gemini 的 model + user 两条内容 */
export const toGeminiToolContents = (turn: {
  calls: { name: string; args: Record<string, unknown> }[]
  results: { name: string; text: string }[]
}): GeminiContent[] => [
  { role: 'model', parts: turn.calls.map((call) => ({ functionCall: call })) },
  {
    role: 'user',
    parts: turn.results.map((result) => ({
      functionResponse: { name: result.name, response: { result: result.text } },
    })),
  },
]

/** 思考配置：开启时给思考预算，关闭时设 0 */
export type GeminiThinking = { thinkingBudget: number }

/**
 * POST {base}/models/{model}:streamGenerateContent?alt=sse，翻译成内部事件。
 * Gemini 分片里是完整文本而非增量，这里通过比较长度产出增量。
 */
/** 单轮请求：发一次 streamGenerateContent 并翻译事件 */
async function* streamGeminiOnce({
  baseUrl,
  apiKey,
  model,
  system,
  contents,
  thinking,
  tools,
  signal,
  onToolCall,
}: {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  contents: GeminiContent[]
  thinking?: GeminiThinking
  /** 函数声明：传入后启用工具调用 */
  tools?: unknown[]
  signal: AbortSignal
  /** 收集本轮的函数调用，供外层执行 */
  onToolCall?: (name: string, args: Record<string, unknown>) => void
}): AsyncGenerator<MessageStreamEvent> {
  const name = model.replace(/^models\//, '')
  const url =
    `${normalizeGeminiBaseUrl(baseUrl)}/models/${encodeURIComponent(name)}:streamGenerateContent` +
    `?alt=sse&key=${encodeURIComponent(apiKey)}`

  const body: Record<string, unknown> = {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(thinking
      ? { generationConfig: { thinkingConfig: { thinkingBudget: thinking.thinkingBudget } } }
      : {}),
    ...(tools && tools.length > 0 ? { tools: [{ functionDeclarations: tools }] } : {}),
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    if (signal.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  if (!response.body) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  const { readServerSentEvents } = await import('./sse.js')
  let index = 0
  /** 当前打开的文本块；null 表示还没开始 */
  let openIndex: number | null = null
  let finishReason: string | undefined
  let usage: MessageUsage | undefined
  let sawFunctionCall = false

  yield { type: 'message_start', message: { id: '', model: name } }

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    let chunk: GeminiChunk
    try {
      chunk = JSON.parse(data) as GeminiChunk
    } catch {
      continue
    }
    if (chunk.error) {
      throw new ApiError('stream', chunk.error.message ?? data)
    }
    if (chunk.usageMetadata) {
      usage = {
        input_tokens: chunk.usageMetadata.promptTokenCount ?? 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: chunk.usageMetadata.cachedContentTokenCount ?? 0,
        output_tokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
      }
    }
    const candidate = chunk.candidates?.[0]
    if (!candidate) {
      continue
    }
    if (candidate.finishReason) {
      finishReason = candidate.finishReason
    }
    // 出现了函数调用：本轮不能当作文本回答收尾，交给上层执行工具后继续
    if (candidate.content?.parts?.some((part) => part.functionCall?.name)) {
      sawFunctionCall = true
    }
    for (const part of candidate.content?.parts ?? []) {
      // thought 为 true 的是思考内容，单独成块
      if (part.thought) {
        continue
      }
      // 函数调用：交给外层记录后本地执行，不在正文里产出可见块
      if (part.functionCall?.name) {
        if (openIndex !== null) {
          yield { type: 'content_block_stop', index: openIndex }
          openIndex = null
        }
        onToolCall?.(part.functionCall.name, part.functionCall.args ?? {})
        continue
      }
      const text = part.text ?? ''
      if (!text) {
        continue
      }
      if (openIndex === null) {
        openIndex = index
        yield {
          type: 'content_block_start',
          index: openIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: openIndex,
        delta: { type: 'text_delta', text },
      }
    }
  }

  if (openIndex !== null) {
    yield { type: 'content_block_stop', index: openIndex }
  }
  yield {
    type: 'message_delta',
    delta: { stop_reason: sawFunctionCall ? 'tool_use' : toStopReason(finishReason), stop_sequence: null },
    ...(usage ? { usage } : {}),
  }
  yield { type: 'message_stop' }
}

/** 最多连续几轮工具调用 */
const MAX_TOOL_ROUNDS = 4

/**
 * 对外入口：Gemini 对话（可选本地工具）。
 *
 * 一轮结束后若模型发起了函数调用，就在本地执行，
 * 把 functionCall 与 functionResponse 追加进 contents 再请求下一轮，
 * 正文逐轮增量产出，界面上是连续的一段回答。
 */
export async function* streamGeminiMessage({
  baseUrl,
  apiKey,
  model,
  system,
  messages,
  images,
  thinking,
  runTool,
  signal,
}: {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  messages: MessageParam[]
  images: ImageDataUrls
  thinking?: GeminiThinking
  /** 本地工具执行器；不传则工具不参与对话 */
  runTool?: (name: string, args: Record<string, unknown>) => Promise<string>
  signal: AbortSignal
}): AsyncGenerator<MessageStreamEvent> {
  const contents = toGeminiContents(messages, images)
  const tools = runTool ? toGeminiFunctionDeclarations() : undefined

  for (let round = 0; ; round += 1) {
    const calls: { name: string; args: Record<string, unknown> }[] = []
    yield* streamGeminiOnce({
      baseUrl,
      apiKey,
      model,
      system,
      contents,
      thinking,
      tools,
      signal,
      onToolCall: (name, args) => calls.push({ name, args }),
    })

    if (!runTool || calls.length === 0 || round >= MAX_TOOL_ROUNDS || signal.aborted) {
      return
    }

    // 模型发起调用 → 本地执行 → 结果作为 functionResponse 回传
    contents.push({
      role: 'model',
      parts: calls.map((call) => ({ functionCall: call })),
    })
    const responses: GeminiPart[] = []
    for (const call of calls) {
      const text = await runTool(call.name, call.args)
      responses.push({ functionResponse: { name: call.name, response: { result: text } } })
    }
    contents.push({ role: 'user', parts: responses })
  }
}
