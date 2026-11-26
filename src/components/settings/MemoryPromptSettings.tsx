import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setMemoryPrompt, useSettings } from '../../services/settings.js'
import { CONSOLIDATE_SYSTEM, EXTRACT_SYSTEM, UPDATE_SYSTEM } from '../../services/memoryExtract.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './MemorySettings.module.css'

type PromptKey = 'update' | 'consolidate' | 'extract'

const DEFAULTS: Record<PromptKey, string> = {
  update: UPDATE_SYSTEM,
  consolidate: CONSOLIDATE_SYSTEM,
  extract: EXTRACT_SYSTEM,
}

/**
 * 记忆提示词编辑：三种提示词分别对应「更新记忆」「整理记忆」「提取记忆」。
 * 留空表示使用默认提示词；恢复默认按钮会把输入框清空。
 */
export const MemoryPromptSettings = () => {
  const t = useTranslate()
  const prompts = useSettings((state) => state.memoryPrompts)
  const [which, setWhich] = useState<PromptKey>('update')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const saved = prompts[which]
  const effective = saved.trim() || DEFAULTS[which]

  const startEdit = () => {
    setDraft(saved.trim() || DEFAULTS[which])
    setEditing(true)
  }

  const save = () => {
    const value = draft.trim()
    // 与默认完全一致时视为恢复默认，避免多存一份副本
    const same = value === DEFAULTS[which].trim()
    setMemoryPrompt(which, same ? '' : value)
    setEditing(false)
    showToast({ key: same ? 'memoryPromptResetDone' : 'memoryPromptSaved' })
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.label}>{t('memoryPrompt')}</div>
        <Select
          ariaLabel={t('memoryPrompt')}
          value={which}
          options={[
            { value: 'update' as const, label: t('memoryPromptUpdate') },
            { value: 'consolidate' as const, label: t('memoryPromptConsolidate') },
            { value: 'extract' as const, label: t('memoryPromptExtract') },
          ]}
          onChange={(value) => {
            setWhich(value)
            setEditing(false)
          }}
        />
      </div>
      <div className={styles.description}>
        {saved.trim() ? t('memoryPromptCustom') : t('memoryPromptDefault')}
      </div>

      {editing ? (
        <>
          <textarea
            className={styles.promptInput}
            rows={12}
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className={styles.itemActions}>
            <Button size="s" variant="outlined" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button size="s" variant="outlined" onClick={() => setDraft(DEFAULTS[which])}>
              {t('memoryPromptRestoreDefault')}
            </Button>
            <Button size="s" onClick={save}>
              {t('confirm')}
            </Button>
          </div>
        </>
      ) : (
        <>
          <pre className={styles.promptPreview}>{effective}</pre>
          <div className={styles.itemActions}>
            <Button size="s" variant="outlined" onClick={startEdit}>
              {t('memoryPromptEdit')}
            </Button>
            {saved.trim() ? (
              <button
                type="button"
                className={styles.link}
                onClick={() => {
                  setMemoryPrompt(which, '')
                  showToast({ key: 'memoryPromptResetDone' })
                }}
              >
                {t('memoryPromptReset')}
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
