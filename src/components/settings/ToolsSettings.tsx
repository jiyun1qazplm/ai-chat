import { useTranslate } from '../../i18n/index.js'
import { setToolEnabled, useSettings } from '../../services/settings.js'
import { Button } from '../base/Button.js'
import { SettingCell } from './SettingsDialog.js'
import styles from './Settings.module.css'

type ToolKey = 'toolTime' | 'toolCalculator' | 'toolAskUser' | 'toolLocation'

const TOOLS: { key: ToolKey; label: string; description: string }[] = [
  { key: 'toolTime', label: 'toolTimeName', description: 'toolTimeDesc' },
  { key: 'toolCalculator', label: 'toolCalculatorName', description: 'toolCalculatorDesc' },
  { key: 'toolAskUser', label: 'toolAskUserName', description: 'toolAskUserDesc' },
  { key: 'toolLocation', label: 'toolLocationName', description: 'toolLocationDesc' },
]

/** AI 工具：分别控制四个本地工具是否提供给模型 */
export const ToolsSettings = () => {
  const t = useTranslate()
  const state = useSettings()
  const enabledCount = TOOLS.filter((tool) => state[tool.key]).length
  return (
    <>
      <div className={styles.cell}>
        <div className={styles.label}>{t('toolsSectionTitle')}</div>
        <div className={styles.description}>
          {t('toolsSectionDesc', { count: enabledCount, total: TOOLS.length })}
        </div>
      </div>
      {TOOLS.map((tool) => (
        <SettingCell
          key={tool.key}
          label={t(tool.label as never)}
          description={t(tool.description as never)}
          status={null}
          action={
            <button
              type="button"
              role="switch"
              aria-checked={state[tool.key]}
              aria-label={t(tool.label as never)}
              className={`${styles.switch} ${state[tool.key] ? styles.switchOn : ''}`}
              onClick={() => setToolEnabled(tool.key, !state[tool.key])}
            >
              <span className={styles.switchKnob} />
            </button>
          }
        />
      ))}
      <div className={styles.cell}>
        <Button
          size="m"
          variant="outlined"
          onClick={() => {
            for (const tool of TOOLS) {
              setToolEnabled(tool.key, true)
            }
          }}
        >
          {t('toolsEnableAll')}
        </Button>
      </div>
    </>
  )
}
