import { useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { ApiError } from '../../services/api/client.js'
import { classifyApiError } from '../../services/api/errors.js'
import {
  DEFAULT_TTS_BASE_URL,
  normalizeTtsBaseUrl,
  probeTts,
  TTS_FORMATS,
  TTS_VOICES,
  type TtsProbeResult,
} from '../../services/api/tts.js'
import { setTtsSettings, setTtsVoice, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

/** 一行设置：左侧标题，右侧控件 */
const SettingRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className={styles.row}>
    <div className={styles.text}>
      <div className={styles.label}>{label}</div>
    </div>
    {children}
  </div>
)

/**
 * 朗读引擎：内置（跟随 DeepSeek Key）或用自己配置的 OpenAI 兼容 TTS。
 * 外部 TTS 与 AI 服务商完全独立，切换 AI 服务商不影响朗读。
 */
export const TtsEngineSetting = () => {
  const t = useTranslate()
  const engine = useSettings((state) => state.ttsEngine)
  const ttsVoice = useSettings((state) => state.ttsVoice)

  return (
    <>
      <SettingRow label={t('settingsTtsEngine')}>
        <Select
          ariaLabel={t('settingsTtsEngine')}
          value={engine}
          options={[
            { value: 'builtin' as const, label: t('settingsTtsBuiltin') },
            { value: 'external' as const, label: t('settingsTtsExternal') },
          ]}
          onChange={(value) => setTtsSettings({ engine: value })}
        />
      </SettingRow>
      {/* 内置音色只在用内置引擎时有意义 */}
      {engine === 'builtin' ? (
        <SettingRow label={t('settingsTtsVoice')}>
          <Select
            ariaLabel={t('settingsTtsVoice')}
            value={ttsVoice}
            options={[
              { value: 'stella', label: t('settingsTtsVoiceStella') },
              { value: 'tide', label: t('settingsTtsVoiceTide') },
            ]}
            onChange={(value) => setTtsVoice(value as never)}
          />
        </SettingRow>
      ) : null}
    </>
  )
}

/** 外部 TTS 的连接参数：地址、Key、模型、音色、格式、语速 */
export const ExternalTtsFields = () => {
  const t = useTranslate()
  const saved = useSettings()
  const [baseUrl, setBaseUrl] = useState(saved.ttsBaseUrl)
  const [apiKey, setApiKey] = useState(saved.ttsApiKey ?? '')
  const [model, setModel] = useState(saved.ttsModel)
  const [voice, setVoice] = useState(saved.ttsExternalVoice)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (saved.ttsEngine !== 'external') {
    return null
  }

  const [probe, setProbe] = useState<TtsProbeResult | null>(null)

  /** 试听：先保存配置，再真实播放一次，同时记录诊断结果 */
  const submit = async () => {
    if (saving) {
      return
    }
    const url = normalizeTtsBaseUrl(baseUrl) || DEFAULT_TTS_BASE_URL
    if (!apiKey.trim()) {
      setError(t('openaiApiKeyRequired'))
      return
    }
    const config = {
      baseUrl: url,
      apiKey: apiKey.trim(),
      model: model.trim() || 'tts-1',
      voice: voice.trim() || 'alloy',
      format: saved.ttsFormat,
      speed: saved.ttsSpeed,
    }
    setSaving(true)
    setError(null)
    setProbe(null)
    try {
      // 先保存，让「朗读」按钮也用上这套配置
      setTtsSettings({
        baseUrl: url,
        apiKey: config.apiKey,
        model: config.model,
        voice: config.voice,
      })
      const result = await probeTts(config)
      setProbe(result)
      if (!result.ok) {
        setError(t('openaiVerificationFailed', { message: result.error ?? '' }))
      } else if (!result.decodable) {
        setError(result.error ?? t('ttsProbeUndecodable'))
      } else {
        showToast({ key: 'openaiSaved' })
      }
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
        <div className={styles.label}>{t('settingsTtsBaseUrl')}</div>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder={DEFAULT_TTS_BASE_URL}
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </div>

        <div className={styles.label}>{t('openaiApiKey')}</div>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            className={styles.masked}
            autoComplete="off"
            spellCheck={false}
            placeholder={t('openaiApiKeyPlaceholder')}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>

        <div className={styles.label}>{t('settingsTtsModel')}</div>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="tts-1"
            value={model}
            onChange={(event) => setModel(event.target.value)}
          />
        </div>

        <div className={styles.label}>{t('settingsTtsExternalVoice')}</div>
        <div className={styles.apiKeyInput}>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="alloy"
            value={voice}
            onChange={(event) => setVoice(event.target.value)}
          />
        </div>
        <div className={styles.voiceChips}>
          {TTS_VOICES.map((item) => (
            <button
              key={item}
              type="button"
              className={styles.voiceChip}
              onClick={() => setVoice(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className={styles.reasoningRow}>
          <span className={styles.reasoningLabel}>{t('settingsTtsFormat')}</span>
          <Select
            ariaLabel={t('settingsTtsFormat')}
            value={saved.ttsFormat}
            options={TTS_FORMATS.map((f) => ({ value: f, label: f }))}
            onChange={(format) => setTtsSettings({ format })}
          />
        </div>

        <div className={styles.reasoningRow}>
          <span className={styles.reasoningLabel}>
            {t('settingsTtsSpeed', { value: saved.ttsSpeed.toFixed(2) })}
          </span>
          <div className={styles.stepper}>
            <Button
              size="s"
              variant="outlined"
              disabled={saved.ttsSpeed <= 0.5}
              onClick={() => setTtsSettings({ speed: Number((saved.ttsSpeed - 0.25).toFixed(2)) })}
            >
              −
            </Button>
            <span className={styles.stepperValue}>{saved.ttsSpeed.toFixed(2)}×</span>
            <Button
              size="s"
              variant="outlined"
              disabled={saved.ttsSpeed >= 2}
              onClick={() => setTtsSettings({ speed: Number((saved.ttsSpeed + 0.25).toFixed(2)) })}
            >
              +
            </Button>
          </div>
        </div>

        {probe ? (
          <div className={styles.description}>
            {t('ttsProbeResult', {
              type: probe.contentType || '-',
              bytes: probe.bytes,
              decodable: probe.decodable ? t('ttsProbeYes') : t('ttsProbeNo'),
            })}
          </div>
        ) : null}
        {error ? <div className={styles.error}>{error}</div> : null}
        <Button block disabled={saving} onClick={() => void submit()}>
          {t(saving ? 'openaiSaving' : 'ttsTestSave')}
        </Button>
      </div>
    </div>
  )
}
