import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  setChatBackground,
  setChatBackgroundCrop,
  setChatBackgroundDim,
  useSettings,
} from '../../services/settings.js'
import { BackgroundCropModal, type CropRect } from './BackgroundCrop.js'
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
  /** 正在裁剪的图片；确认后才写入设置 */
  const [pending, setPending] = useState<string | null>(null)
  const crop = useSettings((state) => state.chatBackgroundCrop)
  /** 聊天区大致宽高比，用于提示取景比例 */
  const aspect =
    typeof window === 'undefined' ? 1.6 : Math.max(0.6, window.innerWidth / window.innerHeight)

  const pickFile = async (file: File) => {
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      showToast({ key: 'backgroundTooLarge', params: { size: MAX_IMAGE_MB } })
      return
    }
    setBusy(true)
    try {
      const dataUrl = await toDataUrl(file)
      // 先进裁剪界面，确认后再写入设置
      setPending(dataUrl)
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
    setPending(value)
    setUrl('')
  }

  /** 按裁剪区域生成新图，聊天区直接 cover 铺满即可 */
  const applyCrop = async (rect: CropRect) => {
    const src = pending
    setPending(null)
    if (!src) {
      return
    }
    setBusy(true)
    try {
      const image = await loadImage(src)
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * rect.width))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * rect.height))
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('canvas unavailable')
      }
      ctx.drawImage(
        image,
        Math.round(image.naturalWidth * rect.x),
        Math.round(image.naturalHeight * rect.y),
        canvas.width,
        canvas.height,
        0,
        0,
        canvas.width,
        canvas.height
      )
      // 裁切后仍用 data URL 保存，避免原图过大占满存储
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
      setChatBackground(dataUrl)
      setChatBackgroundCrop(null)
      showToast({ key: 'backgroundSaved' })
    } catch {
      showToast({ key: 'backgroundFailed', type: 'error' })
    } finally {
      setBusy(false)
    }
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
      {pending ? (
        <BackgroundCropModal
          src={pending}
          initial={crop}
          aspect={aspect}
          onCancel={() => setPending(null)}
          onConfirm={(rect) => void applyCrop(rect)}
        />
      ) : null}
    </div>
  )
}

/** 载入图片，等解码完成后再画到 canvas 上 */
const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('image load failed'))
    image.src = src
  })
