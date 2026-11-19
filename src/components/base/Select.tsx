import clsx from 'clsx'
import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismiss } from './anchored.js'
import { IconCheckOutline16, IconChevronDownOutline14 } from './icons.js'
import styles from './Select.module.css'

export type SelectOption<T extends string> = { value: T; label: string; lang?: string }

/**
 * 胶囊形选择器：触发器高 36px、圆角 18px、浅灰底，下拉菜单选中项右侧打勾；
 * 点外部或 Esc 关闭。value 不匹配任何选项时触发器显示 placeholder。
 */
export const Select = <T extends string>({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  className,
  disabled = false,
  searchable = false,
  searchPlaceholder,
}: {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
  /** 选项很多时在菜单顶部显示搜索框 */
  searchable?: boolean
  searchPlaceholder?: string
}) => {
  const [open, setOpen] = useState(false)
  /** 菜单内的搜索关键词，关闭菜单时清空 */
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // 按关键词过滤；搜索不区分大小写，空关键词显示全部
  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return keyword
      ? options.filter((option) => option.label.toLowerCase().includes(keyword))
      : options
  }, [options, query])
  const current = options.find((option) => option.value === value)
  // 菜单贴右侧展开，最多 320px 高，超出在菜单内滚动
  const { anchorRef, floatingRef, position } = useAnchoredPosition<
    HTMLButtonElement,
    HTMLDivElement
  >(open, { align: 'end', maxHeight: 320, minSpace: 160 })
  // Esc 只关菜单，不让外层弹窗一起关闭
  useDismiss(open, [anchorRef, floatingRef], () => setOpen(false), { captureEscape: true })

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={clsx(styles.trigger, open && styles.open, className)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setQuery('')
          setOpen((value) => !value)
        }}
      >
        {current ? (
          <span lang={current.lang}>{current.label}</span>
        ) : (
          <span className={styles.placeholder}>{placeholder}</span>
        )}
        <span className={styles.arrow}>
          <IconChevronDownOutline14 />
        </span>
      </button>
      {open && !disabled
        ? createPortal(
            <div
              ref={floatingRef}
              className={styles.menu}
              style={position ?? undefined}
              role="listbox"
              aria-label={ariaLabel}
            >
              {searchable ? (
                <input
                  ref={searchRef}
                  className={styles.search}
                  type="search"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={searchPlaceholder ?? ''}
                  value={query}
                  // 菜单打开后自动聚焦搜索框
                  autoFocus
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    // 回车选中第一项，Esc 关闭
                    if (event.key === 'Escape') {
                      setOpen(false)
                    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      const first = visible[0]
                      if (first) {
                        setOpen(false)
                        setQuery('')
                        onChange(first.value)
                      }
                    }
                  }}
                />
              ) : null}
              {visible.length === 0 ? (
                <div className={styles.empty}>{searchPlaceholder}</div>
              ) : null}
              {visible.map((option) => (
                <div
                  key={option.value}
                  role="option"
                  lang={option.lang}
                  aria-selected={option.value === value}
                  className={styles.option}
                  onClick={() => {
                    setOpen(false)
                    setQuery('')
                    onChange(option.value)
                  }}
                >
                  <span>{option.label}</span>
                  {option.value === value ? <IconCheckOutline16 /> : null}
                </div>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
