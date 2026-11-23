import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  addMemory,
  clearMemories,
  removeMemory,
  setMemoryAutoExtract,
  setMemoryAutoEvery,
  MEMORY_AUTO_RANGE,
  applyConsolidated,
  memoryTexts,
  setMemoryEnabled,
  updateMemory,
  useMemory,
} from '../../services/memory.js'
import { consolidateMemories } from '../../services/memoryExtract.js'
import { extractMemoriesFromSession } from '../../services/chat/store.js'
import { useChatStore } from '../../services/chat/store.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './MemorySettings.module.css'

/** 超过这个长度（含换行）就认为是长记忆，默认折叠 */
const LONG_TEXT_LENGTH = 80
const isLong = (text: string) => text.length > LONG_TEXT_LENGTH || text.includes('\n')

/**
 * 记忆管理：用户写下希望模型长期记住的事实与偏好，随每轮请求注入系统提示词。
 * 全部保存在本机浏览器，不上传。
 */
export const MemorySettings = () => {
  const t = useTranslate()
  const items = useMemory((state) => state.items)
  const enabled = useMemory((state) => state.enabled)
  const autoExtract = useMemory((state) => state.autoExtract)
  const autoEvery = useMemory((state) => state.autoExtractEvery)
  const turns = useMemory((state) => state.turnsSinceExtract)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [consolidating, setConsolidating] = useState(false)
  /** 整理结果预览；用户确认后才替换，避免直接覆盖 */
  const [preview, setPreview] = useState<string[] | null>(null)
  /** 已展开的长记忆 id；默认折叠，只显示前几行 */
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const activeId = useChatStore((state) => state.activeId)

  const submit = () => {
    if (!draft.trim()) {
      return
    }
    if (addMemory(draft)) {
      setDraft('')
      showToast({ key: 'memoryAdded' })
    } else {
      showToast({ key: 'memoryDuplicate', type: 'error' })
    }
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.label}>{t('settingsMemory')}</div>
        <Select
          ariaLabel={t('settingsMemory')}
          value={enabled ? 'on' : 'off'}
          options={[
            { value: 'off' as const, label: t('memoryOff') },
            { value: 'on' as const, label: t('memoryOn') },
          ]}
          onChange={(value) => setMemoryEnabled(value === 'on')}
        />
      </div>
      <div className={styles.description}>{t('settingsMemoryDescription')}</div>

      {enabled ? (
        <>
          <textarea
            className={styles.input}
            rows={2}
            placeholder={t('memoryPlaceholder')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit()
              }
            }}
          />
          <Button size="s" block disabled={!draft.trim()} onClick={submit}>
            {t('memoryAdd')}
          </Button>

          {/* 手动触发一次提取，不开启自动也能用 */}
          <Button
            size="s"
            variant="outlined"
            block
            disabled={extracting || !activeId}
            onClick={async () => {
              if (!activeId) {
                return
              }
              setExtracting(true)
              const added = await extractMemoriesFromSession(activeId)
              setExtracting(false)
              showToast(
                added.length > 0
                  ? { key: 'memoryExtracted', params: { count: added.length } }
                  : { key: 'memoryNothingFound' }
              )
            }}
          >
            {t(extracting ? 'memoryExtracting' : 'memoryExtractNow')}
          </Button>

          <div className={styles.list}>
            {items.length === 0 ? (
              <div className={styles.empty}>{t('memoryEmpty')}</div>
            ) : (
              items.map((item) => (
                <div key={item.id} className={styles.item}>
                  {editingId === item.id ? (
                    <>
                      <textarea
                        className={styles.input}
                        rows={2}
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                      />
                      <div className={styles.itemActions}>
                        <Button size="s" variant="outlined" onClick={() => setEditingId(null)}>
                          {t('cancel')}
                        </Button>
                        <Button
                          size="s"
                          onClick={() => {
                            updateMemory(item.id, editText)
                            setEditingId(null)
                          }}
                        >
                          {t('confirm')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className={
                          expanded.has(item.id)
                            ? styles.itemText
                            : `${styles.itemText} ${styles.clamped}`
                        }
                      >
                        {item.text}
                      </div>
                      {/* 长记忆默认折叠，点开再看全文 */}
                      {isLong(item.text) || expanded.has(item.id) ? (
                        <button
                          type="button"
                          className={styles.link}
                          onClick={() =>
                            setExpanded((prev) => {
                              const next = new Set(prev)
                              if (next.has(item.id)) {
                                next.delete(item.id)
                              } else {
                                next.add(item.id)
                              }
                              return next
                            })
                          }
                        >
                          {t(expanded.has(item.id) ? 'memoryCollapse' : 'memoryExpand')}
                        </button>
                      ) : null}
                      <div className={styles.itemMeta}>
                        <span className={styles.badge}>
                          {item.source === 'auto' ? t('memorySourceAuto') : t('memorySourceManual')}
                        </span>
                        <div className={styles.itemActions}>
                          <button
                            type="button"
                            className={styles.link}
                            onClick={() => {
                              setEditingId(item.id)
                              setEditText(item.text)
                            }}
                          >
                            {t('memoryEdit')}
                          </button>
                          <button
                            type="button"
                            className={styles.danger}
                            onClick={() => removeMemory(item.id)}
                          >
                            {t('delete')}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          {items.length > 1 ? (
            <Button
              size="s"
              variant="outlined"
              block
              disabled={consolidating}
              onClick={async () => {
                setConsolidating(true)
                try {
                  const texts = await consolidateMemories(
                    memoryTexts(),
                    new AbortController().signal
                  )
                  if (texts.length > 0) {
                    // 先预览，用户点确认才替换
                    setPreview(texts)
                  } else {
                    showToast({ key: 'memoryNothingFound' })
                  }
                } catch {
                  showToast({ key: 'memoryFailed', type: 'error' })
                } finally {
                  setConsolidating(false)
                }
              }}
            >
              {t(consolidating ? 'memoryConsolidating' : 'memoryConsolidate')}
            </Button>
          ) : null}

          {preview ? (
            <div className={styles.preview}>
              <div className={styles.previewTitle}>
                {t('memoryPreviewTitle', { from: items.length, to: preview.length })}
              </div>
              <div className={styles.previewList}>
                {preview.map((text) => (
                  <div key={text} className={styles.previewItem}>
                    {text}
                  </div>
                ))}
              </div>
              <div className={styles.itemActions}>
                <Button size="s" variant="outlined" onClick={() => setPreview(null)}>
                  {t('cancel')}
                </Button>
                <Button
                  size="s"
                  onClick={() => {
                    applyConsolidated(preview)
                    showToast({
                      key: 'memoryConsolidated',
                      params: { from: items.length, to: preview.length },
                    })
                    setPreview(null)
                  }}
                >
                  {t('memoryApply')}
                </Button>
              </div>
            </div>
          ) : null}

          {items.length > 0 ? (
            <Button
              size="s"
              variant="dangerOutlined"
              block
              onClick={() => {
                clearMemories()
                showToast({ key: 'memoryCleared' })
              }}
            >
              {t('memoryClearAll')}
            </Button>
          ) : null}

          <div className={styles.row}>
            <span className={styles.rowLabel}>{t('memoryAutoExtract')}</span>
            <Select
              ariaLabel={t('memoryAutoExtract')}
              value={autoExtract ? 'on' : 'off'}
              options={[
                { value: 'off' as const, label: t('memoryOff') },
                { value: 'on' as const, label: t('memoryOn') },
              ]}
              onChange={(value) => setMemoryAutoExtract(value === 'on')}
            />
          </div>

          {/* 每 N 轮提取一次，N 由用户设定 */}
          {autoExtract ? (
            <>
              <div className={styles.row}>
                <span className={styles.rowLabel}>{t('memoryAutoEvery')}</span>
                <div className={styles.stepper}>
                  <Button
                    size="s"
                    variant="outlined"
                    disabled={autoEvery <= MEMORY_AUTO_RANGE.min}
                    onClick={() => setMemoryAutoEvery(autoEvery - 1)}
                  >
                    −
                  </Button>
                  <span className={styles.stepperValue}>{autoEvery}</span>
                  <Button
                    size="s"
                    variant="outlined"
                    disabled={autoEvery >= MEMORY_AUTO_RANGE.max}
                    onClick={() => setMemoryAutoEvery(autoEvery + 1)}
                  >
                    +
                  </Button>
                </div>
              </div>
              <div className={styles.description}>
                {t('memoryAutoEveryHint', { every: autoEvery, done: turns })}
              </div>
            </>
          ) : null}

          <div className={styles.description}>
            {autoExtract ? t('memoryAutoExtractOn') : t('memoryAutoExtractOff')}
          </div>
        </>
      ) : null}
    </div>
  )
}
