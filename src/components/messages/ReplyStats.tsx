import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import type { AssistantMessage } from '../../services/chat/types.js'
import { getReplyStats } from './replyStats.js'
import styles from './ReplyStats.module.css'

/** 生成中每 500ms 刷新一次，让每秒 token 数跟着变化 */
const useTicker = (active: boolean) => {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) {
      return
    }
    const timer = setInterval(() => setTick((value) => value + 1), 500)
    return () => clearInterval(timer)
  }, [active])
}

/**
 * 回复的 token 用量与生成速度。
 * 生成中显示实时速度，结束后定格为本次回复的平均速度与总 token 数。
 */
export const ReplyStats = ({
  message,
  streaming,
}: {
  message: AssistantMessage
  streaming: boolean
}) => {
  const t = useTranslate()
  const live = streaming && message.status === 'streaming'
  useTicker(live)
  const stats = getReplyStats(message, live, Date.now())
  if (!stats) {
    return null
  }
  const rate =
    stats.perSecond === null ? null : t('replyStatsRate', { rate: stats.perSecond.toFixed(1) })
  return (
    <span className={styles.stats} title={stats.estimated ? t('replyStatsEstimated') : undefined}>
      {t('replyStatsTotal', { tokens: stats.total.toLocaleString() })}
      {rate ? ` · ${rate}` : null}
      {stats.estimated ? '*' : null}
    </span>
  )
}
