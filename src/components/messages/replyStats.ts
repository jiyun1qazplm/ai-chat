import type { AssistantMessage } from '../../services/chat/types.js'

/**
 * 估算一段文本的 token 数。
 * 没有本地分词器时按业界粗略口径估算：中日韩字符约 1 字 1 token，
 * 其他字符（拉丁字母、数字、空格、标点）约 4 字符 1 token。
 */
export const estimateTokens = (text: string): number => {
  if (!text) {
    return 0
  }
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]/.test(char)) {
      cjk++
    } else {
      other++
    }
  }
  return cjk + Math.ceil(other / 4)
}

/**
 * 统计一条回复的 token 用量与生成速度。
 * - total：接口返回的 output_tokens 最准确；没有时用文本估算
 * - perSecond：总 token ÷ 生成耗时；耗时取首个内容块到收尾的时间跨度
 * - live：仍在生成中，界面按估算值动态刷新
 */
export type ReplyStats = {
  total: number
  perSecond: number | null
  estimated: boolean
  live: boolean
}

export const getReplyStats = (
  reply: AssistantMessage,
  streaming: boolean,
  now: number
): ReplyStats | null => {
  const text = reply.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
  const reported = reply.usage?.output_tokens
  const total = reported && reported > 0 ? reported : estimateTokens(text)
  if (total <= 0) {
    return null
  }
  const startedAt = reply.generatedFrom
  const endedAt = streaming ? now : (reply.generatedTo ?? now)
  const seconds = startedAt !== undefined ? (endedAt - startedAt) / 1000 : 0
  return {
    total,
    perSecond: seconds >= 0.5 ? total / seconds : null,
    estimated: !(reported && reported > 0),
    live: streaming && reply.status === 'streaming',
  }
}
