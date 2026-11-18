import { useRef, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { probeReasoning } from '../../services/api/reasoning.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  REASONING_MODES,
  REASONING_ON_MODES,
  setReasoningMode,
  setReasoningOnMode,
  useSettings,
} from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { Select } from '../base/Select.js'
import styles from './ReasoningPanel.module.css'

type ProbeRow = {
  name: string
  status: number
  /** 是否回传了思维链内容 */
  reasoning: boolean
  /** 推理 token 数；-1 表示网关未返回 usage */
  tokens: number
  error?: string
}
type ProbeCandidate = { name: string; param: Record<string, unknown> }

/** 关闭思考时逐个测试各种写法。 */
const offCandidates: ProbeCandidate[] = [
  { name: 'thinking: disabled', param: { thinking: { type: 'disabled' } } },
  { name: 'reasoning_effort: none', param: { reasoning_effort: 'none' } },
  { name: 'reasoning_effort: low', param: { reasoning_effort: 'low' } },
  { name: 'enable_thinking: false', param: { enable_thinking: false } },
  { name: 'chat_template_kwargs', param: { chat_template_kwargs: { thinking: false } } },
  { name: 'thinking_budget: 0', param: { thinking_budget: 0 } },
  { name: '不发送任何参数', param: {} },
]

/** 开启思考时逐个测试常见写法。 */
const onCandidates: ProbeCandidate[] = [
  { name: 'reasoning_effort: high', param: { reasoning_effort: 'high' } },
  { name: 'thinking: enabled', param: { thinking: { type: 'enabled' } } },
  { name: 'output_config: high', param: { output_config: { effort: 'high' } } },
  { name: 'chat_template_kwargs', param: { chat_template_kwargs: { thinking: true } } },
  { name: '不发送任何参数', param: {} },
]

/**
 * 聊天框上方的「思考参数」面板：默认收起成一行，展开后可选择发送方式并实测。
 * 兼容模式才显示；官方接口固定使用自己的思考开关。
 */
export const ReasoningPanel = ({ sessionId }: { sessionId: string | null }) => {
  const t = useTranslate()
  const provider = useSettings((state) => state.provider)
  const mode = useSettings((state) => state.reasoningMode)
  const thinking = useSettings((state) => state.thinking)
  const onMode = useSettings((state) => state.reasoningOnMode)
  const defaultModel = useSettings((state) => state.openaiModel)
  const baseUrl = useSettings((state) => state.openaiBaseUrl)
  const apiKey = useSettings((state) => state.openaiApiKey)
  const sessionModel = useChatStore((state) =>
    sessionId ? (state.sessionCache[sessionId]?.model ?? null) : null
  )
  const model = sessionModel || defaultModel
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<ProbeRow[]>([])
  /** 正在进行的测试；用户点停止时中止，后续候选不再发起 */
  const probeRef = useRef<AbortController | null>(null)
  // 面板内容跟随「深度思考」开关：关闭时测关闭参数，开启时测开启参数
  const candidates = thinking ? onCandidates : offCandidates
  const panelTitle = thinking ? t('reasoningPanelOnTitle') : t('reasoningPanelOffTitle')
  const modeLabel = thinking ? t('reasoningOnModeLabel') : t('reasoningModeLabel')
  const probeButton = thinking ? t('reasoningProbeOnRun') : t('reasoningProbeRun')

  if (provider !== 'openai') {
    return null
  }

  const run = async () => {
    if (busy || !baseUrl.trim() || !apiKey?.trim()) {
      return
    }
    const controller = new AbortController()
    probeRef.current = controller
    setBusy(true)
    setResults([])
    const rows: ProbeRow[] = []
    try {
      for (const item of candidates) {
        // 已点停止就不再发起下一个候选
        if (controller.signal.aborted) {
          break
        }
        const result = await probeReasoning({
          baseUrl,
          apiKey,
          model,
          param: item.param,
          signal: controller.signal,
        })
        if (controller.signal.aborted) {
          break
        }
        rows.push({
          name: item.name,
          status: result.status,
          reasoning: result.producedReasoning,
          tokens: result.reasoningTokens,
          error: result.error,
        })
        setResults([...rows])
      }
    } finally {
      probeRef.current = null
      setBusy(false)
    }
  }

  /** 中途停止：中止当前请求，保留已完成的测试结果 */
  const stop = () => {
    probeRef.current?.abort()
    probeRef.current = null
    setBusy(false)
  }

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.header}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span className={styles.title}>{panelTitle}</span>
        {!expanded ? <span className={styles.summary}>{model}</span> : null}
        <span className={styles.chevron} aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded ? (
        <div className={styles.body}>
          {/* 关闭与开启各自一套手动参数，互不影响 */}
          <div className={styles.row}>
            <span className={styles.rowLabel}>{modeLabel}</span>
            {thinking ? (
              <Select
                ariaLabel={modeLabel}
                value={onMode}
                options={REASONING_ON_MODES.map((item) => ({
                  value: item.value,
                  label: item.value === 'auto' ? t('reasoningAuto') : item.label,
                }))}
                onChange={setReasoningOnMode}
              />
            ) : (
              <Select
                ariaLabel={modeLabel}
                value={mode}
                options={REASONING_MODES.map((item) => ({
                  value: item.value,
                  label: item.value === 'auto' ? t('reasoningAuto') : item.label,
                }))}
                onChange={setReasoningMode}
              />
            )}
          </div>
          <div className={styles.hint}>
            {thinking
              ? onMode === 'auto'
                ? t('reasoningOnAutoDetected', { model })
                : t('reasoningOnDescription', { model })
              : mode === 'auto'
                ? t('reasoningAutoDetected', { model })
                : t('reasoningValuesDescription')}
          </div>
          <Button
            block
            variant={busy ? 'outlined' : 'primary'}
            onClick={() => (busy ? stop() : void run())}
          >
            {busy ? t('reasoningProbeStop') : probeButton}
          </Button>
          {results.length > 0 ? (
            <div className={styles.results}>
              {results.map((row) => (
                <div key={row.name} className={styles.resultRow}>
                  <span className={styles.resultName}>{row.name}</span>
                  <span className={row.error ? styles.bad : styles.good}>
                    {row.error
                      ? `错误 ${row.status}: ${row.error.slice(0, 50)}`
                      : t('reasoningProbeVerdict', {
                          tokens: row.tokens >= 0 ? row.tokens : '-',
                          hint: row.reasoning
                            ? t('reasoningProbeShown')
                            : t('reasoningProbeHidden'),
                        })}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
