import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconPanelLeftOutline16, IconSettingsOutline16, NewChatIcon } from '../base/icons.js'
import { setSiderCollapsed } from '../../services/settings.js'
import { groupSessions } from '../../services/chat/sessionGroups.js'
import { newChat, removeSession, removeSessions, useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { Button } from '../base/Button.js'
import { IconButton } from '../base/IconButton.js'
import { Modal } from '../base/Modal.js'
import { showToast } from '../base/toastState.js'
import { openSettings } from '../settings/settingsDialogState.js'
import { closeMobileSider, useMobileSider } from './mobileSiderState.js'
import { SessionItem } from './SessionItem.js'
import styles from './Sider.module.css'

/** 展开的侧边栏：名称与收起按钮、开启新对话、按时间分组的会话列表、底部设置；移动端放在抽屉里，收起按钮关闭抽屉 */
export const Sider = ({ mobile = false }: { mobile?: boolean }) => {
  const t = useTranslate()
  const sessions = useChatStore((state) => state.sessions)
  const activeId = useChatStore((state) => state.activeId)
  const [now, setNow] = useState(Date.now)
  const groups = useMemo(() => groupSessions(sessions, now, t), [sessions, now, t])
  const [deleting, setDeleting] = useState<SessionSummary | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  /** 多选模式：非 null 表示正在选择，集合里是已选中的会话 id */
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const [bulkPending, setBulkPending] = useState(false)
  const [bulkConfirm, setBulkConfirm] = useState(false)

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const refresh = () => {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const midnight = new Date(time).setHours(24, 0, 0, 0)
      timer = setTimeout(refresh, midnight - time)
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    refresh()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return (
    <div className={clsx(styles.sider, mobile && styles.mobile)}>
      <div className={styles.top}>
        <div className={styles.appName}>{t('appName')}</div>
        <IconButton
          size="m"
          icon={<IconPanelLeftOutline16 />}
          tooltip={t('collapseSiderbarButton')}
          tooltipPlacement="bottom"
          onClick={() => (mobile ? closeMobileSider() : setSiderCollapsed(true))}
        />
      </div>
      {selected ? (
        <div className={styles.selectBar}>
          <button type="button" className={styles.selectText} onClick={() => setSelected(null)}>
            {t('selectionCancel')}
          </button>
          <span className={styles.selectCount}>
            {t('selectionCount', { count: selected.size })}
          </span>
          <button
            type="button"
            className={styles.selectText}
            onClick={() =>
              setSelected((prev) =>
                prev && prev.size === sessions.length
                  ? new Set()
                  : new Set(sessions.map((item) => item.id))
              )
            }
          >
            {selected.size === sessions.length && sessions.length > 0
              ? t('selectionNone')
              : t('selectionAll')}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={styles.newChat}
          onClick={() => {
            newChat()
            closeMobileSider()
          }}
        >
          <span className={styles.newChatIcon}>
            <NewChatIcon />
          </span>
          {t('newChat')}
        </button>
      )}
      <div className={styles.listWrap}>
        <div className={styles.list}>
          {groups.map((group) => (
            <div key={group.key} className={styles.section}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.sessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  active={session.id === activeId}
                  onDelete={() => setDeleting(session)}
                  selecting={selected !== null}
                  selected={selected?.has(session.id) ?? false}
                  onToggleSelect={() => toggleSelect(session.id)}
                  onStartSelect={() => setSelected(new Set([session.id]))}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      {selected ? (
        <div className={styles.bulkBottom}>
          <Button
            variant="dangerOutlined"
            size="m"
            block
            disabled={selected.size === 0 || bulkPending}
            onClick={() => setBulkConfirm(true)}
          >
            {t('selectionDelete', { count: selected.size })}
          </Button>
        </div>
      ) : (
        <div className={styles.bottom}>
          <button type="button" className={styles.settings} onClick={() => openSettings('general')}>
            <span className={styles.settingsIcon}>
              <IconSettingsOutline16 />
            </span>
            <span className={styles.settingsLabel}>{t('settings')}</span>
          </button>
          {/* 进入多选的入口：放在设置行右侧，不占额外高度 */}
          <button
            type="button"
            className={styles.selectEnter}
            onClick={() => setSelected(new Set())}
          >
            {t('selectionEnter')}
          </button>
        </div>
      )}
      {bulkConfirm && selected ? (
        <Modal
          title={t('selectionDeleteTitle')}
          onClose={() => {
            if (!bulkPending) {
              setBulkConfirm(false)
            }
          }}
          footer={
            <>
              <Button
                variant="outlined"
                disabled={bulkPending}
                onClick={() => setBulkConfirm(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={bulkPending}
                onClick={async () => {
                  setBulkPending(true)
                  const ids = [...selected]
                  const removed = await removeSessions(ids)
                  setBulkPending(false)
                  setBulkConfirm(false)
                  setSelected(null)
                  showToast(
                    removed === ids.length
                      ? { key: 'selectionDeleted', params: { count: removed } }
                      : { key: 'selectionDeletePartial', params: { removed, total: ids.length } }
                  )
                }}
              >
                {t(bulkPending ? 'selectionDeleting' : 'delete')}
              </Button>
            </>
          }
        >
          {t('selectionDeleteDescription', { count: selected.size })}
        </Modal>
      ) : null}
      {deleting ? (
        <Modal
          title={t('deleteSessionModalContentTitle')}
          onClose={() => {
            if (!deletePending) {
              setDeleting(null)
            }
          }}
          footer={
            <>
              <Button variant="outlined" disabled={deletePending} onClick={() => setDeleting(null)}>
                {t('cancel')}
              </Button>
              <Button
                variant="danger"
                disabled={deletePending}
                onClick={async () => {
                  setDeletePending(true)
                  try {
                    if (await removeSession(deleting.id)) {
                      setDeleting(null)
                    } else {
                      showToast({ key: 'sessionDeleteFailed', type: 'error' })
                    }
                  } finally {
                    setDeletePending(false)
                  }
                }}
              >
                {t('delete')}
              </Button>
            </>
          }
        >
          {t('deleteSessionWithFilesDescription')}
        </Modal>
      ) : null}
    </div>
  )
}

/** 移动端抽屉：浮在页面上方，点空白区域关闭。 */
export const MobileSider = () => {
  const open = useMobileSider((state) => state.open)
  if (!open) {
    return null
  }
  return (
    <>
      <div className={styles.drawerMask} onClick={closeMobileSider} />
      <div className={styles.drawer}>
        <Sider mobile />
      </div>
    </>
  )
}
