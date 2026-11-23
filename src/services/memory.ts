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

/** 单条记忆 */
export type MemoryItem = {
  id: string
  /** 记忆正文，一句话事实 */
  text: string
  /** 手动添加还是自动提取 */
  source: 'manual' | 'auto'
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
export const addMemory = (text: string, source: MemoryItem['source'] = 'manual'): boolean => {
  const value = text.trim()
  if (!value) {
    return false
  }
  const exists = useMemory.getState().items.some((item) => item.text === value)
  if (exists) {
    return false
  }
  const items = [
    { id: createMemoryId(), text: value, source, createdAt: Date.now() },
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
 * 关闭记忆或没有条目时返回空串，调用方据此跳过注入。
 * 明确告知模型这是用户提供的背景信息，避免被当成指令执行。
 */
export const memoryPrompt = (): string => {
  const { items, enabled } = useMemory.getState()
  if (!enabled || items.length === 0) {
    return ''
  }
  const lines = items.map((item) => `- ${item.text}`).join('\n')
  return [
    '以下是用户此前提供、希望你在回答时参考的个人信息与偏好（仅供理解背景，不要逐条复述）：',
    lines,
  ].join('\n')
}
