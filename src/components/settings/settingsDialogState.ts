import { create } from 'zustand'
import { isProviderReady, useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用设置 / 个性化 / 长期记忆 / 数据管理 */
export type SettingsSection = 'general' | 'appearance' | 'tools' | 'memory' | 'data'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/** 当前服务商还没配置好时，打开设置并选中凭据所在的「数据管理」，返回是否已就绪 */
export const ensureApiKey = () => {
  if (isProviderReady(useSettings.getState())) {
    return true
  }
  openSettings('data')
  return false
}
