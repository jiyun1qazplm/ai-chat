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
  const { accentColor, fontScale, density } = useSettings.getState()
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
    // 气泡也跟随强调色：用 color-mix 派生浅/深两档，保持与背景的层次
    body.style.setProperty(
      '--dsw-specific-bubble',
      `color-mix(in srgb, ${accentColor} 12%, var(--dsw-alias-bg-base))`
    )
    body.style.setProperty(
      '--dsw-specific-bubble-assistant',
      `color-mix(in srgb, ${accentColor} 22%, var(--dsw-alias-bg-base))`
    )
  } else {
    for (const name of [...brandVars, '--dsw-specific-bubble', '--dsw-specific-bubble-assistant']) {
      body.style.removeProperty(name)
    }
  }

  root.style.setProperty('--dsw-font-scale', String(fontScale))
  body.setAttribute('data-density', density)
}

/** 首次渲染前应用一次，之后随设置变化更新 */
export const setupAppearance = () => {
  applyAppearance()
  useSettings.subscribe(applyAppearance)
}
