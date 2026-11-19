import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import {
  DEFAULT_OPENAI_BASE_URL,
  normalizeBaseUrl,
  verifyOpenAIEndpoint,
} from '../../services/api/openai.js'
import { searchWithTavily } from '../../services/api/tavily.js'
import {
  DEFAULT_OPENAI_MODEL,
  setOpenAIApiKey,
  setOpenAIBaseUrl,
  setOpenAIModel,
  setProvider,
  setTavilyApiKey,
  setTavilyOptions,
  useSettings,
  type ApiProvider,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

/** 服务商选择：官方接口用全家桶能力，兼容接口只用到对话 */
export const ProviderField = () => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('settingsProvider')}</div>
        <Select
          ariaLabel={t('settingsProvider')}
          value={provider}
          options={[
            { value: 'deepseek' as ApiProvider, label: t('settingsProviderDeepseek') },
            { value: 'openai' as ApiProvider, label: t('settingsProviderOpenai') },
          ]}
          onChange={setProvider}
        />
        <div className={styles.description}>
          {provider === 'openai'
            ? t('settingsProviderOpenaiDescription')
            : t('settingsProviderDescription')}
        </div>
      </div>
    </div>
  )
}

/**
 * OpenAI 兼容端点的配置：调用地址、API Key、模型名。
 * 保存前先用 GET /models 校验，通过才写入设置；没有该接口的网关只校验可达性。
 */
export const OpenAIEndpointFields = () => {
  const t = useTranslate()
  const saved = useSettings()
  const [baseUrl, setBaseUrl] = useState(saved.openaiBaseUrl || DEFAULT_OPENAI_BASE_URL)
  const [apiKey, setApiKey] = useState(saved.openaiApiKey ?? '')
  const models = useSettings((state) => state.openaiModels)
  const [model, setModel] = useState(saved.openaiModel || DEFAULT_OPENAI_MODEL)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    normalizeBaseUrl(baseUrl) !== normalizeBaseUrl(saved.openaiBaseUrl) ||
    apiKey.trim() !== (saved.openaiApiKey ?? '') ||
    (model.trim() || DEFAULT_OPENAI_MODEL) !== saved.openaiModel

  const submit = async () => {
    if (saving) {
      return
    }
    const url = normalizeBaseUrl(baseUrl)
    if (!url) {
      setError(t('openaiBaseUrlRequired'))
      return
    }
    const key = apiKey.trim()
    if (!key) {
      setError(t('openaiApiKeyRequired'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await verifyOpenAIEndpoint(url, key)
      const nextModel = model.trim() || DEFAULT_OPENAI_MODEL
      setOpenAIBaseUrl(url)
      setOpenAIApiKey(key)
      setOpenAIModel(nextModel)
      setBaseUrl(url)
      setModel(nextModel)
      showToast({ key: 'openaiSaved' })
    } catch (cause) {
      const kind = classifyApiError(cause)
      setError(
        kind === 'unauthorized'
          ? t('openaiInvalid')
          : kind === 'network'
            ? t('commonNetworkErrorToast')
            : t('openaiVerificationFailed', {
                message: cause instanceof ApiError ? cause.message : String(cause),
              })
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('openaiBaseUrl')}</div>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={DEFAULT_OPENAI_BASE_URL}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>

        <div className={styles.label}>{t('openaiApiKey')}</div>
        <div className={styles.apiKeyInput}>
          <input
            // 用 text + CSS 脱敏，避开系统安全键盘
            type="text"
            className={styles.masked}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('openaiApiKeyPlaceholder')}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                void submit()
              }
            }}
          />
        </div>

        <div className={styles.label}>{t('openaiModel')}</div>
        {/* 有拉取到列表时可下拉选择，也可手动输入列表外的模型名 */}
        {models.length > 0 ? (
          <div className={styles.modelPicker}>
            <Select
              ariaLabel={t('openaiModel')}
              value={model}
              options={[
                ...(models.includes(model)
                  ? []
                  : model.trim()
                    ? [{ value: model, label: model }]
                    : []),
                ...models.map((id) => ({ value: id, label: id })),
              ]}
              searchable
              searchPlaceholder={t('modelSearchPlaceholder')}
              onChange={setModel}
            />
            <Button size="s" variant="outlined" onClick={() => setModel('')}>
              {t('modelCustomInput')}
            </Button>
          </div>
        ) : null}
        {models.length === 0 || model === '' ? (
          <div className={styles.apiKeyInput}>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder={DEFAULT_OPENAI_MODEL}
              value={model}
              onChange={(event) => setModel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  void submit()
                }
              }}
            />
          </div>
        ) : null}

        {error ? <div className={styles.error}>{error}</div> : null}
        <Button block disabled={saving || !dirty} onClick={() => void submit()}>
          {t(saving ? 'openaiSaving' : 'openaiSave')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Tavily 联网搜索的 Key：兼容模式下打开「智能搜索」开关时使用。
 * 保存前发一次最小的搜索请求校验。
 */
export const TavilyField = () => {
  const t = useTranslate()
  const saved = useSettings((state) => state.tavilyApiKey) ?? ''
  const [value, setValue] = useState(saved)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = value.trim() !== saved

  const submit = async () => {
    if (saving) {
      return
    }
    const key = value.trim()
    if (!key) {
      setTavilyApiKey(null)
      showToast({ key: 'tavilyCleared' })
      return
    }
    setSaving(true)
    setError(null)
    try {
      await searchWithTavily(key, 'hello', AbortSignal.timeout(15000))
      setTavilyApiKey(key)
      showToast({ key: 'tavilySaved' })
    } catch (cause) {
      const kind = classifyApiError(cause)
      setError(
        kind === 'unauthorized'
          ? t('tavilyInvalid')
          : kind === 'network'
            ? t('commonNetworkErrorToast')
            : t('tavilyVerificationFailed', {
                message: cause instanceof ApiError ? cause.message : String(cause),
              })
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('tavilyApiKey')}</div>
        <div className={styles.apiKeyInput}>
          <input
            // 用 text + CSS 脱敏，避开系统安全键盘
            type="text"
            className={styles.masked}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('tavilyApiKeyPlaceholder')}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                void submit()
              }
            }}
          />
        </div>
        <div className={styles.description}>{t('tavilyDescription')}</div>
        {error ? <div className={styles.error}>{error}</div> : null}
        <Button block disabled={saving || !dirty} onClick={() => void submit()}>
          {t(saving ? 'openaiSaving' : 'openaiSave')}
        </Button>
      </div>
    </div>
  )
}

/**
 * 联网搜索的高级选项：结果条数、搜索深度、是否附带总结。
 * 修改后立即保存，不需要点验证按钮。
 */
export const TavilyOptions = () => {
  const t = useTranslate()
  const maxResults = useSettings((state) => state.tavilyMaxResults)
  const searchDepth = useSettings((state) => state.tavilySearchDepth)
  const includeAnswer = useSettings((state) => state.tavilyIncludeAnswer)
  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('tavilyOptions')}</div>

        <div className={styles.reasoningRow}>
          <span className={styles.reasoningLabel}>{t('tavilyMaxResults')}</span>
          <div className={styles.stepper}>
            <Button
              size="s"
              variant="outlined"
              disabled={maxResults <= 1}
              onClick={() => setTavilyOptions({ maxResults: maxResults - 1 })}
            >
              −
            </Button>
            <span className={styles.stepperValue}>{maxResults}</span>
            <Button
              size="s"
              variant="outlined"
              disabled={maxResults >= 20}
              onClick={() => setTavilyOptions({ maxResults: maxResults + 1 })}
            >
              +
            </Button>
          </div>
        </div>

        <div className={styles.reasoningRow}>
          <span className={styles.reasoningLabel}>{t('tavilySearchDepth')}</span>
          <Select
            ariaLabel={t('tavilySearchDepth')}
            value={searchDepth}
            options={[
              { value: 'basic' as const, label: t('tavilyDepthBasic') },
              { value: 'advanced' as const, label: t('tavilyDepthAdvanced') },
            ]}
            onChange={(value) => setTavilyOptions({ searchDepth: value })}
          />
        </div>

        <div className={styles.reasoningRow}>
          <span className={styles.reasoningLabel}>{t('tavilyIncludeAnswer')}</span>
          <Select
            ariaLabel={t('tavilyIncludeAnswer')}
            value={includeAnswer ? 'on' : 'off'}
            options={[
              { value: 'off' as const, label: t('tavilyAnswerOff') },
              { value: 'on' as const, label: t('tavilyAnswerOn') },
            ]}
            onChange={(value) => setTavilyOptions({ includeAnswer: value === 'on' })}
          />
        </div>

        <div className={styles.description}>{t('tavilyOptionsDescription')}</div>
      </div>
    </div>
  )
}
