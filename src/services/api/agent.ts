/**
 * 兼容接口的「工具调用」支持：由模型自己决定要不要联网搜索。
 *
 * 流程：带 tools 请求 → 模型返回 tool_calls → 本地调 Tavily 搜索 →
 * 结果作为 tool 消息回传 → 再请求一次，直到模型给出正文。
 * 正文与思考内容都按增量实时产出，不做整轮聚合。
 */

import { ApiError, readErrorResponse, request } from './client.js'
import { readServerSentEvents } from './sse.js'
import {
  normalizeBaseUrl,
  toOpenAIMessages,
  type OpenAIMessage,
  type OpenAIChunk,
  type ReasoningParam,
} from './openai.js'
import type { ImageDataUrls } from './openai.js'
import type { MessageParam, MessageStreamEvent, WebSearchResult } from './types.js'
import { getEnabledToolDefs, runLocalTool, type LocalToolHandlers } from '../tools/localTools.js'

/** 最多允许模型连续发起几轮工具调用，避免死循环 */
const MAX_TOOL_ROUNDS = 3

type ToolCall = { id: string; name: string; arguments: string }

type CompletionResult = {
  content: string
  reasoning: string
  toolCalls: ToolCall[]
  finishReason: string | null
}

export type AgentEvent =
  | { type: 'search-start'; query: string }
  /** failed 为 true 时表示搜索出错，results 一定为空 */
  | { type: 'search-done'; query: string; results: unknown[]; failed?: boolean }
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }

/** 搜索执行器：由调用方注入，避免本文件依赖具体搜索服务 */
export type SearchRunner = (
  query: string,
  signal: AbortSignal
) => Promise<{ results: unknown[]; text: string }>

const SEARCH_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: '搜索互联网获取最新信息。当问题涉及实时新闻、当前数据或你不确定的事实时调用。',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: '搜索关键词，尽量简洁' } },
        required: ['query'],
      },
    },
  },
]

/** 一次 POST 请求：边收分片边产出增量，结束时返回聚合结果 */
async function* streamOnce({
  baseUrl,
  apiKey,
  model,
  messages,
  tools,
  reasoningParam = {},
  signal,
}: {
  baseUrl: string
  apiKey: string
  model: string
  messages: OpenAIMessage[]
  tools: unknown[] | undefined
  reasoningParam?: ReasoningParam
  signal: AbortSignal
}): AsyncGenerator<AgentEvent, CompletionResult> {
  const response = await request(`${normalizeBaseUrl(baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...(tools ? { tools } : {}),
      ...reasoningParam,
    }),
    signal,
  })

  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  let content = ''
  let reasoning = ''
  let finishReason: string | null = null
  const calls = new Map<number, ToolCall>()

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      break
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
    const choice = chunk.choices?.[0]
    if (!choice) {
      continue
    }
    const delta = choice.delta as
      | (typeof choice.delta & {
          tool_calls?: {
            index?: number
            id?: string
            function?: { name?: string; arguments?: string }
          }[]
        })
      | undefined
    const thinking = delta?.reasoning_content ?? delta?.reasoning
    if (typeof thinking === 'string' && thinking) {
      reasoning += thinking
      yield { type: 'thinking', text: thinking }
    }
    if (typeof delta?.content === 'string' && delta.content) {
      content += delta.content
      yield { type: 'text', text: delta.content }
    }
    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? 0
      const current = calls.get(index) ?? { id: '', name: '', arguments: '' }
      calls.set(index, {
        id: call.id || current.id,
        name: call.function?.name || current.name,
        arguments: current.arguments + (call.function?.arguments ?? ''),
      })
    }
    if (choice.finish_reason) {
      finishReason = choice.finish_reason
    }
  }

  return { content, reasoning, toolCalls: [...calls.values()], finishReason }
}

/** 消费流式结果：把增量转发出去，同时拿到聚合结果 */
const drain = async function* (
  iterator: AsyncGenerator<AgentEvent, CompletionResult>
): AsyncGenerator<AgentEvent, CompletionResult> {
  for (;;) {
    const step = await iterator.next()
    if (step.done) {
      return step.value
    }
    yield step.value
  }
}

/**
 * 带联网搜索的对话：模型自主决定是否调用搜索工具，可连续多轮。
 * 不传 search 时等同普通对话。
 */
export async function* runOpenAIAgent({
  baseUrl,
  apiKey,
  model,
  system,
  messages,
  images,
  search,
  localTools,
  reasoningParam,
  signal,
}: {
  baseUrl: string
  apiKey: string
  model: string
  system: string
  messages: MessageParam[]
  images: ImageDataUrls
  search?: SearchRunner
  /** 传入后启用本地工具（时间、计算器、询问用户、位置） */
  localTools?: LocalToolHandlers
  reasoningParam?: ReasoningParam
  signal: AbortSignal
}): AsyncGenerator<AgentEvent> {
  const history: OpenAIMessage[] = toOpenAIMessages(system, messages, images)

  if (!search && !localTools) {
    yield* streamOnce({
      baseUrl,
      apiKey,
      model,
      messages: history,
      tools: undefined,
      reasoningParam,
      signal,
    })
    return
  }

  // 搜索工具与本地工具同时声明，由模型自行决定调用哪个
  const tools = [...(search ? SEARCH_TOOLS : []), ...(localTools ? getEnabledToolDefs() : [])]

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const result = yield* drain(
      streamOnce({
        baseUrl,
        apiKey,
        model,
        messages: history,
        tools,
        reasoningParam,
        signal,
      })
    )
    if (result.toolCalls.length === 0) {
      return
    }

    // 把模型发起的调用原样写回历史，再逐条追加执行结果
    history.push({
      role: 'assistant',
      content: result.content,
      tool_calls: result.toolCalls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: call.arguments },
      })),
    })

    for (const call of result.toolCalls) {
      // 本地工具：时间、计算器、询问用户、位置
      if (localTools && call.name !== 'web_search') {
        let args: Record<string, unknown> = {}
        try {
          const parsed = JSON.parse(call.arguments || '{}') as unknown
          if (parsed && typeof parsed === 'object') {
            args = parsed as Record<string, unknown>
          }
        } catch {
          args = {}
        }
        const text = await runLocalTool(call.name, args, localTools, signal)
        history.push({ role: 'tool', tool_call_id: call.id, content: text })
        continue
      }
      if (call.name !== 'web_search') {
        history.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `不支持的工具：${call.name}`,
        })
        continue
      }
      let query = ''
      try {
        query = String((JSON.parse(call.arguments) as { query?: string }).query ?? '')
      } catch {
        query = call.arguments
      }
      query = query.trim()
      if (!query) {
        history.push({ role: 'tool', tool_call_id: call.id, content: '搜索关键词为空。' })
        continue
      }
      if (!search) {
        history.push({ role: 'tool', tool_call_id: call.id, content: '未启用联网搜索。' })
        continue
      }
      yield { type: 'search-start', query }
      let text: string
      let results: unknown[] = []
      let failed = false
      try {
        const outcome = await search(query, signal)
        text = outcome.text
        results = outcome.results
      } catch (error) {
        // 搜索失败不中断对话，把原因交给模型自行说明
        failed = true
        text = `搜索「${query}」失败：${error instanceof Error ? error.message : String(error)}`
      }
      yield { type: 'search-done', query, results, failed }
      history.push({ role: 'tool', tool_call_id: call.id, content: text })
    }
  }

  // 工具轮次用尽，让模型基于已有结果直接作答
  history.push({ role: 'user', content: '已达到搜索次数上限，请基于已获得的信息直接回答。' })
  yield* streamOnce({
    baseUrl,
    apiKey,
    model,
    messages: history,
    tools: undefined,
    reasoningParam,
    signal,
  })
}

/**
 * 把 AgentEvent 翻译成应用内部的 MessageStreamEvent：
 * 正文与思考各自成块，搜索结果作为服务端工具结果块插入，渲染层无需区分来源。
 */
export async function* toMessageStreamEvents(
  events: AsyncGenerator<AgentEvent>
): AsyncGenerator<MessageStreamEvent> {
  let index = 0
  let openKind: 'text' | 'thinking' | null = null
  let searchIndex = 0

  const closeOpen = function* (): Generator<MessageStreamEvent> {
    if (openKind !== null) {
      yield { type: 'content_block_stop', index }
      index += 1
      openKind = null
    }
  }

  yield { type: 'message_start', message: { id: '', model: '' } }

  for await (const event of events) {
    if (event.type === 'text' || event.type === 'thinking') {
      const kind = event.type === 'text' ? 'text' : 'thinking'
      if (openKind !== kind) {
        yield* closeOpen()
        openKind = kind
        yield {
          type: 'content_block_start',
          index,
          content_block:
            kind === 'text'
              ? { type: 'text', text: '' }
              : { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index,
        delta:
          kind === 'text'
            ? { type: 'text_delta', text: event.text }
            : { type: 'thinking_delta', thinking: event.text },
      }
      continue
    }

    if (event.type === 'search-start') {
      yield* closeOpen()
      searchIndex += 1
      const startIndex = index
      yield {
        type: 'content_block_start',
        index: startIndex,
        content_block: {
          type: 'server_tool_use',
          id: `tavily_search_${searchIndex}`,
          name: 'deepseek_web_search',
          input: { action: 'search', queries: [event.query] },
          caller: { type: 'direct' },
          kind: 'search',
        },
      }
      yield { type: 'content_block_stop', index: startIndex }
      index += 1
      continue
    }

    const results = event.results as WebSearchResult[]
    const resultIndex = index
    // 搜索失败或没有结果都按错误块展示，避免界面显示成「搜索完成」
    const content =
      event.failed === true || results.length === 0
        ? [{ type: 'web_search_tool_result_error' as const, error_code: 'unavailable' as const }]
        : results
    yield {
      type: 'content_block_start',
      index: resultIndex,
      content_block: {
        type: 'web_search_tool_result',
        tool_use_id: `tavily_search_${searchIndex}`,
        content,
        kind: 'search',
      },
    }
    yield { type: 'content_block_stop', index: resultIndex }
    index += 1
  }

  yield* closeOpen()
  yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } }
  yield { type: 'message_stop' }
}
