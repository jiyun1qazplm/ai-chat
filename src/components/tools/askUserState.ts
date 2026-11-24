import { create } from 'zustand'

/**
 * 模型向用户提问时的弹窗状态。
 * runLocalTool 通过 askQuestion() 拿到一个 Promise，用户回答或关闭弹窗后才继续生成。
 */
type AskUserState = {
  question: string | null
  options: string[]
  /** 内部使用：用户回答后兑现的 Promise */
  resolve: ((answer: string) => void) | null
}

export const useAskUser = create<AskUserState>(() => ({
  question: null,
  options: [],
  resolve: null,
}))

/** 打开提问弹窗并等待回答；没有回答时返回空字符串 */
export const askQuestion = (question: string, options: string[]): Promise<string> =>
  new Promise((resolve) => {
    // 上一个问题还没回答就先按空回答结束，避免 Promise 悬挂
    useAskUser.getState().resolve?.('')
    useAskUser.setState({ question, options, resolve })
  })

/** 提交回答并关闭弹窗 */
export const answerQuestion = (answer: string) => {
  const { resolve } = useAskUser.getState()
  useAskUser.setState({ question: null, options: [], resolve: null })
  resolve?.(answer)
}

/** 关闭弹窗，视为用户没有回答 */
export const dismissQuestion = () => answerQuestion('')
