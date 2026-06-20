// 单个账号导出对话框
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import type { Account } from '../types'
import { buildSingleAccountFilename, convertAccountToSimplifiedFormat } from '../utils/account-utils'

/**
 * 显示单个账号导出对话框
 */
export function showExportSingleAccountDialog(account: Account, index: number = 1): void {
  const modal = window.UI?.modal.open({
    title: '导出账号',
    html: `
      <div class="export-dialog">
        <div class="export-count">
          导出账号：${account.email}
        </div>

        <div class="export-option">
          <label class="export-checkbox">
            <input type="checkbox" id="include-credentials-single" checked>
            <span class="export-checkbox-label">
              <div class="export-option-title">包含凭证信息</div>
              <div class="export-option-desc">包含 Token 等敏感数据，可用于完整导入</div>
            </span>
          </label>
        </div>

        <div style="margin-top: 16px; padding: 12px; background: var(--slate-50); border: 1px solid var(--border-color); border-radius: 6px; font-size: 12px; color: var(--text-muted);">
          <div style="margin-bottom: 6px; font-weight: 500; color: var(--text-primary);">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            文件名格式
          </div>
          <div style="font-family: monospace; color: var(--text-secondary);">
            ${buildSingleAccountFilename(account.email, index)}
          </div>
        </div>
      </div>
    `,
    footer: `
      <button class="ui-btn ui-btn-secondary" onclick="window.closeExportSingleDialog()">取消</button>
      <button class="ui-btn ui-btn-primary" onclick="window.submitExportSingle()">导出</button>
    `,
    size: 'default',
    closable: true
  })

  ;(window as any).closeExportSingleDialog = () => {
    window.UI?.modal.close(modal)
    delete (window as any).closeExportSingleDialog
    delete (window as any).submitExportSingle
  }

  ;(window as any).submitExportSingle = async () => {
    try {
      const includeCredentials = (document.getElementById('include-credentials-single') as HTMLInputElement)?.checked ?? true

      // 生成简化格式的导出数据
      let exportData = convertAccountToSimplifiedFormat(account)

      // 如果不包含凭证，清空敏感字段
      if (!includeCredentials) {
        exportData = {
          ...exportData,
          clientId: '',
          clientSecret: '',
          refreshToken: ''
        }
      }

      const content = JSON.stringify(exportData, null, 2)
      console.log('[单账号导出] 生成内容成功，长度:', content.length)

      // 生成默认文件名
      const defaultFilename = buildSingleAccountFilename(account.email, index)
      console.log('[单账号导出] 默认文件名:', defaultFilename)

      // 使用 Tauri 的 save 对话框
      const filePath = await (window as any).__TAURI__.dialog.save({
        title: '导出账号数据',
        defaultPath: defaultFilename,
        filters: [{
          name: 'JSON',
          extensions: ['json']
        }]
      })

      console.log('[单账号导出] 选择的文件路径:', filePath)

      if (filePath) {
        // 写入文件
        console.log('[单账号导出] 开始写入文件...')
        await (window as any).__TAURI__.fs.writeTextFile(filePath, content)
        console.log('[单账号导出] 文件写入成功')

        window.UI?.toast.success(`账号已导出到: ${filePath}`)
        try {
          await revealItemInDir(filePath)
        } catch (openError) {
          console.warn('[单账号导出] 打开导出目录失败:', openError)
          window.UI?.toast.warning('文件已导出，但打开目录失败')
        }
        window.UI?.modal.close(modal)
        delete (window as any).closeExportSingleDialog
        delete (window as any).submitExportSingle
      } else {
        console.log('[单账号导出] 用户取消了文件选择')
      }
    } catch (error) {
      console.error('[单账号导出] 导出失败:', error)
      window.UI?.toast.error('导出失败: ' + (error as Error).message)
    }
  }
}
