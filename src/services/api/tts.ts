/**
 * 外部 TTS（OpenAI 兼容 /v1/audio/speech）客户端。
 *
 * 与内置 TTS 返回裸 PCM 不同，这里拿到的是 MP3 之类的压缩音频，
 * 由播放层用 <audio> 元素直接播放，不需要自己解码。
 */

import { ApiError, readErrorResponse, request } from './client.js'

export const DEFAULT_TTS_BASE_URL = 'https://api.openai.com/v1'

/** 常用的 OpenAI 兼容音色，可自由填写其他音色名 */
export const TTS_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
/** 可选输出格式 */
export const TTS_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav'] as const
export type TtsFormat = (typeof TTS_FORMATS)[number]

export type TtsConfig = {
  baseUrl: string
  apiKey: string
  model: string
  voice: string
  format: TtsFormat
  /** 语速倍率 0.25-4.0 */
  speed: number
}

/** 规范化地址：补 https、去掉末尾斜杠与动作路径 */
export const normalizeTtsBaseUrl = (input: string): string => {
  let url = input.trim().replace(/\/+$/, '')
  if (!url) {
    return ''
  }
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`
  }
  url = url.replace(/\/audio\/speech$/i, '')
  return url.replace(/\/+$/, '')
}

/**
 * 简单清理：去掉 Markdown 记号，避免把 ** 和代码块念出来。
 * 内置 TTS 由服务端过滤，外部服务需要自己处理。
 */
export const toPlainSpeech = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[#>\-*+]\s*/gm, '')
    .replace(/[*_~]{1,3}/g, '')
    .replace(/\n{2,}/g, '\n')
    .trim()

/** 可选：拉取音色列表；不支持该接口时返回空数组 */
export const fetchTtsVoices = async (
  baseUrl: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string[]> => {
  try {
    const response = await request(`${normalizeTtsBaseUrl(baseUrl)}/audio/voices`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    })
    const payload = (await response.json()) as { data?: { id?: string }[]; voices?: string[] }
    const list = payload.voices ?? (payload.data ?? []).map((item) => item.id ?? '')
    return list.filter(Boolean).sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/**
 * POST {base}/audio/speech，返回音频二进制。
 * 失败时尽量把服务端的错误文本带出来，便于定位。
 */
export const synthesizeExternal = async (
  config: TtsConfig,
  text: string,
  signal: AbortSignal
): Promise<Blob> => {
  const response = await request(`${normalizeTtsBaseUrl(config.baseUrl)}/audio/speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model || 'tts-1',
      input: text,
      voice: config.voice || 'alloy',
      response_format: config.format,
      speed: Math.min(4, Math.max(0.25, config.speed)),
    }),
    signal,
  })
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength === 0) {
    throw new ApiError('protocol', await response.text().catch(() => ''))
  }
  // 显式指定 MIME：有些服务端返回 application/octet-stream，浏览器会因此拒绝播放
  return new Blob([buffer], { type: MIME_OF_FORMAT[config.format] ?? 'audio/mpeg' })
}

/** 各输出格式对应的 MIME */
const MIME_OF_FORMAT: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
}

/** 校验配置：发一小段试音 */
export const verifyTts = async (config: TtsConfig): Promise<void> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    await synthesizeExternal(config, '你好', controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

/** 供播放层复用：把二进制包成可播放的 object URL */
export const toAudioUrl = (blob: Blob): string => URL.createObjectURL(blob)

export { readErrorResponse }

/** 诊断结果：把音频拿到后，直接在浏览器里试着解码 */
export type TtsProbeResult = {
  ok: boolean
  /** 服务端返回的 Content-Type */
  contentType: string
  /** 字节数 */
  bytes: number
  /** 浏览器能否成功解码这段音频 */
  decodable: boolean
  /** 失败原因 */
  error?: string
}

/**
 * 用一段短文本试音，并让浏览器尝试解码。
 * 能拿到数据却放不出声时，靠这个区分「格式不支持」还是「其他原因」。
 */
export const probeTts = async (config: TtsConfig, text = '你好'): Promise<TtsProbeResult> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const response = await request(`${normalizeTtsBaseUrl(config.baseUrl)}/audio/speech`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model || 'tts-1',
        input: text,
        voice: config.voice || 'alloy',
        response_format: config.format,
        speed: Math.min(4, Math.max(0.25, config.speed)),
      }),
      signal: controller.signal,
    })
    const contentType = response.headers.get('Content-Type') ?? ''
    const buffer = await response.arrayBuffer()

    // 用 decodeAudioData 试解码，这是最接近播放器的判断
    let decodable = false
    let error: string | undefined
    try {
      const ctx = new AudioContext()
      await ctx.decodeAudioData(buffer.slice(0))
      decodable = true
      void ctx.close()
    } catch (e) {
      error = `浏览器无法解码这段音频：${e instanceof Error ? e.message : String(e)}`
    }

    return { ok: true, contentType, bytes: buffer.byteLength, decodable, error }
  } catch (e) {
    return {
      ok: false,
      contentType: '',
      bytes: 0,
      decodable: false,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}
