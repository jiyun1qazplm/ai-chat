import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { answerQuestion, dismissQuestion, useAskUser } from './askUserState.js'
import styles from './AskUserDialog.module.css'

/**
 * 模型提问弹窗：展示问题与候选项，用户回答后把文本交回给正在进行的生成。
 * 弹窗是模态的，避免用户误以为回答已经发出。
 */
export const AskUserDialog = () => {
  const t = useTranslate()
  const question = useAskUser((state) => state.question)
  const options = useAskUser((state) => state.options)
  const [value, setValue] = useState('')

  // 每次换问题都清空上一次的输入
  useEffect(() => {
    setValue('')
  }, [question])

  if (question === null) {
    return null
  }

  const submit = () => answerQuestion(value)

  return (
    <Modal
      title={t('askUserTitle')}
      closable
      onClose={dismissQuestion}
      footer={
        <div className={styles.actions}>
          <Button variant="outlined" size="m" onClick={dismissQuestion}>
            {t('askUserSkip')}
          </Button>
          <Button size="m" onClick={submit}>
            {t('askUserSubmit')}
          </Button>
        </div>
      }
    >
      <div className={styles.question}>{question}</div>
      {options.length > 0 ? (
        <div className={styles.options}>
          {options.map((option) => (
            <button
              key={option}
              type="button"
              className={styles.option}
              onClick={() => answerQuestion(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        className={styles.input}
        rows={3}
        placeholder={t('askUserPlaceholder')}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
    </Modal>
  )
}
