import { useSyncExternalStore } from 'react'
import { useSettings, type ThemePreference } from '../services/settings.js'

export type Theme = 'light' | 'dark'

const query = window.matchMedia('(prefers-color-scheme: dark)')

const subscribeOsTheme = (listener: () => void) => {
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

const getOsTheme = (): Theme => (query.matches ? 'dark' : 'light')

const resolveTheme = (preference: ThemePreference, osTheme: Theme): Theme =>
  preference === 'system' ? osTheme : preference

/** 当前实际生效的深浅色：手动选择优先，「跟随系统」时取系统设置 */
export const useTheme = (): Theme => {
  const preference = useSettings((state) => state.themePreference)
  const osTheme = useSyncExternalStore(subscribeOsTheme, getOsTheme)
  return resolveTheme(preference, osTheme)
}

const syncPageBackground = () => {
  const backgroundColor = getComputedStyle(document.body).backgroundColor
  document.documentElement.style.backgroundColor = backgroundColor
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', backgroundColor)
}

/** 同步页面主题、根画布背景和支持 theme-color 的浏览器栏。 */
const applyTheme = (theme: Theme) => {
  const body = document.body
  // 主题切换帧禁用过渡，使页面颜色同步更新
  body.classList.add('change-theme')
  body.classList.toggle('dark', theme === 'dark')
  body.classList.toggle('light', theme === 'light')
  if (theme === 'dark') {
    body.setAttribute('data-ds-dark-theme', 'dark')
  } else {
    body.removeAttribute('data-ds-dark-theme')
  }
  document.documentElement.style.colorScheme = theme
  // 首次背景色同步在样式表加载完成后执行，适配 WebKit 的 defer 脚本执行顺序。
  if (document.readyState === 'complete') {
    syncPageBackground()
  }
  setTimeout(() => {
    body.classList.remove('change-theme')
  }, 0)
}

let appliedTheme: Theme | null = null

const syncTheme = () => {
  const theme = resolveTheme(useSettings.getState().themePreference, getOsTheme())
  if (theme !== appliedTheme) {
    appliedTheme = theme
    applyTheme(theme)
  }
}

/** 首屏渲染前同步应用一次，之后随主题设置与系统深浅色变化更新 */
export const setupTheme = () => {
  syncTheme()
  if (document.readyState !== 'complete') {
    window.addEventListener('load', syncPageBackground, { once: true })
  }
  query.addEventListener('change', syncTheme)
  useSettings.subscribe(syncTheme)
}

/**
 * 应用外观偏好：强调色覆盖品牌色变量，字号用根元素缩放，疏密写到 body 的 data 属性
 * 由样式表按属性调整间距。
 */
const applyAppearance = () => {
  const { accentColor, accentAffectsBubble, fontScale, density } = useSettings.getState()
  const root = document.documentElement
  const body = document.body

  /**
   * 品牌色变量定义在 body.dark / body.light 上，
   * 必须同样写在 body 的行内样式里才能覆盖它们；
   * 写在 html 上会被那些更具体的选择器盖掉。
   */
  const brandVars = [
    '--dsw-alias-brand-primary',
    '--dsw-alias-brand-text',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-brand-primary-invert',
    '--dsw-alias-button-primary-hover',
  ]
  if (accentColor) {
    for (const name of brandVars) {
      body.style.setProperty(name, accentColor)
    }
  }
  // 气泡是否跟随强调色由设置决定；关闭时回落到主题自带的固定配色
  if (accentAffectsBubble) {
    /*
     * 气泡跟随强调色：用 color-mix 派生浅/深两档，保持与背景的层次。
     * 未选颜色时 accentColor 为空字符串（表示默认蓝），此时改用主题的品牌色变量，
     * 这样「默认蓝」也能正常给气泡上色，而不是被当成没设置而跳过。
     */
    // 默认蓝取主题品牌色的实际色值：深浅色模式下都是这组蓝，避免引用 body 上的变量造成自引用
    const source = accentColor || 'rgb(57, 100, 254)'
    body.style.setProperty(
      '--dsw-specific-bubble',
      `color-mix(in srgb, ${source} 12%, var(--dsw-alias-bg-base))`
    )
    body.style.setProperty(
      '--dsw-specific-bubble-assistant',
      `color-mix(in srgb, ${source} 22%, var(--dsw-alias-bg-base))`
    )
  } else {
    body.style.removeProperty('--dsw-specific-bubble')
    body.style.removeProperty('--dsw-specific-bubble-assistant')
  }
  if (!accentColor) {
    for (const name of brandVars) {
      body.style.removeProperty(name)
    }
  }

  root.style.setProperty('--dsw-font-scale', String(fontScale))
  body.setAttribute('data-density', density)
}

/**
 * 回车行为变量定义在根元素上，输入框和发送按钮都读取它：
 * - Enter 换行：回车插入换行，改用发送按钮（或 Ctrl/Cmd+Enter）发送
 * - Enter 发送：回车直接发送，Shift+Enter 换行（默认，保持原有习惯）
 */
const applyEnterBehavior = () => {
  const { enterToSend } = useSettings.getState()
  document.documentElement.setAttribute('data-enter-action', enterToSend ? 'send' : 'newline')
}

/** 把颜色按透明度转成 rgba；无法解析时回退到透明的同色 */
const withAlpha = (color: string, alpha: number): string => {
  const value = color.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const raw = hex[1]
    const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw
    const r = parseInt(full.slice(0, 2), 16)
    const g = parseInt(full.slice(2, 4), 16)
    const b = parseInt(full.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value)
  if (rgb) {
    return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`
  }
  return `color-mix(in srgb, ${value} ${Math.round(alpha * 100)}%, transparent)`
}

/**
 * 聊天区背景图：图片与遮罩色写成 CSS 变量，由 .content 自己的 background 消费。
 * 不使用伪元素，避免引入额外图层影响消息列表与输入框的布局。
 */
const applyBackground = () => {
  const { chatBackground, chatBackgroundDim } = useSettings.getState()
  const root = document.documentElement
  if (!chatBackground) {
    root.style.removeProperty('--chat-bg-image')
    root.style.removeProperty('--chat-bg-dim-color')
    return
  }
  root.style.setProperty('--chat-bg-image', `url("${chatBackground}")`)
  // 遮罩颜色跟随当前主题底色，深浅色模式下都保证文字可读
  const base = getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base').trim()
  root.style.setProperty(
    '--chat-bg-dim-color',
    withAlpha(base || (document.body.classList.contains('dark') ? '#101014' : '#ffffff'),
      Math.min(1, Math.max(0, chatBackgroundDim / 100)))
  )
}

/**
 * 顶部模糊：开关写成 body 属性供样式判定，强度写成 CSS 变量。
 * 关闭时样式表直接隐藏模糊层，不参与布局。
 */
const applyTopBlur = () => {
  const { topBlur, topBlurStrength } = useSettings.getState()
  document.body.setAttribute('data-top-blur', topBlur ? 'on' : 'off')
  document.documentElement.style.setProperty('--chat-top-blur', `${topBlurStrength}px`)
}

/** 首次渲染前应用一次，之后随设置变化更新 */
export const setupAppearance = () => {
  applyAppearance()
  useSettings.subscribe(applyAppearance)
  applyEnterBehavior()
  useSettings.subscribe(applyEnterBehavior)
  applyBackground()
  useSettings.subscribe(applyBackground)
  applyTopBlur()
  useSettings.subscribe(applyTopBlur)
}
