import { useCallback, useEffect, useState } from 'react'
import {
  useSettings,
  setOpenAIModel,
  setOpenAIModels,
  setGeminiModels,
  setClaudeModels,
  setGeminiSettings,
  setClaudeSettings,
} from '../../services/settings.js'
import { useChatStore, setSessionModel } from '../../services/chat/store.js'
import { fetchOpenAIModels } from '../../services/api/openai.js'
import { DEFAULT_GEMINI_BASE_URL, fetchGeminiModels } from '../../services/api/gemini.js'
import { DEFAULT_CLAUDE_BASE_URL, fetchClaudeModels } from '../../services/api/claude.js'
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
  const openaiModels = useSettings((state) => state.openaiModels)
  const geminiModels = useSettings((state) => state.geminiModels)
  const claudeModels = useSettings((state) => state.claudeModels)
  const openaiModel = useSettings((state) => state.openaiModel)
  const geminiModel = useSettings((state) => state.geminiModel)
  const claudeModel = useSettings((state) => state.claudeModel)
  const openaiBaseUrl = useSettings((state) => state.openaiBaseUrl)
  const openaiApiKey = useSettings((state) => state.openaiApiKey)
  const geminiBaseUrl = useSettings((state) => state.geminiBaseUrl)
  const geminiApiKey = useSettings((state) => state.geminiApiKey)
  const claudeBaseUrl = useSettings((state) => state.claudeBaseUrl)
  const claudeApiKey = useSettings((state) => state.claudeApiKey)

  // 按当前平台取对应的列表、默认模型与凭据
  const models =
    provider === 'gemini' ? geminiModels : provider === 'claude' ? claudeModels : openaiModels
  const defaultModel =
    provider === 'gemini' ? geminiModel : provider === 'claude' ? claudeModel : openaiModel
  const baseUrl =
    provider === 'gemini' ? geminiBaseUrl : provider === 'claude' ? claudeBaseUrl : openaiBaseUrl
  const apiKey =
    provider === 'gemini' ? geminiApiKey : provider === 'claude' ? claudeApiKey : openaiApiKey
  const sessionModel = useChatStore((state) =>
    sessionId ? (state.sessionCache[sessionId]?.model ?? null) : null
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const current = sessionModel || defaultModel

  const refresh = useCallback(async () => {
    if (!apiKey?.trim()) {
      return
    }
    setLoading(true)
    setError(false)
    const list =
      provider === 'gemini'
        ? await fetchGeminiModels(baseUrl || DEFAULT_GEMINI_BASE_URL, apiKey)
        : provider === 'claude'
          ? await fetchClaudeModels(baseUrl || DEFAULT_CLAUDE_BASE_URL, apiKey)
          : baseUrl.trim()
            ? await fetchOpenAIModels(baseUrl, apiKey)
            : []
    if (list.length > 0) {
      if (provider === 'gemini') {
        setGeminiModels(list)
      } else if (provider === 'claude') {
        setClaudeModels(list)
      } else {
        setOpenAIModels(list)
      }
    } else {
      // 拉取失败时保留旧列表，只在按钮上给出提示
      setError(true)
    }
    setLoading(false)
  }, [provider, baseUrl, apiKey])

  /**
   * 进入页面就刷新一次。依赖只放 provider 与是否已配置，
   * 避免 baseUrl/apiKey 变化时重复触发；未配置时跳过，配置完成后自动补拉。
   */
  const configured = Boolean(apiKey?.trim() && (provider !== 'openai' || baseUrl.trim()))
  useEffect(() => {
    if (provider === 'deepseek' || !configured) {
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    const state = useSettings.getState()
    const request =
      provider === 'gemini'
        ? fetchGeminiModels(
            state.geminiBaseUrl || DEFAULT_GEMINI_BASE_URL,
            state.geminiApiKey ?? ''
          )
        : provider === 'claude'
          ? fetchClaudeModels(
              state.claudeBaseUrl || DEFAULT_CLAUDE_BASE_URL,
              state.claudeApiKey ?? ''
            )
          : fetchOpenAIModels(state.openaiBaseUrl, state.openaiApiKey ?? '')
    void request.then((list) => {
      if (cancelled) {
        return
      }
      if (list.length > 0) {
        if (provider === 'gemini') {
          setGeminiModels(list)
        } else if (provider === 'claude') {
          setClaudeModels(list)
        } else {
          setOpenAIModels(list)
        }
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

  if (provider === 'deepseek') {
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
          } else if (provider === 'gemini') {
            setGeminiSettings({ model })
          } else if (provider === 'claude') {
            setClaudeSettings({ model })
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
