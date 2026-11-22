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
export type ApiProvider = 'deepseek' | 'openai' | 'gemini' | 'claude'

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
  /** Gemini 原生接口地址；留空用官方地址 */
  geminiBaseUrl: string
  geminiApiKey: string | null
  geminiModel: string
  /** Claude 原生接口地址；留空用官方地址 */
  claudeBaseUrl: string
  claudeApiKey: string | null
  claudeModel: string
  /** 各平台拉取到的模型列表 */
  geminiModels: string[]
  claudeModels: string[]
  /**
   * 朗读引擎：builtin 用内置 TTS（跟随 DeepSeek Key），
   * external 用自己配置的 OpenAI 兼容 TTS，与 AI 服务商无关。
   */
  ttsEngine: 'builtin' | 'external'
  ttsBaseUrl: string
  ttsApiKey: string | null
  ttsModel: string
  ttsExternalVoice: string
  ttsFormat: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav'
  ttsSpeed: number
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
  /** 修改强调色时是否让聊天气泡也跟随强调色 */
  accentAffectsBubble: boolean
  /** 回车键行为：true 直接发送、Shift+Enter 换行；false 换行、改用发送按钮发送 */
  enterToSend: boolean
  /** 正文字号倍数，1 为默认 */
  fontScale: number
  /** 消息列表的疏密：紧凑 / 标准 / 宽松 */
  density: 'compact' | 'normal' | 'comfortable'
  /** 顶部是否用渐变模糊让滚到标题栏下的消息自然淡出 */
  topBlur: boolean
  /** 顶部模糊强度（像素） */
  topBlurStrength: number
  /** 顶部模糊覆盖的高度，以视口高度的百分比表示（4-60） */
  topBlurHeight: number
  /** 聊天区背景图：本地图片的 data URL 或外部链接；null 表示不使用 */
  chatBackground: string | null
  /** 背景图上方遮罩的浓度 0-100，越大文字越清晰 */
  chatBackgroundDim: number
  /**
   * 背景图的取景：把原图按 viewBox 的百分比区域裁切后铺满聊天区。
   * null 表示整张图铺满（cover）。裁剪界面确认后写入。
   */
  chatBackgroundCrop: { x: number; y: number; width: number; height: number } | null
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
  geminiBaseUrl: 'chat-demo:gemini-base-url',
  geminiApiKey: 'chat-demo:gemini-api-key',
  geminiModel: 'chat-demo:gemini-model',
  claudeBaseUrl: 'chat-demo:claude-base-url',
  claudeApiKey: 'chat-demo:claude-api-key',
  claudeModel: 'chat-demo:claude-model',
  geminiModels: 'chat-demo:gemini-models',
  claudeModels: 'chat-demo:claude-models',
  ttsEngine: 'chat-demo:tts-engine',
  ttsBaseUrl: 'chat-demo:tts-base-url',
  ttsApiKey: 'chat-demo:tts-api-key',
  ttsModel: 'chat-demo:tts-model',
  ttsExternalVoice: 'chat-demo:tts-voice-external',
  ttsFormat: 'chat-demo:tts-format',
  ttsSpeed: 'chat-demo:tts-speed',
  tavilyApiKey: 'chat-demo:tavily-api-key',
  tavilyMaxResults: 'chat-demo:tavily-max-results',
  tavilySearchDepth: 'chat-demo:tavily-search-depth',
  tavilyIncludeAnswer: 'chat-demo:tavily-include-answer',
  openaiModels: 'chat-demo:openai-models',
  reasoningMode: 'chat-demo:reasoning-mode',
  reasoningOnMode: 'chat-demo:reasoning-on-mode',
  locale: 'chat-demo:locale',
  accentColor: 'chat-demo:accent-color',
  // 键名带 v2：旧版本保存过的开启状态不再生效，升级后统一回到默认关闭
  accentAffectsBubble: 'chat-demo:accent-affects-bubble-v2',
  enterToSend: 'chat-demo:enter-to-send',
  fontScale: 'chat-demo:font-scale',
  density: 'chat-demo:density',
  topBlur: 'chat-demo:top-blur',
  topBlurStrength: 'chat-demo:top-blur-strength',
  topBlurHeight: 'chat-demo:top-blur-height',
  chatBackground: 'chat-demo:chat-background',
  chatBackgroundDim: 'chat-demo:chat-background-dim',
  chatBackgroundCrop: 'chat-demo:chat-background-crop',
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
const initialProvider = (): ApiProvider => {
  const saved = read(KEYS.provider)
  return saved === 'openai' || saved === 'gemini' || saved === 'claude' ? saved : 'deepseek'
}

const initialOpenAIModel = (): string => read(KEYS.openaiModel)?.trim() || DEFAULT_OPENAI_MODEL

/** 搜索结果条数限制在 1-20，Tavily 上限为 20 */
const initialTavilyMaxResults = (): number => {
  const value = Number(read(KEYS.tavilyMaxResults))
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : 5
}

const initialTtsFormat = (): Settings['ttsFormat'] => {
  const saved = read(KEYS.ttsFormat)
  return saved === 'opus' || saved === 'aac' || saved === 'flac' || saved === 'wav' ? saved : 'mp3'
}

/** 读取已保存的裁剪区域；损坏时按未裁剪处理 */
const initialBackgroundCrop = (): Settings['chatBackgroundCrop'] => {
  try {
    const parsed = JSON.parse(read(KEYS.chatBackgroundCrop) ?? 'null') as unknown
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      ['x', 'y', 'width', 'height'].every(
        (k) => typeof (parsed as Record<string, unknown>)[k] === 'number'
      )
    ) {
      return parsed as Settings['chatBackgroundCrop']
    }
  } catch {
    // 忽略损坏的数据
  }
  return null
}

/** 顶部模糊强度限制在 4-30px，默认 14 */
const initialTopBlurStrength = (): number => {
  const saved = read(KEYS.topBlurStrength)
  if (saved === null || saved.trim() === '') {
    return 14
  }
  const value = Number(saved)
  return Number.isFinite(value) && value >= 4 && value <= 30 ? value : 14
}

/** 顶部模糊高度，范围 4-60（视口百分比），默认 24 */
const initialTopBlurHeight = (): number => {
  const saved = read(KEYS.topBlurHeight)
  if (saved === null || saved.trim() === '') {
    return 24
  }
  const value = Number(saved)
  return Number.isFinite(value) && value >= 4 && value <= 60 ? value : 24
}

/** 背景遮罩浓度限制在 0-90，默认 40 */
const initialBackgroundDim = (): number => {
  const saved = read(KEYS.chatBackgroundDim)
  // 没保存过时直接给默认值；否则 Number(null) 会得到 0，被误当成合法值
  if (saved === null || saved.trim() === '') {
    return 40
  }
  const value = Number(saved)
  return Number.isFinite(value) && value >= 0 && value <= 90 ? value : 40
}

/** 语速限制在 0.25-4，非法值回到 1 */
const initialTtsSpeed = (): number => {
  const value = Number(read(KEYS.ttsSpeed))
  return Number.isFinite(value) && value >= 0.25 && value <= 4 ? value : 1
}

/** 读取已缓存的模型列表；损坏或不是数组时按空处理 */
const initialModelList = (key: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(read(key) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
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
  geminiBaseUrl: read(KEYS.geminiBaseUrl) ?? '',
  geminiApiKey: read(KEYS.geminiApiKey),
  geminiModel: read(KEYS.geminiModel)?.trim() || 'gemini-2.5-flash',
  claudeBaseUrl: read(KEYS.claudeBaseUrl) ?? '',
  claudeApiKey: read(KEYS.claudeApiKey),
  claudeModel: read(KEYS.claudeModel)?.trim() || 'claude-sonnet-4-20250514',
  geminiModels: initialModelList(KEYS.geminiModels),
  claudeModels: initialModelList(KEYS.claudeModels),
  ttsEngine: read(KEYS.ttsEngine) === 'external' ? 'external' : 'builtin',
  ttsBaseUrl: read(KEYS.ttsBaseUrl) ?? '',
  ttsApiKey: read(KEYS.ttsApiKey),
  ttsModel: read(KEYS.ttsModel)?.trim() || 'tts-1',
  ttsExternalVoice: read(KEYS.ttsExternalVoice)?.trim() || 'alloy',
  ttsFormat: initialTtsFormat(),
  ttsSpeed: initialTtsSpeed(),
  tavilyApiKey: read(KEYS.tavilyApiKey),
  tavilyMaxResults: initialTavilyMaxResults(),
  tavilySearchDepth: read(KEYS.tavilySearchDepth) === 'advanced' ? 'advanced' : 'basic',
  tavilyIncludeAnswer: read(KEYS.tavilyIncludeAnswer) === 'true',
  openaiModels: initialOpenAIModels(),
  reasoningMode: initialReasoningMode(),
  reasoningOnMode: initialReasoningOnMode(),
  locale: initialLocale(),
  accentColor: read(KEYS.accentColor),
  // 默认关闭：气泡保持主题原配色，只有开启后才跟随强调色
  accentAffectsBubble: read(KEYS.accentAffectsBubble) === 'true',
  // 仅在明确保存过「回车换行」时关闭，默认保持回车发送
  enterToSend: read(KEYS.enterToSend) !== 'false',
  fontScale: initialFontScale(),
  density: initialDensity(),
  topBlur: read(KEYS.topBlur) !== 'false',
  topBlurStrength: initialTopBlurStrength(),
  topBlurHeight: initialTopBlurHeight(),
  chatBackground: read(KEYS.chatBackground),
  chatBackgroundDim: initialBackgroundDim(),
  chatBackgroundCrop: initialBackgroundCrop(),
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
  geminiApiKey,
  claudeApiKey,
}: Pick<
  Settings,
  'provider' | 'apiKey' | 'openaiBaseUrl' | 'openaiApiKey' | 'geminiApiKey' | 'claudeApiKey'
>): boolean => {
  switch (provider) {
    case 'openai':
      return Boolean(openaiBaseUrl.trim() && openaiApiKey?.trim())
    case 'gemini':
      // Gemini 与 Claude 有官方地址，填了 Key 即可
      return Boolean(geminiApiKey?.trim())
    case 'claude':
      return Boolean(claudeApiKey?.trim())
    default:
      return Boolean(apiKey)
  }
}

export const setAccentColor = (accentColor: string | null) => {
  write(KEYS.accentColor, accentColor)
  useSettings.setState({ accentColor })
}

export const setAccentAffectsBubble = (accentAffectsBubble: boolean) => {
  write(KEYS.accentAffectsBubble, String(accentAffectsBubble))
  useSettings.setState({ accentAffectsBubble })
}

export const setEnterToSend = (enterToSend: boolean) => {
  write(KEYS.enterToSend, String(enterToSend))
  useSettings.setState({ enterToSend })
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

export const setGeminiSettings = (patch: {
  baseUrl?: string
  apiKey?: string | null
  model?: string
}) => {
  const next: Partial<Settings> = {}
  if (patch.baseUrl !== undefined) {
    write(KEYS.geminiBaseUrl, patch.baseUrl)
    next.geminiBaseUrl = patch.baseUrl
  }
  if (patch.apiKey !== undefined) {
    write(KEYS.geminiApiKey, patch.apiKey)
    next.geminiApiKey = patch.apiKey
  }
  if (patch.model !== undefined) {
    write(KEYS.geminiModel, patch.model)
    next.geminiModel = patch.model
  }
  useSettings.setState(next)
}

export const setClaudeSettings = (patch: {
  baseUrl?: string
  apiKey?: string | null
  model?: string
}) => {
  const next: Partial<Settings> = {}
  if (patch.baseUrl !== undefined) {
    write(KEYS.claudeBaseUrl, patch.baseUrl)
    next.claudeBaseUrl = patch.baseUrl
  }
  if (patch.apiKey !== undefined) {
    write(KEYS.claudeApiKey, patch.apiKey)
    next.claudeApiKey = patch.apiKey
  }
  if (patch.model !== undefined) {
    write(KEYS.claudeModel, patch.model)
    next.claudeModel = patch.model
  }
  useSettings.setState(next)
}

export const setGeminiModels = (geminiModels: string[]) => {
  write(KEYS.geminiModels, JSON.stringify(geminiModels))
  useSettings.setState({ geminiModels })
}

export const setClaudeModels = (claudeModels: string[]) => {
  write(KEYS.claudeModels, JSON.stringify(claudeModels))
  useSettings.setState({ claudeModels })
}

export const setTtsSettings = (patch: {
  engine?: 'builtin' | 'external'
  baseUrl?: string
  apiKey?: string | null
  model?: string
  voice?: string
  format?: Settings['ttsFormat']
  speed?: number
}) => {
  const next: Partial<Settings> = {}
  if (patch.engine !== undefined) {
    write(KEYS.ttsEngine, patch.engine)
    next.ttsEngine = patch.engine
  }
  if (patch.baseUrl !== undefined) {
    write(KEYS.ttsBaseUrl, patch.baseUrl)
    next.ttsBaseUrl = patch.baseUrl
  }
  if (patch.apiKey !== undefined) {
    write(KEYS.ttsApiKey, patch.apiKey)
    next.ttsApiKey = patch.apiKey
  }
  if (patch.model !== undefined) {
    write(KEYS.ttsModel, patch.model)
    next.ttsModel = patch.model
  }
  if (patch.voice !== undefined) {
    write(KEYS.ttsExternalVoice, patch.voice)
    next.ttsExternalVoice = patch.voice
  }
  if (patch.format !== undefined) {
    write(KEYS.ttsFormat, patch.format)
    next.ttsFormat = patch.format
  }
  if (patch.speed !== undefined) {
    const speed = Math.min(4, Math.max(0.25, patch.speed))
    write(KEYS.ttsSpeed, String(speed))
    next.ttsSpeed = speed
  }
  useSettings.setState(next)
}

export const setChatBackground = (chatBackground: string | null) => {
  write(KEYS.chatBackground, chatBackground)
  // 换图时旧取景不再适用
  write(KEYS.chatBackgroundCrop, null)
  useSettings.setState({ chatBackground, chatBackgroundCrop: null })
}

export const setChatBackgroundCrop = (chatBackgroundCrop: Settings['chatBackgroundCrop']) => {
  write(KEYS.chatBackgroundCrop, chatBackgroundCrop ? JSON.stringify(chatBackgroundCrop) : null)
  useSettings.setState({ chatBackgroundCrop })
}

export const setChatBackgroundDim = (dim: number) => {
  const value = Math.min(90, Math.max(0, Math.round(dim)))
  write(KEYS.chatBackgroundDim, String(value))
  useSettings.setState({ chatBackgroundDim: value })
}

export const setTopBlur = (topBlur: boolean) => {
  write(KEYS.topBlur, String(topBlur))
  useSettings.setState({ topBlur })
}

export const setTopBlurStrength = (strength: number) => {
  const value = Math.min(30, Math.max(4, Math.round(strength)))
  write(KEYS.topBlurStrength, String(value))
  useSettings.setState({ topBlurStrength: value })
}

export const setTopBlurHeight = (height: number) => {
  const value = Math.min(60, Math.max(4, Math.round(height)))
  write(KEYS.topBlurHeight, String(value))
  useSettings.setState({ topBlurHeight: value })
}
