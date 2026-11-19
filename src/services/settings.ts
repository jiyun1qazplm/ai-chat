import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import type { ReasoningMode, ReasoningOnMode } from './api/reasoning.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/**
 * 接口服务商：deepseek 走官方 Anthropic 兼容接口（搜索、阅读链接等全家桶能力）；
 * openai 走任意 OpenAI 兼容端点（/chat/completions），只用到对话与流式输出。
 */
export type ApiProvider = 'deepseek' | 'openai'

export type { ReasoningMode } from './api/reasoning.js'

/** OpenAI 兼容服务商的默认模型名，可在设置里修改 */
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'

/** 本机设置，存 localStorage：服务商与端点、API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  provider: ApiProvider
  /** OpenAI 兼容模式的调用地址，如 https://api.openai.com/v1；不写时按默认值 */
  openaiBaseUrl: string
  /** OpenAI 兼容模式的 API Key，与官方接口的 Key 分开保存 */
  openaiApiKey: string | null
  /** OpenAI 兼容模式的模型名 */
  openaiModel: string
  /** Tavily 联网搜索的 Key，兼容模式下打开搜索开关时使用 */
  tavilyApiKey: string | null
  /** 每次搜索最多返回多少条结果（1-20） */
  tavilyMaxResults: number
  /** 搜索深度：basic 更快，advanced 更准但更慢更贵 */
  tavilySearchDepth: 'basic' | 'advanced'
  /** 是否让 Tavily 直接给出一段总结 */
  tavilyIncludeAnswer: boolean
  /** 从兼容端点拉取到的可用模型列表，仅用于界面下拉 */
  openaiModels: string[]
  /**
   * 思考相关参数的发送方式，不同网关形式不同：
   * - none：完全不发送
   * - effort-off / effort-none / effort-low：reasoning_effort 取对应值
   * - thinking-disabled：thinking: { type: 'disabled' }（DeepSeek 官方风格）
   * - template-thinking：chat_template_kwargs: { thinking: false }（vLLM 风格）
   */
  reasoningMode: ReasoningMode
  /** 开启深度思考时的发送方式；auto 表示按模型名推断 */
  reasoningOnMode: ReasoningOnMode
  locale: Locale
  themePreference: ThemePreference
  /** 强调色（十六进制）；null 表示用默认蓝 */
  accentColor: string | null
  /** 正文字号倍数，1 为默认 */
  fontScale: number
  /** 消息列表的疏密：紧凑 / 标准 / 宽松 */
  density: 'compact' | 'normal' | 'comfortable'
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  provider: 'chat-demo:provider',
  openaiBaseUrl: 'chat-demo:openai-base-url',
  openaiApiKey: 'chat-demo:openai-api-key',
  openaiModel: 'chat-demo:openai-model',
  tavilyApiKey: 'chat-demo:tavily-api-key',
  tavilyMaxResults: 'chat-demo:tavily-max-results',
  tavilySearchDepth: 'chat-demo:tavily-search-depth',
  tavilyIncludeAnswer: 'chat-demo:tavily-include-answer',
  openaiModels: 'chat-demo:openai-models',
  reasoningMode: 'chat-demo:reasoning-mode',
  reasoningOnMode: 'chat-demo:reasoning-on-mode',
  locale: 'chat-demo:locale',
  accentColor: 'chat-demo:accent-color',
  fontScale: 'chat-demo:font-scale',
  density: 'chat-demo:density',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 默认按模型自动适配 */
const initialReasoningMode = (): ReasoningMode => {
  const saved = read(KEYS.reasoningMode)
  const allowed: ReasoningMode[] = [
    'auto',
    'effort-off',
    'effort-none',
    'effort-low',
    'thinking-disabled',
    'template-thinking',
    'none',
  ]
  return allowed.includes(saved as ReasoningMode) ? (saved as ReasoningMode) : 'auto'
}

const initialReasoningOnMode = (): ReasoningOnMode => {
  const saved = read(KEYS.reasoningOnMode)
  const allowed: ReasoningOnMode[] = [
    'auto',
    'effort-high',
    'effort-medium',
    'thinking-enabled',
    'output-config-high',
    'template-thinking',
    'none',
  ]
  return allowed.includes(saved as ReasoningOnMode) ? (saved as ReasoningOnMode) : 'auto'
}

/** 字号倍数限制在合理区间，避免历史数据把界面撑坏 */
const initialFontScale = (): number => {
  const value = Number(read(KEYS.fontScale))
  return Number.isFinite(value) && value >= 0.85 && value <= 1.3 ? value : 1
}

const initialDensity = (): Settings['density'] => {
  const saved = read(KEYS.density)
  return saved === 'compact' || saved === 'comfortable' ? saved : 'normal'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 未保存过时使用官方接口 */
const initialProvider = (): ApiProvider =>
  read(KEYS.provider) === 'openai' ? 'openai' : 'deepseek'

const initialOpenAIModel = (): string => read(KEYS.openaiModel)?.trim() || DEFAULT_OPENAI_MODEL

/** 搜索结果条数限制在 1-20，Tavily 上限为 20 */
const initialTavilyMaxResults = (): number => {
  const value = Number(read(KEYS.tavilyMaxResults))
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : 5
}

/** 拉取过的模型列表，损坏或不是数组时按空处理 */
const initialOpenAIModels = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.openaiModels) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  provider: initialProvider(),
  openaiBaseUrl: read(KEYS.openaiBaseUrl) ?? '',
  openaiApiKey: read(KEYS.openaiApiKey),
  openaiModel: initialOpenAIModel(),
  tavilyApiKey: read(KEYS.tavilyApiKey),
  tavilyMaxResults: initialTavilyMaxResults(),
  tavilySearchDepth: read(KEYS.tavilySearchDepth) === 'advanced' ? 'advanced' : 'basic',
  tavilyIncludeAnswer: read(KEYS.tavilyIncludeAnswer) === 'true',
  openaiModels: initialOpenAIModels(),
  reasoningMode: initialReasoningMode(),
  reasoningOnMode: initialReasoningOnMode(),
  locale: initialLocale(),
  accentColor: read(KEYS.accentColor),
  fontScale: initialFontScale(),
  density: initialDensity(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setProvider = (provider: ApiProvider) => {
  write(KEYS.provider, provider)
  useSettings.setState({ provider })
}

export const setOpenAIBaseUrl = (openaiBaseUrl: string) => {
  write(KEYS.openaiBaseUrl, openaiBaseUrl)
  useSettings.setState({ openaiBaseUrl })
}

export const setOpenAIApiKey = (openaiApiKey: string | null) => {
  write(KEYS.openaiApiKey, openaiApiKey)
  useSettings.setState({ openaiApiKey })
}

export const setOpenAIModel = (openaiModel: string) => {
  write(KEYS.openaiModel, openaiModel)
  useSettings.setState({ openaiModel })
}

export const setOpenAIModels = (openaiModels: string[]) => {
  write(KEYS.openaiModels, JSON.stringify(openaiModels))
  useSettings.setState({ openaiModels })
}

export const setTavilyApiKey = (tavilyApiKey: string | null) => {
  write(KEYS.tavilyApiKey, tavilyApiKey)
  useSettings.setState({ tavilyApiKey })
}

/** 当前服务商是否已经配置好可以发请求（官方接口看 API Key，兼容模式还要有调用地址） */
export const isProviderReady = ({
  provider,
  apiKey,
  openaiBaseUrl,
  openaiApiKey,
}: Pick<Settings, 'provider' | 'apiKey' | 'openaiBaseUrl' | 'openaiApiKey'>): boolean =>
  provider === 'openai' ? Boolean(openaiBaseUrl.trim() && openaiApiKey?.trim()) : Boolean(apiKey)

export const setAccentColor = (accentColor: string | null) => {
  write(KEYS.accentColor, accentColor)
  useSettings.setState({ accentColor })
}

export const setFontScale = (fontScale: number) => {
  write(KEYS.fontScale, String(fontScale))
  useSettings.setState({ fontScale })
}

export const setDensity = (density: Settings['density']) => {
  write(KEYS.density, density)
  useSettings.setState({ density })
}

/** 可选的强调色；值为 CSS 颜色，null 表示默认蓝 */
export const ACCENT_COLORS: { value: string; key: string }[] = [
  { value: '', key: 'accentDefault' },
  { value: '#10a37f', key: 'accentGreen' },
  { value: '#7c5cff', key: 'accentPurple' },
  { value: '#e5484d', key: 'accentRed' },
  { value: '#f5a623', key: 'accentOrange' },
  { value: '#0a84ff', key: 'accentBlue' },
]

export const setReasoningMode = (reasoningMode: ReasoningMode) => {
  write(KEYS.reasoningMode, reasoningMode)
  useSettings.setState({ reasoningMode })
}

export const setReasoningOnMode = (reasoningOnMode: ReasoningOnMode) => {
  write(KEYS.reasoningOnMode, reasoningOnMode)
  useSettings.setState({ reasoningOnMode })
}

/** 开启思考时的可选发送方式 */
export const REASONING_ON_MODES: { value: ReasoningOnMode; label: string }[] = [
  { value: 'auto', label: 'auto' },
  { value: 'effort-high', label: 'reasoning_effort: high' },
  { value: 'effort-medium', label: 'reasoning_effort: medium' },
  { value: 'thinking-enabled', label: 'thinking: {type: enabled}' },
  { value: 'output-config-high', label: 'output_config.effort: high' },
  { value: 'template-thinking', label: 'chat_template_kwargs: true' },
  { value: 'none', label: '不发送任何参数' },
]

/** 关闭思考时的发送方式，按网关支持度选择 */
export const REASONING_MODES: { value: ReasoningMode; label: string }[] = [
  { value: 'auto', label: 'auto' },
  { value: 'effort-off', label: 'reasoning_effort: off' },
  { value: 'effort-none', label: 'reasoning_effort: none' },
  { value: 'effort-low', label: 'reasoning_effort: low' },
  { value: 'thinking-disabled', label: 'thinking.type: disabled' },
  { value: 'template-thinking', label: 'chat_template_kwargs: thinking=false' },
  { value: 'none', label: '不发送任何参数' },
]

export const setTavilyOptions = (options: {
  maxResults?: number
  searchDepth?: 'basic' | 'advanced'
  includeAnswer?: boolean
}) => {
  const next: Partial<Settings> = {}
  if (options.maxResults !== undefined) {
    const value = Math.min(20, Math.max(1, Math.round(options.maxResults)))
    write(KEYS.tavilyMaxResults, String(value))
    next.tavilyMaxResults = value
  }
  if (options.searchDepth !== undefined) {
    write(KEYS.tavilySearchDepth, options.searchDepth)
    next.tavilySearchDepth = options.searchDepth
  }
  if (options.includeAnswer !== undefined) {
    write(KEYS.tavilyIncludeAnswer, String(options.includeAnswer))
    next.tavilyIncludeAnswer = options.includeAnswer
  }
  useSettings.setState(next)
}
