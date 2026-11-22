import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { setChatBackground, setChatBackgroundDim, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { showToast } from '../base/toastState.js'
import styles from './Settings.module.css'

/** 图片文件转成 data URL，存在浏览器本地 */
const toDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })

/** 图片体积上限，避免撑爆 localStorage */
const MAX_IMAGE_MB = 4

/**
 * 聊天区背景图：可以选本地图片，也可以填图片链接。
 * 图片只保存在浏览器本地，不会上传到任何服务器。
 */
export const BackgroundSetting = () => {
  const t = useTranslate()
  const background = useSettings((state) => state.chatBackground)
  const dim = useSettings((state) => state.chatBackgroundDim)
  const fileRef = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  const pickFile = async (file: File) => {
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      showToast({ key: 'backgroundTooLarge', params: { size: MAX_IMAGE_MB } })
      return
    }
    setBusy(true)
    try {
      const dataUrl = await toDataUrl(file)
      setChatBackground(dataUrl)
      showToast({ key: 'backgroundSaved' })
    } catch {
      showToast({ key: 'backgroundFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const applyUrl = () => {
    const value = url.trim()
    if (!value) {
      return
    }
    setChatBackground(value)
    setUrl('')
    showToast({ key: 'backgroundSaved' })
  }

  return (
    <div className={styles.cell}>
      <div className={styles.apiKey}>
        <div className={styles.label}>{t('settingsChatBackground')}</div>

        {background ? (
          <div className={styles.backgroundPreview}>
            <img src={background} alt="" className={styles.backgroundThumb} />
            <Button
              size="s"
              variant="outlined"
              onClick={() => {
                setChatBackground(null)
                showToast({ key: 'backgroundCleared' })
              }}
            >
              {t('backgroundRemove')}
            </Button>
          </div>
        ) : null}

        <div className={styles.modelPicker}>
          <Button
            size="s"
            variant="outlined"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {t(busy ? 'backgroundLoading' : 'backgroundPickFile')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                void pickFile(file)
              }
            }}
          />
        </div>

        <div className={styles.apiKeyInput}>
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder={t('backgroundUrlPlaceholder')}
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                applyUrl()
              }
            }}
          />
        </div>
        {url.trim() ? (
          <Button size="s" block onClick={applyUrl}>
            {t('backgroundApplyUrl')}
          </Button>
        ) : null}

        {background ? (
          <div className={styles.reasoningRow}>
            <span className={styles.reasoningLabel}>{t('backgroundDim', { value: dim })}</span>
            <div className={styles.stepper}>
              <Button
                size="s"
                variant="outlined"
                disabled={dim <= 0}
                onClick={() => setChatBackgroundDim(dim - 10)}
              >
                −
              </Button>
              <span className={styles.stepperValue}>{dim}%</span>
              <Button
                size="s"
                variant="outlined"
                disabled={dim >= 90}
                onClick={() => setChatBackgroundDim(dim + 10)}
              >
                +
              </Button>
            </div>
          </div>
        ) : null}

        <div className={styles.description}>{t('backgroundDescription')}</div>
      </div>
    </div>
  )
}
