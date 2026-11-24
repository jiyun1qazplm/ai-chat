import clsx from 'clsx'
import { memo, useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import {
  IconCheckOutline16,
  IconEditOutline16,
  IconEllipsisOutline16,
  IconTrashOutline16,
} from '../base/icons.js'
import { renameSession, selectSession } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
  selecting = false,
  selected = false,
  onToggleSelect,
  onStartSelect,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
  /** 多选模式：点击切换选中而不是打开会话 */
  selecting?: boolean
  selected?: boolean
  onToggleSelect?: () => void
  /** 长按进入多选 */
  onStartSelect?: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const longPressTimer = useRef(0)
  const displayTitle = session.title || t('untitledChat')

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(
        styles.item,
        active && styles.active,
        selecting && styles.selecting,
        selected && styles.selected
      )}
      onClick={() => {
        if (selecting) {
          onToggleSelect?.()
          return
        }
        selectSession(session.id)
        closeMobileSider()
      }}
      // 长按进入多选：手机上比点按钮更自然
      onContextMenu={(event) => {
        if (selecting) {
          return
        }
        event.preventDefault()
        onStartSelect?.()
      }}
      onTouchStart={() => {
        if (selecting || !onStartSelect) {
          return
        }
        longPressTimer.current = window.setTimeout(() => onStartSelect(), 520)
      }}
      onTouchEnd={() => {
        window.clearTimeout(longPressTimer.current)
      }}
      onTouchMove={() => {
        window.clearTimeout(longPressTimer.current)
      }}
    >
      {selecting ? (
        <span className={clsx(styles.check, selected && styles.checkOn)} aria-hidden>
          {selected ? <IconCheckOutline16 /> : null}
        </span>
      ) : null}
      <div className={styles.title}>{displayTitle}</div>
      {selecting ? null : (
        <div className={styles.action} onClick={(event) => event.stopPropagation()}>
          <Menu
            options={[
              {
                key: 'rename',
                label: t('sessionItemMenuRenameOption'),
                icon: <IconEditOutline16 />,
                onSelect: () => setEditing(true),
              },
              {
                key: 'delete',
                label: t('delete'),
                icon: <IconTrashOutline16 />,
                danger: true,
                onSelect: onDelete,
              },
            ]}
          >
            {({ toggle }) => (
              <IconButton
                icon={<IconEllipsisOutline16 />}
                aria-label={t('more')}
                onClick={toggle}
              />
            )}
          </Menu>
        </div>
      )}
    </div>
  )
})
