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

export type ReplyStats = {
  /** 迄今输出的 token 数（生成中为估算，结束后优先用接口返回值） */
  total: number
  /** 每秒 token 数；耗时不足 0.5 秒或无计时信息时为 null */
  perSecond: number | null
  /** total 是否为估算值 */
  estimated: boolean
  /** 是否仍在生成中 */
  live: boolean
}

/**
 * 统计一条回复的 token 用量与生成速度。
 *
 * 速度的含义是「这段时间里平均每秒输出多少 token」：
 * - 生成中：已输出内容 ÷ 从首个内容块到「现在」的时长，每次刷新都会重算，
 *   所以数值会随生成快慢实时变化；
 * - 结束后：接口返回的 output_tokens ÷ 整段生成时长，定格为本次的平均速度。
 */
export const getReplyStats = (
  reply: AssistantMessage,
  streaming: boolean,
  now: number
): ReplyStats | null => {
  const text = reply.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
  const estimatedTokens = estimateTokens(text)
  const reported = reply.usage?.output_tokens
  const hasReported = reported !== undefined && reported > 0
  // 生成中接口还没返回用量，只能用估算值；结束后优先用精确值
  const total = !streaming && hasReported ? reported : estimatedTokens
  // 生成中即使还没有文字，只要开始计时就显示（速度为 0），让用户知道统计在跑
  if (total <= 0 && !(streaming && reply.generatedFrom !== undefined)) {
    return null
  }
  /*
   * 耗时来源按可靠性排序：
   * 1. 首个内容块到收尾的精确跨度（generatedFrom / generatedTo）
   * 2. 旧的或从存储重载的消息缺少这两项时，退回用消息创建时间兜底，
   *    保证任何一条回复都能给出速度，而不是干脆不显示
   */
  const startedAt = reply.generatedFrom ?? reply.createdAt
  const endedAt = streaming ? now : (reply.generatedTo ?? reply.generatedFrom ?? now)
  const seconds = endedAt > startedAt ? (endedAt - startedAt) / 1000 : 0
  const perSecond = seconds > 0 ? total / seconds : null
  return {
    total,
    perSecond,
    estimated: !(!streaming && hasReported),
    live: streaming && reply.status === 'streaming',
  }
}
