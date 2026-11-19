/**
 * Anthropic Claude 原生格式客户端（/v1/messages）。
 *
 * 应用内部的 MessageStreamEvent 本来就参考了这套协议，所以这里的转换最直接：
 * 主要是请求体、鉴权头（x-api-key + anthropic-version）和思考参数。
 *
 * 文档：https://docs.anthropic.com/en/api/messages
 */

import { ApiError, readErrorResponse } from './client.js'
import { readServerSentEvents } from './sse.js'
import type { MessageParam, MessageStreamEvent, TextBlockParam } from './types.js'

/** Claude 默认接口地址 */
export const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com/v1'
/** 必带的接口版本头 */
const ANTHROPIC_VERSION = '2023-06-01'

export const normalizeClaudeBaseUrl = (input: string): string => {
  let url = input.trim().replace(/\/+$/, '')
  if (!url) {
    return ''
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  url = url.replace(/\/messages$/i, '')
  url = url.replace(/\/+$/, '')
  return url
}

// ---------- 请求 ----------

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

type ClaudeMessage = { role: 'user' | 'assistant'; content: string | ClaudeContentBlock[] }

export type ImageDataUrls = ReadonlyMap<string, string>

const toBase64Image = (url: string) => {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(url)
  return match ? { media_type: match[1], data: match[2] } : null
}

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
 * 转 Claude 消息：跳过扩展角色，助理只发正文，
 * 图片按 base64 内联，其余附件跳过。
 */
export const toClaudeMessages = (
  messages: MessageParam[],
  images: ImageDataUrls
): ClaudeMessage[] => {
  const result: ClaudeMessage[] = []
  for (const message of messages) {
    if (message.role === 'latest_reminder') {
      continue
    }
    if (message.role === 'assistant') {
      const text = textOf(message.content)
      if (text) {
        result.push({ role: 'assistant', content: text })
      }
      continue
    }
    if (typeof message.content === 'string') {
      result.push({ role: 'user', content: message.content })
      continue
    }
    const blocks: ClaudeContentBlock[] = []
    for (const block of message.content) {
      if (block.type === 'text') {
        if (block.text) {
          blocks.push({ type: 'text', text: block.text })
        }
        continue
      }
      if (block.type !== 'image' || block.source.type !== 'file') {
        continue
      }
      const url = images.get(block.source.file_id)
      const image = url ? toBase64Image(url) : null
      if (image) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: image.media_type, data: image.data },
        })
      }
    }
    if (blocks.length > 0) {
      result.push({ role: 'user', content: blocks })
    }
  }
  return result
}

const claudeHeaders = (apiKey: string) => ({
  'x-api-key': apiKey,
  'anthropic-version': ANTHROPIC_VERSION,
  'anthropic-dangerous-direct-browser-access': 'true',
  'Content-Type': 'application/json',
  Accept: 'text/event-stream',
})

/** GET /models 校验 Key */
export const verifyClaudeEndpoint = async (
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<void> => {
  const response = await fetch(`${normalizeClaudeBaseUrl(baseUrl)}/models`, {
    method: 'GET',
    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    signal,
  })
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
}

/** GET /models 拉取模型名 */
export const fetchClaudeModels = async (
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> => {
  try {
    const response = await fetch(`${normalizeClaudeBaseUrl(baseUrl)}/models`, {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
      signal,
    })
    if (!response.ok) {
      return []
    }
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
 * POST {base}/messages（stream: true）。
 * Claude 的事件本来就接近内部格式，主要做类型收敛与错误处理。
 */
export async function* streamClaudeMessage({
  baseUrl,
  apiKey,
  model,
  system,
  messages,
  images,
  maxTokens,
  thinkingBudget,
  signal,
}: {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  messages: MessageParam[]
  images: ImageDataUrls
  /** Claude 必填 max_tokens */
  maxTokens: number
  /** 开启思考时的预算 token 数；0 或未给则关闭 */
  thinkingBudget?: number
  signal: AbortSignal
}): AsyncGenerator<MessageStreamEvent> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    stream: true,
    messages: toClaudeMessages(messages, images),
    ...(system ? { system } : {}),
    ...(thinkingBudget && thinkingBudget > 0
      ? { thinking: { type: 'enabled', budget_tokens: thinkingBudget } }
      : {}),
  }

  let response: Response
  try {
    response = await fetch(`${normalizeClaudeBaseUrl(baseUrl)}/messages`, {
      method: 'POST',
      headers: claudeHeaders(apiKey),
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
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    const typed = payload as { type?: string; error?: { message?: string } }
    if (typed?.error?.message) {
      throw new ApiError('stream', typed.error.message)
    }
    // 事件名与 payload.type 一致，直接按内部协议透传
    const type = typed?.type ?? eventName
    switch (type) {
      case 'message_start':
      case 'content_block_start':
      case 'content_block_delta':
      case 'content_block_stop':
      case 'message_delta':
        yield payload as MessageStreamEvent
        break
      case 'message_stop':
        yield { type: 'message_stop' }
        return
      default:
        break
    }
  }
  throw new ApiError('interrupted', '')
}
