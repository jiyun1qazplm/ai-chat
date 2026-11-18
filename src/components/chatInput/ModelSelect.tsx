import { useCallback, useEffect, useState } from 'react'
import { useSettings, setOpenAIModel, setOpenAIModels } from '../../services/settings.js'
import { useChatStore, setSessionModel } from '../../services/chat/store.js'
import { fetchOpenAIModels } from '../../services/api/openai.js'
import { useTranslate } from '../../i18n/index.js'
import { Select } from '../base/Select.js'
import styles from './ModelSelect.module.css'

/**
 * 模型选择器：只在兼容模式下显示。
 * 已有对话改的是本对话的模型，新对话改的是全局默认模型。
 * 模型列表来自 GET /models，拉不到时退化成当前模型一项。
 */
export const ModelSelect = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  const models = useSettings((state) => state.openaiModels)
  const defaultModel = useSettings((state) => state.openaiModel)
  const baseUrl = useSettings((state) => state.openaiBaseUrl)
  const apiKey = useSettings((state) => state.openaiApiKey)
  const sessionModel = useChatStore((state) =>
    sessionId ? state.sessionCache[sessionId]?.model : undefined
  )
  const [loading, setLoading] = useState(false)

  const current = sessionModel || defaultModel

  const refresh = useCallback(async () => {
    if (!baseUrl.trim() || !apiKey?.trim()) {
      return
    }
    setLoading(true)
    const list = await fetchOpenAIModels(baseUrl, apiKey)
    if (list.length > 0) {
      setOpenAIModels(list)
    }
    setLoading(false)
  }, [baseUrl, apiKey])

  // 还没拉过列表时自动拉一次
  useEffect(() => {
    if (provider === 'openai' && models.length === 0) {
      void refresh()
    }
  }, [provider, models.length, refresh])

  if (provider !== 'openai') {
    return null
  }

  const options =
    models.length > 0
      ? models.map((id) => ({ value: id, label: id }))
      : [{ value: current, label: current }]

  return (
    <div className={styles.wrapper} title={loading ? t('modelListLoading') : undefined}>
      <Select
        ariaLabel={t('modelSelect')}
        value={current}
        options={options}
        placeholder={t('modelSelect')}
        onChange={(model) => {
          if (sessionId) {
            setSessionModel(sessionId, model)
          } else {
            setOpenAIModel(model)
          }
        }}
      />
    </div>
  )
}
