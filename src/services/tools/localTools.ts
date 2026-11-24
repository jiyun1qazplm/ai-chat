/**
 * 本地工具：时间、计算器、询问用户、当前位置。
 *
 * 这些工具在浏览器里执行，不依赖任何外部服务；
 * 模型通过 OpenAI function calling 发起调用，由 agent 循环执行并把结果回传。
 */

import { useSettings } from '../settings.js'

/** 工具名 → 设置里的开关字段 */
const TOOL_SETTING_KEYS = {
  get_current_time: 'toolTime',
  calculator: 'toolCalculator',
  ask_user: 'toolAskUser',
  get_location: 'toolLocation',
} as const

/** 按用户开关过滤：只保留已启用的工具定义 */
export const getEnabledToolDefs = (): LocalToolDef[] => {
  const state = useSettings.getState()
  return LOCAL_TOOL_DEFS.filter((tool) => {
    const key = TOOL_SETTING_KEYS[tool.function.name as keyof typeof TOOL_SETTING_KEYS]
    return key ? state[key] : true
  })
}

/** OpenAI function calling 的工具声明 */
export type LocalToolDef = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const LOCAL_TOOL_DEFS: LocalToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_current_time',
      description:
        '读取当前设备的日期、星期、时间、时区、UTC 偏移和时间戳。用户问今天几号、现在几点、星期几时调用。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculator',
      description:
        '计算数学表达式。支持加减乘除、乘方 ^、取余 %、括号，以及 sqrt、sin、cos、tan、log、ln、abs 函数和常量 pi、e。三角函数按角度（度）计算。',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '要计算的表达式，例如 (3+5)*2 或 sqrt(16)' },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description:
        '向用户提出一个简短问题并等待回答。信息不足、需求不明确或需要在几个选项中做选择时调用。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '要问用户的问题，尽量简洁' },
          options: {
            type: 'array',
            items: { type: 'string' },
            description: '可选：给出几个候选项，用户也可以自己输入',
          },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_location',
      description:
        '读取本设备的一次性位置（经纬度）。用户询问本地天气、附近地点、当地信息时调用；需要用户授予定位权限。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
]

/** 需要界面交互的工具，由界面层注入实现 */
export type LocalToolHandlers = {
  /** 向用户提问并等待回答 */
  askUser: (question: string, options: string[]) => Promise<string>
}

const pad = (value: number) => String(value).padStart(2, '0')

/** 设备时间与时区，包含星期与时间戳 */
const describeTime = (): string => {
  const now = new Date()
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']
  // getTimezoneOffset 返回分钟数，东半球为负值
  const offsetMinutes = -now.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const hours = Math.floor(Math.abs(offsetMinutes) / 60)
  const minutes = Math.abs(offsetMinutes) % 60
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '未知'
  return [
    `日期：${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `星期：${weekdays[now.getDay()]}`,
    `时间：${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    `时区：${timezone}（UTC${sign}${pad(hours)}:${pad(minutes)}）`,
    `时间戳：${now.getTime()}（毫秒）`,
    `ISO：${now.toISOString()}`,
  ].join('\n')
}

/**
 * 数学表达式求值：递归下降解析，不使用 eval。
 * 支持 + - * / % ^、括号、一元正负号与常见函数。
 */
const evaluateExpression = (input: string): number => {
  const source = input.replace(/\s+/g, '').toLowerCase()
  let pos = 0

  const peek = () => source[pos]
  const eat = (char: string) => {
    if (source[pos] === char) {
      pos += 1
      return true
    }
    return false
  }

  const parseNumber = (): number => {
    const start = pos
    while (pos < source.length && /[0-9.]/.test(source[pos] ?? '')) {
      pos += 1
    }
    if (start === pos) {
      throw new Error(`无法识别的字符：「${peek() ?? '末尾'}」`)
    }
    const value = Number(source.slice(start, pos))
    if (!Number.isFinite(value)) {
      throw new Error('数字格式不正确')
    }
    return value
  }

  const parsePrimary = (): number => {
    if (eat('(')) {
      const value = parseExpression()
      if (!eat(')')) {
        throw new Error('括号没有闭合')
      }
      return value
    }
    if (eat('-')) {
      return -parsePrimary()
    }
    if (eat('+')) {
      return parsePrimary()
    }
    // 函数调用或常量
    const rest = source.slice(pos)
    for (const name of ['sqrt', 'sin', 'cos', 'tan', 'log', 'ln', 'abs']) {
      if (rest.startsWith(name)) {
        pos += name.length
        if (!eat('(')) {
          throw new Error(`${name} 后面需要括号`)
        }
        const argument = parseExpression()
        if (!eat(')')) {
          throw new Error('括号没有闭合')
        }
        switch (name) {
          case 'sqrt':
            return Math.sqrt(argument)
          case 'sin':
            return Math.sin((argument * Math.PI) / 180)
          case 'cos':
            return Math.cos((argument * Math.PI) / 180)
          case 'tan':
            return Math.tan((argument * Math.PI) / 180)
          case 'log':
            return Math.log10(argument)
          case 'ln':
            return Math.log(argument)
          default:
            return Math.abs(argument)
        }
      }
    }
    if (rest.startsWith('pi')) {
      pos += 2
      return Math.PI
    }
    if (rest.startsWith('e') && !/[0-9]/.test(rest[1] ?? '')) {
      pos += 1
      return Math.E
    }
    return parseNumber()
  }

  const parsePower = (): number => {
    const base = parsePrimary()
    // 乘方右结合：2^3^2 = 2^(3^2)
    if (eat('^')) {
      return base ** parsePower()
    }
    return base
  }

  const parseTerm = (): number => {
    let value = parsePower()
    for (;;) {
      if (eat('*')) {
        value *= parsePower()
      } else if (eat('/')) {
        const divisor = parsePower()
        if (divisor === 0) {
          throw new Error('除数为 0')
        }
        value /= divisor
      } else if (eat('%')) {
        const divisor = parsePower()
        if (divisor === 0) {
          throw new Error('除数为 0')
        }
        value %= divisor
      } else {
        return value
      }
    }
  }

  function parseExpression(): number {
    let value = parseTerm()
    for (;;) {
      if (eat('+')) {
        value += parseTerm()
      } else if (eat('-')) {
        value -= parseTerm()
      } else {
        return value
      }
    }
  }

  const result = parseExpression()
  if (pos !== source.length) {
    throw new Error(`表达式在「${source.slice(pos)}」处无法继续解析`)
  }
  if (!Number.isFinite(result)) {
    throw new Error('结果不是有限数值')
  }
  return result
}

/** 读取一次位置；用户拒绝或超时都返回可读的原因，交给模型解释 */
const readLocation = (signal: AbortSignal): Promise<string> =>
  new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve('当前环境不支持定位。')
      return
    }
    const onAbort = () => resolve('用户停止了生成，定位已取消。')
    signal.addEventListener('abort', onAbort, { once: true })
    navigator.geolocation.getCurrentPosition(
      (position) => {
        signal.removeEventListener('abort', onAbort)
        const { latitude, longitude, accuracy } = position.coords
        resolve(
          [
            `纬度：${latitude.toFixed(6)}`,
            `经度：${longitude.toFixed(6)}`,
            `精度：约 ${Math.round(accuracy)} 米`,
            '坐标系：WGS84（浏览器定位原始数据）',
          ].join('\n')
        )
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        const reason =
          error.code === error.PERMISSION_DENIED
            ? '用户拒绝了定位权限。'
            : error.code === error.POSITION_UNAVAILABLE
              ? '定位信息不可用。'
              : '定位超时。'
        resolve(reason)
      },
      { timeout: 15000, maximumAge: 60000, enableHighAccuracy: false }
    )
  })

/** 执行一个本地工具调用，返回要回传给模型的文本 */
export const runLocalTool = async (
  name: string,
  args: Record<string, unknown>,
  handlers: LocalToolHandlers,
  signal: AbortSignal
): Promise<string> => {
  switch (name) {
    case 'get_current_time':
      return describeTime()
    case 'calculator': {
      const expression = String(args.expression ?? '').trim()
      if (!expression) {
        return '没有提供表达式。'
      }
      try {
        const value = evaluateExpression(expression)
        // 浮点误差收敛到 10 位有效数字，避免出现 0.30000000000000004
        return `${expression} = ${Number.parseFloat(value.toPrecision(12))}`
      } catch (error) {
        return `计算出错：${error instanceof Error ? error.message : String(error)}`
      }
    }
    case 'ask_user': {
      const question = String(args.question ?? '').trim()
      if (!question) {
        return '没有提供要问用户的问题。'
      }
      const options = Array.isArray(args.options)
        ? args.options.map((item) => String(item)).filter(Boolean)
        : []
      const answer = await handlers.askUser(question, options)
      return answer.trim() ? `用户回答：${answer}` : '用户没有回答。'
    }
    case 'get_location':
      return readLocation(signal)
    default:
      return `不支持的工具：${name}`
  }
}

/** Gemini 的函数声明格式 */
export const toGeminiFunctionDeclarations = () =>
  getEnabledToolDefs().map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }))

/** Anthropic / Claude 的工具格式 */
export const toClaudeTools = () =>
  getEnabledToolDefs().map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }))
