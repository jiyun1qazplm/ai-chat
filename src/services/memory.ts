/**
 * 用户记忆：跨对话生效的一小段事实与偏好。
 *
 * 两类来源：
 * - 手动：用户自己写的条目，随时增删。
 * - 自动：模型从对话里提取后加进来的条目（需用户确认）。
 *
 * 发送请求时拼接进系统提示词，因此对 DeepSeek / OpenAI / Gemini / Claude 都生效。
 * 全部存在浏览器 localStorage，不上传任何服务器。
 */

import { create } from 'zustand'

/**
 * 记忆类型：
 * - fact：关于用户的事实（身份、职业、所在地、在做什么）
 * - preference：希望回答怎么给（长度、语气、格式、禁忌）
 */
export type MemoryKind = 'fact' | 'preference'

/** 单条记忆 */
export type MemoryItem = {
  id: string
  /** 记忆正文，一句话事实 */
  text: string
  /** 手动添加还是自动提取 */
  source: 'manual' | 'auto'
  /** 这条属于事实记忆还是回答偏好 */
  kind: MemoryKind
  /** 创建时间戳，用于排序与「多久之前」提示 */
  createdAt: number
}

type MemoryState = {
  items: MemoryItem[]
  /** 是否把记忆注入发送给模型的请求 */
  enabled: boolean
  /** 是否允许自动提取 */
  autoExtract: boolean
  /** 每多少轮对话自动提取一次，1-20 */
  autoExtractEvery: number
  /** 距离上次自动提取已经过去的轮数（用于计数触发） */
  turnsSinceExtract: number
}

/** 自动提取间隔限制在 1-20 轮，默认 10 */
const AUTO_EVERY_MIN = 1
const AUTO_EVERY_MAX = 20
const AUTO_EVERY_DEFAULT = 10

const initialAutoEvery = (): number => {
  const saved = read('chat-demo:memory-auto-every')
  if (saved === null || saved.trim() === '') {
    return AUTO_EVERY_DEFAULT
  }
  const value = Number(saved)
  return Number.isFinite(value) && value >= AUTO_EVERY_MIN && value <= AUTO_EVERY_MAX
    ? Math.round(value)
    : AUTO_EVERY_DEFAULT
}

const KEYS = {
  items: 'chat-demo:memory-items',
  enabled: 'chat-demo:memory-enabled',
  autoExtract: 'chat-demo:memory-auto',
  autoExtractEvery: 'chat-demo:memory-auto-every',
  turns: 'chat-demo:memory-turns',
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
    // 存储不可用时只在内存里生效
  }
}

/** 读取已保存的记忆；结构损坏的条目直接丢弃 */
const initialItems = (): MemoryItem[] => {
  try {
    const parsed: unknown = JSON.parse(read(KEYS.items) ?? '[]')
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.flatMap((item): MemoryItem[] => {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof (item as MemoryItem).text === 'string' &&
        typeof (item as MemoryItem).id === 'string'
      ) {
        const value = item as MemoryItem
        return [
          {
            id: value.id,
            text: value.text,
            source: value.source === 'auto' ? 'auto' : 'manual',
            // 旧数据没有 kind，按事实处理
            kind: value.kind === 'preference' ? 'preference' : 'fact',
            createdAt: typeof value.createdAt === 'number' ? value.createdAt : Date.now(),
          },
        ]
      }
      return []
    })
  } catch {
    return []
  }
}

export const useMemory = create<MemoryState>(() => ({
  items: initialItems(),
  enabled: read(KEYS.enabled) !== 'false',
  autoExtract: read(KEYS.autoExtract) === 'true',
  autoExtractEvery: initialAutoEvery(),
  turnsSinceExtract: Number(read(KEYS.turns)) || 0,
}))

const persist = (items: MemoryItem[]) => write(KEYS.items, JSON.stringify(items))

let counter = 0
/** 生成稳定的本地 id，无需额外依赖 */
const createMemoryId = () => `mem_${Date.now().toString(36)}_${(counter += 1).toString(36)}`

/** 新增一条记忆；空文本与重复内容会被忽略 */
export const addMemory = (
  text: string,
  source: MemoryItem['source'] = 'manual',
  kind: MemoryKind = 'fact'
): boolean => {
  const value = text.trim()
  if (!value) {
    return false
  }
  const exists = useMemory.getState().items.some((item) => item.text === value)
  if (exists) {
    return false
  }
  const items = [
    { id: createMemoryId(), text: value, source, kind, createdAt: Date.now() },
    ...useMemory.getState().items,
  ]
  persist(items)
  useMemory.setState({ items })
  return true
}

export const removeMemory = (id: string) => {
  const items = useMemory.getState().items.filter((item) => item.id !== id)
  persist(items)
  useMemory.setState({ items })
}

export const updateMemory = (id: string, text: string) => {
  const value = text.trim()
  if (!value) {
    return
  }
  const items = useMemory
    .getState()
    .items.map((item) => (item.id === id ? { ...item, text: value } : item))
  persist(items)
  useMemory.setState({ items })
}

export const clearMemories = () => {
  persist([])
  useMemory.setState({ items: [] })
}

export const setMemoryEnabled = (enabled: boolean) => {
  write(KEYS.enabled, String(enabled))
  useMemory.setState({ enabled })
}

export const setMemoryAutoExtract = (autoExtract: boolean) => {
  write(KEYS.autoExtract, String(autoExtract))
  useMemory.setState({ autoExtract })
}

export const setMemoryAutoEvery = (every: number) => {
  const value = Math.min(AUTO_EVERY_MAX, Math.max(AUTO_EVERY_MIN, Math.round(every)))
  write(KEYS.autoExtractEvery, String(value))
  useMemory.setState({ autoExtractEvery: value })
}

export const MEMORY_AUTO_RANGE = { min: AUTO_EVERY_MIN, max: AUTO_EVERY_MAX }

/**
 * 记一轮对话。返回 true 表示已达到间隔、该触发提取，并把计数归零。
 * 关闭自动提取时只累加不触发，用户重新开启后从当前计数继续。
 */
export const tickMemoryTurn = (): boolean => {
  const state = useMemory.getState()
  const next = state.turnsSinceExtract + 1
  const reached = state.enabled && state.autoExtract && next >= state.autoExtractEvery
  const value = reached ? 0 : next
  write(KEYS.turns, String(value))
  useMemory.setState({ turnsSinceExtract: value })
  return reached
}

/** 重置计数：手动提取或清空记忆后调用 */
export const resetMemoryTurns = () => {
  write(KEYS.turns, '0')
  useMemory.setState({ turnsSinceExtract: 0 })
}

/**
 * 把记忆拼成提示词片段。
 * 事实与回答偏好分开写：偏好是行为约束，模型要严格遵守；
 * 事实只作背景理解，不需要复述。
 * 关闭记忆或没有条目时返回空串，调用方据此跳过注入。
 */
export const memoryPrompt = (): string => {
  const { items, enabled } = useMemory.getState()
  if (!enabled || items.length === 0) {
    return ''
  }
  const facts = items.filter((item) => item.kind !== 'preference')
  const preferences = items.filter((item) => item.kind === 'preference')
  const sections: string[] = []
  if (preferences.length > 0) {
    sections.push(
      [
        '【回答偏好】以下是用户希望的回答方式，请在每次回答时遵守：',
        ...preferences.map((item) => `- ${item.text}`),
      ].join('\n')
    )
  }
  if (facts.length > 0) {
    sections.push(
      [
        '【用户背景】以下是用户的个人信息，仅用于理解上下文，不要在回答中逐条复述：',
        ...facts.map((item) => `- ${item.text}`),
      ].join('\n')
    )
  }
  return sections.join('\n\n')
}

/**
 * 用整理后的文本替换记忆列表。
 * 与原有条目完全一致的保留其来源与创建时间，新增的按自动条目处理。
 */
export const applyConsolidated = (entries: { text: string; kind: MemoryKind }[]) => {
  const previous = new Map(useMemory.getState().items.map((item) => [item.text, item]))
  const now = Date.now()
  const items: MemoryItem[] = entries.map(({ text, kind }) => {
    const matched = previous.get(text)
    // 已存在的条目保留来源与时间，但采用整理后的分类
    return matched
      ? { ...matched, kind }
      : { id: createMemoryId(), text, source: 'auto', kind, createdAt: now }
  })
  persist(items)
  useMemory.setState({ items })
}

/** 供整理前读取当前条目文本 */
export const memoryTexts = (): string[] => useMemory.getState().items.map((item) => item.text)
