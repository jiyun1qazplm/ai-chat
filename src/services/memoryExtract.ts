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
const EXTRACT_SYSTEM = `你是一个信息提取助手。阅读用户提供的对话，找出值得长期记住的内容。

分成两类提取：

【回答偏好】用户希望回答怎么给：
- 长度（如"回答简短"）、语气（如"直接一点"）
- 格式（如"多用列表"）、语言（如"用中文回答"）
- 称呼方式、忌讳的话题

【用户事实】关于用户本身：
- 身份、职业、所在地
- 稳定习惯与禁忌（饮食、作息）
- 正在长期进行的项目或目标

不要提取：
- 一次性的问题细节、临时需求
- 对话里出现的第三方隐私
- 模型自己说过的话

输出格式：每行一条，行首标记类别：
[p] 回答偏好的内容
[f] 用户事实的内容
每条不超过 25 个字，最多 6 条。
没有值得记住的内容就只输出「无」。不要输出其他任何文字。`

/** 从消息里拼出干净的对话文本，供模型阅读 */
const toTranscript = (messages: { role: string; content: string }[]): string =>
  messages
    .filter((message) => message.content.trim())
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content.trim()}`)
    .join('\n')

/**
 * 调用当前服务商，收集完整的文本回答。
 * modelOverride 用于「记忆处理模型」：留空则跟随当前服务商的模型。
 */
const collectText = async (
  system: string,
  userText: string,
  signal: AbortSignal,
  modelOverride?: string
): Promise<string> => {
  const settings = useSettings.getState()
  const model = modelOverride?.trim()
  const messages = [{ role: 'user' as const, content: userText }]
  let stream: AsyncGenerator<MessageStreamEvent>

  switch (settings.provider) {
    case 'openai':
      stream = streamOpenAIMessage({
        baseUrl: settings.openaiBaseUrl,
        apiKey: settings.openaiApiKey ?? '',
        model: model || settings.openaiModel,
        system,
        messages,
        images: new Map(),
        reasoningParam: buildReasoningParam(
          model || settings.openaiModel,
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
        model: model || settings.geminiModel,
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
        model: model || settings.claudeModel,
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
          model: (model || 'deepseek-flash') as 'deepseek-flash' | 'deepseek-v4-pro',
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

/** 提取结果：文本与类别 */
export type ExtractedMemory = { text: string; kind: 'fact' | 'preference' }

/**
 * 解析模型输出：识别 [p]/[f] 前缀，兼容模型仍用列表符号的情况。
 * 没有前缀的行按事实处理，过滤「无」与空行。
 */
export const parseExtracted = (text: string): ExtractedMemory[] =>
  text
    .split('\n')
    .map((line) => line.replace(/^[-*•]\s*/, '').trim())
    .filter((line) => line && line !== '无' && !line.startsWith('无'))
    .map((line) => {
      const tagged = /^\[(p|f)\]\s*(.+)$/i.exec(line)
      if (tagged) {
        return {
          kind: tagged[1].toLowerCase() === 'p' ? 'preference' : 'fact',
          text: tagged[2].trim(),
        } as ExtractedMemory
      }
      return { kind: 'fact', text: line } as ExtractedMemory
    })
    .filter((item) => item.text)
    .slice(0, 6)

/**
 * 从给定对话里提取记忆候选。
 * 失败时抛错，由调用方决定提示方式。
 */
export const extractMemories = async (
  transcript: { role: string; content: string }[],
  signal: AbortSignal
): Promise<ExtractedMemory[]> => {
  const text = toTranscript(transcript)
  if (!text.trim()) {
    return []
  }
  const output = await collectText(EXTRACT_SYSTEM, text, signal)
  return parseExtracted(output)
}

/** 整理记忆用的指令：要求合并重复、更新过时、丢弃矛盾 */
const CONSOLIDATE_SYSTEM = `你是一个记忆整理助手。用户给出了他的长期记忆列表，请整理成更精炼的版本。

整理规则：
1. 合并重复或高度相似的条目
2. 更新过时信息：明显已经过去的临时状态（如"正在出差""这周在准备考试"）标记为历史，或改写为已完成的表述
3. 删除相互矛盾中较旧的那条
4. 保留所有稳定的事实与偏好（身份、职业、所在地、习惯、禁忌、长期目标）
5. 每条保持独立、简短，不超过 30 个字

输出格式：每行一条，保留原条目的类别标记（[p] 回答偏好 / [f] 用户事实），最多 20 条。
不要添加原列表里没有的新信息，不要解释，不要输出其他文字。`

/**
 * 整理记忆：交给模型去重、合并与更新，返回整理后的条目文本。
 * 只返回新列表，由调用方决定如何应用（保留手动条目的元信息等）。
 */
export const consolidateMemories = async (
  texts: string[],
  signal: AbortSignal
): Promise<ExtractedMemory[]> => {
  if (texts.length === 0) {
    return []
  }
  const input = texts.join('\n')
  const output = await collectText(CONSOLIDATE_SYSTEM, input, signal)
  return parseExtracted(output)
}

/** 更新记忆用的指令：模型拿到「当前列表 + 新对话」，输出完整的新列表 */
const UPDATE_SYSTEM = `你是一个记忆管理助手。你会收到用户当前的长期记忆列表，以及最近的一段对话。

你的任务：决定如何更新这份记忆列表。

你可以：
- 新增：对话里出现了值得长期记住的新信息
- 修改：已有条目过时或不准确（例如把「这周在准备考试」改为「2026 年 11 月参加过考试」）
- 删除：条目已被推翻、重复或不再成立
- 不动：新对话没有带来有价值的信息

规则：
1. 只保留稳定、长期有效的信息；一次性的问题细节不要记
2. 不要记录对话中出现的第三方隐私，也不要记录助手自己说过的话
3. 合并重复条目，保持每条独立、简短（不超过 30 字）
4. 总数不超过 20 条；超出时优先保留最重要的
5. 宁缺毋滥：没有值得记的内容时，原样返回当前列表

输出格式：输出更新后的完整列表，每行一条，行首标记类别：
[p] 回答偏好（长度、语气、格式、语言、称呼、忌讳）
[f] 用户事实（身份、职业、所在地、习惯、长期目标）
不要输出解释、序号或其他文字。`

/**
 * 让模型管理记忆：传入当前列表与最近的对话，返回更新后的完整列表。
 * 模型可以按需增删改，也可以原样返回表示不改动。
 */
export const updateMemories = async (
  current: { text: string; kind: 'fact' | 'preference' }[],
  transcript: { role: string; content: string }[],
  signal: AbortSignal,
  modelOverride?: string
): Promise<ExtractedMemory[]> => {
  const listText =
    current.length > 0
      ? current.map((item) => `[${item.kind === 'preference' ? 'p' : 'f'}] ${item.text}`).join('\n')
      : '（当前没有记忆）'
  const conversation = toTranscript(transcript)
  const input = `当前记忆列表：\n${listText}\n\n最近对话：\n${conversation}`
  const output = await collectText(UPDATE_SYSTEM, input, signal, modelOverride)
  return parseExtracted(output)
}
