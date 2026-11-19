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
 * 模型列表来自 GET /models，可手动刷新；列表较长时支持搜索。
 */
export const ModelSelect = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  const models = useSettings((state) => state.openaiModels)
  const defaultModel = useSettings((state) => state.openaiModel)
  const baseUrl = useSettings((state) => state.openaiBaseUrl)
  const apiKey = useSettings((state) => state.openaiApiKey)
  const sessionModel = useChatStore((state) =>
    sessionId ? (state.sessionCache[sessionId]?.model ?? null) : null
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const current = sessionModel || defaultModel

  const refresh = useCallback(async () => {
    if (!baseUrl.trim() || !apiKey?.trim()) {
      return
    }
    setLoading(true)
    setError(false)
    const list = await fetchOpenAIModels(baseUrl, apiKey)
    if (list.length > 0) {
      setOpenAIModels(list)
    } else {
      // 拉取失败时保留旧列表，只在按钮上给出提示
      setError(true)
    }
    setLoading(false)
  }, [baseUrl, apiKey])

  /**
   * 进入页面就刷新一次。依赖只放 provider 与是否已配置，
   * 避免 baseUrl/apiKey 变化时重复触发；未配置时跳过，配置完成后自动补拉。
   */
  const configured = Boolean(baseUrl.trim() && apiKey?.trim())
  useEffect(() => {
    if (provider !== 'openai' || !configured) {
      return
    }
    // 直接读最新设置，不受闭包里的旧值影响
    const { openaiBaseUrl, openaiApiKey } = useSettings.getState()
    if (!openaiBaseUrl.trim() || !openaiApiKey?.trim()) {
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    void fetchOpenAIModels(openaiBaseUrl, openaiApiKey).then((list) => {
      if (cancelled) {
        return
      }
      if (list.length > 0) {
        setOpenAIModels(list)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [provider, configured])

  /** 切回页面时再拉一次，覆盖手机后台切回的场景 */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  if (provider !== 'openai') {
    return null
  }

  const options =
    models.length > 0
      ? models.map((id) => ({ value: id, label: id }))
      : [{ value: current, label: current }]

  return (
    <div className={styles.wrapper}>
      <Select
        ariaLabel={t('modelSelect')}
        value={current}
        options={options}
        placeholder={t('modelSelect')}
        searchable
        searchPlaceholder={t('modelSearchPlaceholder')}
        onChange={(model) => {
          if (sessionId) {
            setSessionModel(sessionId, model)
          } else {
            setOpenAIModel(model)
          }
        }}
      />
      <button
        type="button"
        className={styles.refresh}
        aria-label={t('modelRefresh')}
        title={error ? t('modelRefreshFailed') : t('modelRefresh')}
        disabled={loading}
        onClick={() => void refresh()}
      >
        <span className={loading ? styles.spinning : undefined}>⟳</span>
      </button>
    </div>
  )
}
