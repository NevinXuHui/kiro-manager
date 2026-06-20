// 导出对话框
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import type { Account } from '../types'
import { buildExportFilename, buildSingleAccountFilename, convertAccountToSimplifiedFormat, generateExportContent } from '../utils/account-utils'
import { accountStore } from '../store'

/**
 * 显示导出对话框
 */
export function showExportDialog(accounts: Account[], selectedCount: number): void {
  let selectedFormat: 'json' | 'txt' | 'csv' | 'clipboard' = 'json'
  let includeCredentials = true
  let exportAsMultipleFiles = true // 默认导出为多个文件
  let markAsSold = false // 是否标记为已卖出

  const updatePreview = () => {
    const formatDesc = document.getElementById('format-desc')
    const credentialsOption = document.getElementById('credentials-option')
    const multipleFilesOption = document.getElementById('multiple-files-option')
    const markAsSoldOption = document.getElementById('mark-as-sold-option')

    const descriptions = {
      json: exportAsMultipleFiles ? '每个账号导出为独立 JSON 文件' : '完整数据，可用于导入',
      txt: includeCredentials ? '可导入格式：邮箱,Token,昵称,登录方式' : '纯文本格式，每行一个账号',
      csv: includeCredentials ? '可导入格式，Excel 兼容' : 'Excel 兼容格式',
      clipboard: includeCredentials ? '可导入格式：邮箱,Token' : '复制到剪贴板'
    }

    if (formatDesc) formatDesc.textContent = descriptions[selectedFormat]
    if (credentialsOption) {
      credentialsOption.style.display = selectedFormat === 'json' ? 'flex' : 'none'
    }
    if (multipleFilesOption) {
      multipleFilesOption.style.display = selectedFormat === 'json' ? 'flex' : 'none'
    }
    if (markAsSoldOption) {
      markAsSoldOption.style.display = selectedFormat === 'json' ? 'flex' : 'none'
    }
  }

  const modal = window.UI?.modal.open({
    title: '导出账号',
    html: `
      <div class="export-dialog">
        <div class="export-count">
          ${selectedCount > 0 ? `${selectedCount} 个选中` : `全部 ${accounts.length} 个`}
        </div>

        <div class="export-formats">
          <button class="export-format-btn active" data-format="json">
            <div class="export-format-name">JSON</div>
            <div class="export-format-desc" id="format-desc">完整数据，可用于导入</div>
          </button>
          <button class="export-format-btn" data-format="txt">
            <div class="export-format-name">TXT</div>
            <div class="export-format-desc">可导入格式</div>
          </button>
          <button class="export-format-btn" data-format="csv">
            <div class="export-format-name">CSV</div>
            <div class="export-format-desc">Excel 兼容</div>
          </button>
          <button class="export-format-btn" data-format="clipboard">
            <div class="export-format-name">剪贴板</div>
            <div class="export-format-desc">复制到剪贴板</div>
          </button>
        </div>

        <div class="export-option" id="credentials-option">
          <label class="export-checkbox">
            <input type="checkbox" id="include-credentials" checked>
            <span class="export-checkbox-label">
              <div class="export-option-title">包含凭证信息</div>
              <div class="export-option-desc">包含 Token 等敏感数据，可用于完整导入</div>
            </span>
          </label>
        </div>

        <div class="export-option" id="multiple-files-option">
          <label class="export-checkbox">
            <input type="checkbox" id="export-multiple-files" checked>
            <span class="export-checkbox-label">
              <div class="export-option-title">每个账号导出为独立文件</div>
              <div class="export-option-desc">文件名格式：日期_时间_序号_邮箱.json</div>
            </span>
          </label>
        </div>

        <div class="export-option" id="mark-as-sold-option">
          <label class="export-checkbox">
            <input type="checkbox" id="mark-as-sold">
            <span class="export-checkbox-label">
              <div class="export-option-title">导出后标记为已卖出</div>
              <div class="export-option-desc">导出成功后，将账号添加"已卖出"标签</div>
            </span>
          </label>
        </div>
      </div>
    `,
    footer: `
      <button class="ui-btn ui-btn-secondary" onclick="window.closeExportDialog()">取消</button>
      <button class="ui-btn ui-btn-primary" onclick="window.submitExport()">
        <span id="export-btn-text">导出</span>
      </button>
    `,
    size: 'default',
    closable: true
  })

  // 格式选择
  const formatBtns = document.querySelectorAll('.export-format-btn')
  formatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      formatBtns.forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      selectedFormat = (btn as HTMLElement).dataset.format as any
      updatePreview()

      const btnText = document.getElementById('export-btn-text')
      if (btnText) {
        btnText.textContent = selectedFormat === 'clipboard' ? '复制到剪贴板' : '导出'
      }
    })
  })

  // 凭证选项
  const credentialsCheckbox = document.getElementById('include-credentials') as HTMLInputElement
  if (credentialsCheckbox) {
    credentialsCheckbox.addEventListener('change', () => {
      includeCredentials = credentialsCheckbox.checked
      updatePreview()
    })
  }

  // 多文件导出选项
  const multipleFilesCheckbox = document.getElementById('export-multiple-files') as HTMLInputElement
  if (multipleFilesCheckbox) {
    multipleFilesCheckbox.addEventListener('change', () => {
      exportAsMultipleFiles = multipleFilesCheckbox.checked
      updatePreview()
    })
  }

  // 标记为已卖出选项
  const markAsSoldCheckbox = document.getElementById('mark-as-sold') as HTMLInputElement
  if (markAsSoldCheckbox) {
    markAsSoldCheckbox.addEventListener('change', () => {
      markAsSold = markAsSoldCheckbox.checked
    })
  }

  window.closeExportDialog = () => {
    window.UI?.modal.close(modal)
    delete window.closeExportDialog
    delete window.submitExport
  }

  window.submitExport = async () => {
    try {
      if (selectedFormat === 'clipboard') {
        const content = generateExportContent(accounts, selectedFormat, includeCredentials)
        await navigator.clipboard.writeText(content)
        window.UI?.toast.success('已复制到剪贴板')
        window.UI?.modal.close(modal)
        delete window.closeExportDialog
        delete window.submitExport
        return
      }

      // 如果是 JSON 格式且选择了多文件导出
      if (selectedFormat === 'json' && exportAsMultipleFiles) {
        console.log('[批量导出] 开始批量导出为多个文件...')

        // 让用户选择导出目录
        const dirPath = await (window as any).__TAURI__.dialog.open({
          title: '选择导出目录',
          directory: true,
          multiple: false
        })

        console.log('[批量导出] 选择的目录:', dirPath)

        if (!dirPath) {
          console.log('[批量导出] 用户取消了目录选择')
          return
        }

        // 批量导出每个账号为独立文件
        const exportDate = new Date()
        let successCount = 0
        let errorCount = 0

        for (let i = 0; i < accounts.length; i++) {
          try {
            const account = accounts[i]
            const filename = buildSingleAccountFilename(account.email, i + 1, exportDate)
            const filePath = `${dirPath}/${filename}`

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
            await (window as any).__TAURI__.fs.writeTextFile(filePath, content)
            successCount++
            console.log(`[批量导出] 成功导出 ${i + 1}/${accounts.length}: ${filename}`)
          } catch (error) {
            errorCount++
            console.error(`[批量导出] 导出第 ${i + 1} 个账号失败:`, error)
          }
        }

        console.log(`[批量导出] 完成，成功: ${successCount}, 失败: ${errorCount}`)

        // 如果选择了标记为已卖出，且导出成功
        if (markAsSold && successCount > 0) {
          console.log('[批量导出] 开始标记账号为已卖出...')
          accounts.forEach(account => {
            if (!account.tags.includes('sold')) {
              accountStore.updateAccount(account.id, {
                tags: [...account.tags, 'sold'],
                lastExportedAt: Date.now()
              })
            }
          })
          console.log(`[批量导出] 已将 ${accounts.length} 个账号标记为已卖出`)
        } else if (successCount > 0) {
          // 即使不标记为已卖出，也记录导出时间
          console.log('[批量导出] 记录导出时间...')
          accounts.forEach(account => {
            accountStore.updateAccount(account.id, {
              lastExportedAt: Date.now()
            })
          })
        }

        if (errorCount > 0) {
          window.UI?.toast.warning(`已导出 ${successCount} 个账号，${errorCount} 个失败`)
        } else {
          const message = markAsSold
            ? `已成功导出 ${successCount} 个账号到: ${dirPath}，并标记为已卖出`
            : `已成功导出 ${successCount} 个账号到: ${dirPath}`
          window.UI?.toast.success(message)
        }

        try {
          await revealItemInDir(dirPath)
        } catch (openError) {
          console.warn('[批量导出] 打开导出目录失败:', openError)
        }

        window.UI?.modal.close(modal)
        delete window.closeExportDialog
        delete window.submitExport
        return
      }

      // 单文件导出（原有逻辑）
      const content = generateExportContent(accounts, selectedFormat, includeCredentials)
      console.log('[导出] 生成内容成功，长度:', content.length)

      const extensions: Record<'json' | 'txt' | 'csv', 'json' | 'txt' | 'csv'> = { json: 'json', txt: 'txt', csv: 'csv' }
      const ext = extensions[selectedFormat]
      const defaultFilename = buildExportFilename(accounts.length, ext)
      console.log('[导出] 默认文件名:', defaultFilename)

      // 使用 Tauri 的 save 对话框
      const filePath = await (window as any).__TAURI__.dialog.save({
        title: '导出账号数据',
        defaultPath: defaultFilename,
        filters: [{
          name: selectedFormat.toUpperCase(),
          extensions: [ext]
        }]
      })

      console.log('[导出] 选择的文件路径:', filePath)

      if (filePath) {
        // 写入文件
        console.log('[导出] 开始写入文件...')
        await (window as any).__TAURI__.fs.writeTextFile(filePath, content)
        console.log('[导出] 文件写入成功')

        // 如果选择了标记为已卖出
        if (markAsSold && selectedFormat === 'json') {
          console.log('[导出] 开始标记账号为已卖出...')
          accounts.forEach(account => {
            if (!account.tags.includes('sold')) {
              accountStore.updateAccount(account.id, {
                tags: [...account.tags, 'sold'],
                lastExportedAt: Date.now()
              })
            }
          })
          console.log(`[导出] 已将 ${accounts.length} 个账号标记为已卖出`)
        } else {
          // 即使不标记为已卖出，也记录导出时间
          console.log('[导出] 记录导出时间...')
          accounts.forEach(account => {
            accountStore.updateAccount(account.id, {
              lastExportedAt: Date.now()
            })
          })
        }

        const message = markAsSold && selectedFormat === 'json'
          ? `已导出 ${accounts.length} 个账号到: ${filePath}，并标记为已卖出`
          : `已导出 ${accounts.length} 个账号到: ${filePath}`
        window.UI?.toast.success(message)

        try {
          await revealItemInDir(filePath)
        } catch (openError) {
          console.warn('[导出] 打开导出目录失败:', openError)
          window.UI?.toast.warning('文件已导出，但打开目录失败')
        }
        window.UI?.modal.close(modal)
        delete window.closeExportDialog
        delete window.submitExport
      } else {
        console.log('[导出] 用户取消了文件选择')
      }
    } catch (error) {
      console.error('[导出] 导出失败:', error)
      window.UI?.toast.error('导出失败: ' + (error as Error).message)
    }
  }
}
