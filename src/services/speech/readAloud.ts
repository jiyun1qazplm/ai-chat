import { create } from 'zustand'
import type { TranslationMessage } from '../../i18n/index.js'
import { ApiError } from '../api/client.js'
import { classifyApiError } from '../api/errors.js'
import { synthesize, TTS_SAMPLE_RATE } from '../api/speech.js'
import { synthesizeExternal, toAudioUrl, toPlainSpeech } from '../api/tts.js'
import { useSettings } from '../settings.js'

/**
 * 朗读：同一时间只读一条回复。
 * 请求 TTS 的裸 PCM 流，边收边用 AudioContext 按顺序排程播放，首帧到达即出声。
 * 状态：loading（已请求、未出声）→ playing → 结束回到 idle。
 */
export type ReadAloudStatus = 'idle' | 'loading' | 'playing'

type ReadAloudState = {
  /** 正在朗读的回复 id */
  messageId: string | null
  status: ReadAloudStatus
}

export const useReadAloud = create<ReadAloudState>(() => ({ messageId: null, status: 'idle' }))

/** 首帧前多缓冲一点，减少网络抖动造成的断续 */
const START_DELAY = 0.1

let current: {
  controller: AbortController
  context: AudioContext
  /** 外部 TTS 用 <audio> 播放，内置 TTS 为 null */
  audio: HTMLAudioElement | null
  /** 外部 TTS 生成的 object URL，停止时需要释放 */
  url: string | null
} | null = null

const finish = (controller: AbortController) => {
  if (current?.controller !== controller) {
    return
  }
  if (current.audio) {
    current.audio.pause()
    current.audio.src = ''
  }
  if (current.url) {
    URL.revokeObjectURL(current.url)
  }
  void current.context.close()
  current = null
  useReadAloud.setState({ messageId: null, status: 'idle' })
}

/** 停止当前朗读（发送、停止生成、切换会话等场景调用） */
export const stopReadAloud = () => {
  if (current) {
    const { controller } = current
    controller.abort()
    finish(controller)
  }
}

/** 16-bit 小端 PCM 转成 Float32；奇数字节留到下一段 */
const toFloat32 = (bytes: Uint8Array) => {
  const samples = new Float32Array(bytes.length >> 1)
  const view = new DataView(bytes.buffer, bytes.byteOffset, samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000
  }
  return samples
}

export const describeReadAloudError = (error: unknown): TranslationMessage | string => {
  if (error instanceof ApiError && error.kind === 'protocol') {
    return error.message
  }
  // 400 表示这段正文服务端无法合成，与其余失败区分开
  if (error instanceof ApiError && error.status === 400) {
    return { key: 'ttsUnavailable' }
  }
  switch (classifyApiError(error)) {
    case 'unauthorized':
      return { key: 'apiKeyInvalidRetry' }
    case 'insufficientBalance':
      return { key: 'insufficientBalance' }
    case 'rateLimited':
      return { key: 'rateLimited' }
    default:
      return { key: 'ttsFailed' }
  }
}

/**
 * 开始朗读一条回复的正文；同一条正在朗读时调用等于停止。
 * 必须在点击事件中同步调用：AudioContext 需要用户手势才能出声。
 */
export const toggleReadAloud = (
  messageId: string,
  text: string,
  onError: (error: unknown) => void
) => {
  const reading = useReadAloud.getState().messageId
  stopReadAloud()
  if (reading === messageId) {
    return
  }
  const controller = new AbortController()
  const context = new AudioContext({ sampleRate: TTS_SAMPLE_RATE })
  current = { controller, context, audio: null, url: null }
  useReadAloud.setState({ messageId, status: 'loading' })
  // 引擎与音色在开始朗读时读取，设置中切换后下一次朗读生效
  const settings = useSettings.getState()
  const { apiKey, ttsVoice } = settings

  // 外部 TTS：整段合成后用 <audio> 播放
  if (settings.ttsEngine === 'external') {
    void (async () => {
      try {
        const blob = await synthesizeExternal(
          {
            baseUrl: settings.ttsBaseUrl,
            apiKey: settings.ttsApiKey ?? '',
            model: settings.ttsModel,
            voice: settings.ttsExternalVoice,
            format: settings.ttsFormat,
            speed: settings.ttsSpeed,
          },
          toPlainSpeech(text),
          controller.signal
        )
        if (controller.signal.aborted) {
          return
        }
        const url = toAudioUrl(blob)
        const audio = new Audio()
        // 先克隆到 AudioContext 之外也无妨；这里用独立元素播放压缩音频
        audio.preload = 'auto'
        audio.src = url
        audio.crossOrigin = 'anonymous'
        if (current?.controller === controller) {
          current.audio = audio
          current.url = url
        }
        audio.onplay = () => useReadAloud.setState({ status: 'playing' })
        audio.onended = () => finish(controller)
        audio.onerror = () => {
          const code = audio.error?.code
          const reason =
            code === 1 ? '音轨被中止'
            : code === 2 ? '网络错误'
            : code === 3 ? '解码失败（格式可能不被支持）'
            : code === 4 ? '音频格式不支持或被阻止'
            : '未知原因'
          finish(controller)
          onError(new Error(`播放失败：${reason}`))
        }

        // 等元数据就绪再播放，避免 src 刚设置时 play() 拿到空数据
        await new Promise<void>((resolve, reject) => {
          if (audio.readyState >= 1) {
            resolve()
            return
          }
          const onReady = () => {
            audio.removeEventListener('loadedmetadata', onReady)
            resolve()
          }
          audio.addEventListener('loadedmetadata', onReady, { once: true })
          // 超时保护，避免设备不支持时一直挂着
          setTimeout(() => {
            audio.removeEventListener('loadedmetadata', onReady)
            if (audio.readyState < 1) {
              reject(new Error('音频加载超时，可能是格式不被支持'))
            } else {
              resolve()
            }
          }, 8000)
        })
        if (controller.signal.aborted) {
          return
        }
        await audio.play()
      } catch (error) {
        if (!controller.signal.aborted) {
          finish(controller)
          onError(error)
        }
      }
    })()
    return
  }

  void (async () => {
    let nextTime = 0
    let lastSource: AudioBufferSourceNode | null = null
    let rest = new Uint8Array(0)
    try {
      const stream = await synthesize(apiKey ?? '', text, ttsVoice, controller.signal)
      const reader = stream.getReader()
      controller.signal.addEventListener('abort', () => void reader.cancel().catch(() => {}))
      for (;;) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        const bytes = new Uint8Array(rest.length + value.length)
        bytes.set(rest)
        bytes.set(value, rest.length)
        const samples = toFloat32(bytes)
        rest = bytes.slice(samples.length * 2)
        if (samples.length === 0) {
          continue
        }
        const buffer = context.createBuffer(1, samples.length, TTS_SAMPLE_RATE)
        buffer.copyToChannel(samples, 0)
        const source = context.createBufferSource()
        source.buffer = buffer
        source.connect(context.destination)
        // 网络慢于播放时从当前时间续上，不补播过去的时间
        nextTime = Math.max(nextTime, context.currentTime + (lastSource ? 0 : START_DELAY))
        source.start(nextTime)
        nextTime += buffer.duration
        lastSource = source
        if (useReadAloud.getState().status === 'loading') {
          useReadAloud.setState({ status: 'playing' })
        }
      }
      if (lastSource) {
        lastSource.onended = () => finish(controller)
      } else {
        finish(controller)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        finish(controller)
        onError(error)
      }
    }
  })()
}
