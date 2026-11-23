/**
 * 从对话里提取值得长期记住的事实。
 *
 * 用当前服务商发一次请求，让模型输出若干条短句，再解析成记忆条目。
 * 只在用户开启「自动提取」或主动点击时调用，避免默默消耗额度。
 */

import { DEFAULT_CLAUDE_BASE_URL, streamClaudeMessage } from './api/claude.js'
import { DEFAULT_GEMINI_BASE_URL, streamGeminiMessage } from './api/gemini.js'
import { streamOpenAIMessage } from './api/openai.js'
import { streamMessage } from './api/client.js'
import { buildReasoningParam } from './api/reasoning.js'
import type { MessageStreamEvent } from './api/types.js'
import { useSettings } from './settings.js'

/** 提取用的指令：要求简短、去重、只保留长期有效的信息 */
const EXTRACT_SYSTEM = `你是一个信息提取助手。阅读用户提供的对话，找出值得长期记住的关于用户的事实与偏好。

只提取这类内容：
- 用户的身份、职业、所在地、语言偏好
- 稳定的偏好与禁忌（饮食、风格、称呼、回答长度）
- 正在长期进行的项目或目标

不要提取：
- 一次性的问题细节、临时需求
- 对话里出现的第三方隐私
- 模型自己说过的话

输出格式：每行一条，以「- 」开头，每条不超过 25 个字，最多 5 条。
没有值得记住的内容就只输出「- 无」。不要输出其他任何文字。`

/** 从消息里拼出干净的对话文本，供模型阅读 */
const toTranscript = (messages: { role: string; content: string }[]): string =>
  messages
    .filter((message) => message.content.trim())
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content.trim()}`)
    .join('\n')

/** 调用当前服务商，收集完整的文本回答 */
const collectText = async (
  system: string,
  userText: string,
  signal: AbortSignal
): Promise<string> => {
  const settings = useSettings.getState()
  const messages = [{ role: 'user' as const, content: userText }]
  let stream: AsyncGenerator<MessageStreamEvent>

  switch (settings.provider) {
    case 'openai':
      stream = streamOpenAIMessage({
        baseUrl: settings.openaiBaseUrl,
        apiKey: settings.openaiApiKey ?? '',
        model: settings.openaiModel,
        system,
        messages,
        images: new Map(),
        reasoningParam: buildReasoningParam(
          settings.openaiModel,
          false,
          settings.reasoningMode,
          settings.reasoningOnMode
        ),
        signal,
      })
      break
    case 'gemini':
      stream = streamGeminiMessage({
        baseUrl: settings.geminiBaseUrl || DEFAULT_GEMINI_BASE_URL,
        apiKey: settings.geminiApiKey ?? '',
        model: settings.geminiModel,
        system,
        messages,
        images: new Map(),
        thinking: { thinkingBudget: 0 },
        signal,
      })
      break
    case 'claude':
      stream = streamClaudeMessage({
        baseUrl: settings.claudeBaseUrl || DEFAULT_CLAUDE_BASE_URL,
        apiKey: settings.claudeApiKey ?? '',
        model: settings.claudeModel,
        system,
        messages,
        images: new Map(),
        maxTokens: 512,
        signal,
      })
      break
    default:
      stream = streamMessage(
        settings.apiKey ?? '',
        {
          model: 'deepseek-flash',
          system,
          messages,
          thinking: { type: 'disabled' },
          safety_check: { level: 'high' },
          tools: [],
        },
        signal
      )
  }

  let text = ''
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  return text
}

/** 解析模型输出：只保留「- 」开头的行，过滤「无」与空行 */
export const parseExtracted = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line && line !== '无' && !line.startsWith('无'))
    .slice(0, 5)

/**
 * 从给定对话里提取记忆候选。
 * 失败时抛错，由调用方决定提示方式。
 */
export const extractMemories = async (
  transcript: { role: string; content: string }[],
  signal: AbortSignal
): Promise<string[]> => {
  const text = toTranscript(transcript)
  if (!text.trim()) {
    return []
  }
  const output = await collectText(EXTRACT_SYSTEM, text, signal)
  return parseExtracted(output)
}
