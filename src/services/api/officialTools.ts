/**
 * 官方 DeepSeek 接口的本地工具循环。
 *
 * 官方接口是 Anthropic 兼容协议：请求体带 tools，响应里出现 tool_use 块时，
 * 本地执行后以 assistant(tool_use) + user(tool_result) 追加进 messages 再请求。
 * 与服务端工具（deepseek_web_search 等）可以共存。
 */

import type { CreateMessageRequest, MessageParam, MessageStreamEvent } from './types.js'
import { streamMessage } from './client.js'
import { toClaudeTools } from '../tools/localTools.js'

/** 最多连续几轮工具调用 */
const MAX_TOOL_ROUNDS = 4

export async function* streamOfficialWithTools(
  apiKey: string,
  body: CreateMessageRequest,
  runTool: ((name: string, args: Record<string, unknown>) => Promise<string>) | undefined,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const messages: MessageParam[] = [...body.messages]
  const tools = runTool ? [...body.tools, ...toClaudeTools()] : body.tools

  for (let round = 0; ; round += 1) {
    const calls: { id: string; name: string; input: unknown }[] = []
    const payload: CreateMessageRequest = { ...body, messages, tools: tools as CreateMessageRequest['tools'] }
    for await (const event of streamMessage(apiKey, payload, signal)) {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        const block = event.content_block
        // 只接管本地工具；服务端工具由服务端自己执行
        if (isLocalTool(block.name)) {
          calls.push({ id: block.id, name: block.name, input: block.input })
          continue
        }
      }
      yield event
    }

    if (!runTool || calls.length === 0 || round >= MAX_TOOL_ROUNDS || signal.aborted) {
      return
    }

    messages.push({
      role: 'assistant',
      content: calls.map((call) => ({
        type: 'tool_use' as const,
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    })
    const results: unknown[] = []
    for (const call of calls) {
      const input =
        call.input && typeof call.input === 'object' ? (call.input as Record<string, unknown>) : {}
      const text = await runTool(call.name, input)
      results.push({ type: 'tool_result', tool_use_id: call.id, content: text })
    }
    messages.push({
      role: 'user',
      content: results as Extract<MessageParam, { role: 'user' }>['content'],
    })
  }
}

/** 本应用实现的本地工具名 */
const LOCAL_TOOL_NAMES = new Set([
  'get_current_time',
  'calculator',
  'ask_user',
  'get_location',
])

export const isLocalTool = (name: string): boolean => LOCAL_TOOL_NAMES.has(name)
