import './styles.css'
import { AccountManager } from './account-manager'

// 初始化账号管理器
const app = document.getElementById('app')
if (app) {
  const manager = new AccountManager(app)

  // 🚀 优化启动流程：先渲染骨架屏，再后台加载数据
  // 1. 立即渲染界面框架（无账号数据）
  manager.render()

  // 2. 异步加载账号数据
  manager.init().catch(error => {
    console.error('[启动] 初始化失败:', error)
  })
}

// 监听窗口移动事件，保存位置
if (window.__TAURI__) {
  const { getCurrentWindow } = window.__TAURI__.window
  const { invoke } = window.__TAURI__.core

  let saveTimeout: number | null = null

  // 监听窗口移动
  const currentWindow = getCurrentWindow()
  currentWindow.listen('tauri://move', async () => {
    // 防抖：延迟保存，避免频繁写入
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }

    saveTimeout = window.setTimeout(async () => {
      try {
        const position = await currentWindow.outerPosition()
        await invoke('save_window_position', { x: position.x, y: position.y })
        console.log('[窗口] 位置已保存:', position.x, position.y)
      } catch (error) {
        console.error('[窗口] 保存位置失败:', error)
      }
    }, 500)
  })
}
