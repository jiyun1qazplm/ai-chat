import { useState } from 'react'
import { useSettings } from '../../services/settings.js'
import { useTranslate } from '../../i18n/index.js'
import styles from './SystemPromptField.module.css'

/**
 * 新对话的系统提示词：默认收起成一行，点击展开多行输入。
 * 只在兼容模式下显示——官方接口使用固定的助手身份说明。
 * 提示词在发出第一条消息时写进会话，之后随会话固定。
 */
export const SystemPromptField = ({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  const [expanded, setExpanded] = useState(false)
  if (provider !== 'openai') {
    return null
  }
  const filled = value.trim().length > 0
  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={styles.title}>{t('systemPromptTitle')}</span>
        {!expanded && filled ? (
          <span className={styles.summary}>{value.trim().replace(/\s+/g, ' ')}</span>
        ) : null}
        <span className={styles.chevron} aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded ? (
        <>
          <textarea
            className={styles.textarea}
            rows={3}
            placeholder={t('systemPromptPlaceholder')}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <div className={styles.footer}>
            <span className={styles.hint}>{t('systemPromptHint')}</span>
            {filled ? (
              <button type="button" className={styles.clear} onClick={() => onChange('')}>
                {t('systemPromptClear')}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
