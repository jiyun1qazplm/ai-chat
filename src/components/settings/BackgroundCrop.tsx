import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import styles from './BackgroundCrop.module.css'

/** 裁剪框用原图百分比表示，0-1 */
export type CropRect = { x: number; y: number; width: number; height: number }

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | null

/** 最小裁剪尺寸占原图的比例，避免拖成一条线 */
const MIN_SIZE = 0.05

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * 背景图裁剪：在图片上拖出一个矩形并确认。
 * 裁剪框支持整体拖动与四角缩放；确认后由调用方写回设置。
 */
export const BackgroundCropModal = ({
  src,
  initial,
  aspect,
  onCancel,
  onConfirm,
}: {
  src: string
  initial: CropRect | null
  /** 聊天区的宽高比，用于提示用户取景比例；不强制 */
  aspect: number
  onCancel: () => void
  onConfirm: (rect: CropRect) => void
}) => {
  const t = useTranslate()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<CropRect>(initial ?? { x: 0, y: 0, width: 1, height: 1 })
  const [drag, setDrag] = useState<{
    mode: DragMode
    startX: number
    startY: number
    base: CropRect
  } | null>(null)

  /** 屏幕坐标转成原图比例 */
  const toRatio = useCallback((clientX: number, clientY: number) => {
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box) {
      return { x: 0, y: 0 }
    }
    return {
      x: clamp((clientX - box.left) / box.width, 0, 1),
      y: clamp((clientY - box.top) / box.height, 0, 1),
    }
  }, [])

  useEffect(() => {
    if (!drag) {
      return
    }
    const onMove = (event: PointerEvent) => {
      const point = toRatio(event.clientX, event.clientY)
      const { mode, startX, startY, base } = drag
      if (mode === 'move') {
        const dx = point.x - startX
        const dy = point.y - startY
        setRect({
          ...base,
          x: clamp(base.x + dx, 0, 1 - base.width),
          y: clamp(base.y + dy, 0, 1 - base.height),
        })
        return
      }
      // 四角缩放：分别调整对应边界
      let left = base.x
      let top = base.y
      let right = base.x + base.width
      let bottom = base.y + base.height
      if (mode === 'nw' || mode === 'sw') {
        left = clamp(point.x, 0, right - MIN_SIZE)
      }
      if (mode === 'ne' || mode === 'se') {
        right = clamp(point.x, left + MIN_SIZE, 1)
      }
      if (mode === 'nw' || mode === 'ne') {
        top = clamp(point.y, 0, bottom - MIN_SIZE)
      }
      if (mode === 'sw' || mode === 'se') {
        bottom = clamp(point.y, top + MIN_SIZE, 1)
      }
      setRect({ x: left, y: top, width: right - left, height: bottom - top })
    }
    const onUp = () => setDrag(null)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [drag, toRatio])

  const startDrag = (mode: DragMode) => (event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const point = toRatio(event.clientX, event.clientY)
    setDrag({ mode, startX: point.x, startY: point.y, base: rect })
  }

  return (
    <Modal
      title={t('cropTitle')}
      closable
      className={styles.dialog}
      onClose={onCancel}
      footer={
        <div className={styles.actions}>
          <Button variant="outlined" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button onClick={() => onConfirm(rect)}>{t('cropConfirm')}</Button>
        </div>
      }
    >
      <div className={styles.hint}>{t('cropHint', { ratio: aspect.toFixed(2) })}</div>
      <div ref={wrapRef} className={styles.stage}>
        <img className={styles.image} src={src} alt="" draggable={false} />
        {/* 未选中的区域压暗 */}
        <div className={styles.shade} />
        <div
          className={styles.box}
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
          onPointerDown={startDrag('move')}
        >
          <span className={`${styles.handle} ${styles.nw}`} onPointerDown={startDrag('nw')} />
          <span className={`${styles.handle} ${styles.ne}`} onPointerDown={startDrag('ne')} />
          <span className={`${styles.handle} ${styles.sw}`} onPointerDown={startDrag('sw')} />
          <span className={`${styles.handle} ${styles.se}`} onPointerDown={startDrag('se')} />
        </div>
      </div>
      <div className={styles.meta}>
        {t('cropSize', {
          w: Math.round(rect.width * 100),
          h: Math.round(rect.height * 100),
        })}
      </div>
    </Modal>
  )
}
