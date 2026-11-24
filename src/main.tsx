import { createRoot } from 'react-dom/client'
import { App } from './app/App.js'
import { setupAppearance, setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

ensureKatex()
setupTheme()
setupAppearance()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)

// 注册 Service Worker，让浏览器识别为可安装应用；file:// 打开时不可用，忽略即可
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('sw.js').catch(() => {
      // 注册失败不影响正常使用
    })
  })
}
