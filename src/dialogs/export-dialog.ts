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
  let exportSingleFile = true // 是否导出单个文件
  let exportMultipleFiles = true // 是否导出多个文件
  let enableBatchPackage = false // 是否启用批量打包
  let accountsPerFolder = 15 // 每个文件夹多少个账号
  let packageCount = 1 // 导出几份
  let markAsSold = false // 是否标记为已卖出

  // 计算可导出的最大份数
  const calculateMaxPackages = () => {
    return Math.floor(accounts.length / accountsPerFolder)
  }

  // 更新份数显示和提示
  const updatePackageInfo = () => {
    const maxPackages = calculateMaxPackages()
    const packageCountInput = document.getElementById('package-count') as HTMLInputElement
    const packageInfoText = document.getElementById('package-info-text')

    console.log('[批量打包] updatePackageInfo 被调用')
    console.log('[批量打包] accounts.length:', accounts.length)
    console.log('[批量打包] accountsPerFolder:', accountsPerFolder)
    console.log('[批量打包] maxPackages:', maxPackages)
    console.log('[批量打包] packageCount:', packageCount)

    if (packageCountInput) {
      packageCountInput.max = maxPackages.toString()
      // 如果当前份数超过最大值，自动调整
      if (packageCount > maxPackages) {
        packageCount = maxPackages
        packageCountInput.value = maxPackages.toString()
      }
    }

    if (packageInfoText) {
      const totalNeeded = accountsPerFolder * packageCount
      const availableText = maxPackages > 0
        ? `可导出最多 ${maxPackages} 份（共需 ${totalNeeded} 个账号，当前已选 ${accounts.length} 个）`
        : `账号不足，需要至少 ${accountsPerFolder} 个账号`
      packageInfoText.textContent = availableText
      packageInfoText.style.color = maxPackages >= packageCount ? 'var(--text-secondary)' : 'var(--color-warning)'
      console.log('[批量打包] 更新提示文本:', availableText)
    } else {
      console.log('[批量打包] 找不到 package-info-text 元素')
    }
  }

  const updatePreview = () => {
    const formatDesc = document.getElementById('format-desc')
    const credentialsOption = document.getElementById('credentials-option')
    const singleFileOption = document.getElementById('single-file-option')
    const multipleFilesOption = document.getElementById('multiple-files-option')
    const batchPackageOption = document.getElementById('batch-package-option')
    const markAsSoldOption = document.getElementById('mark-as-sold-option')

    const descriptions = {
      json: '完整数据，可用于导入',
      txt: includeCredentials ? '可导入格式：邮箱,Token,昵称,登录方式' : '纯文本格式，每行一个账号',
      csv: includeCredentials ? '可导入格式，Excel 兼容' : 'Excel 兼容格式',
      clipboard: includeCredentials ? '可导入格式：邮箱,Token' : '复制到剪贴板'
    }

    if (formatDesc) formatDesc.textContent = descriptions[selectedFormat]
    if (credentialsOption) {
      credentialsOption.style.display = selectedFormat === 'json' ? 'flex' : 'none'
    }
    if (singleFileOption) {
      singleFileOption.style.display = selectedFormat === 'json' ? 'flex' : 'none'
    }
    if (multipleFilesOption) {
      multipleFilesOption.style.display = selectedFormat === 'json' ? 'flex' : 'none'
    }
    if (batchPackageOption) {
      batchPackageOption.style.display = selectedFormat === 'json' ? 'flex' : 'none'
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

        <div class="export-option" id="single-file-option">
          <label class="export-checkbox">
            <input type="checkbox" id="export-single-file" checked>
            <span class="export-checkbox-label">
              <div class="export-option-title">导出为单个文件</div>
              <div class="export-option-desc">所有账号打包在一个 JSON 文件中</div>
            </span>
          </label>
        </div>

        <div class="export-option" id="multiple-files-option">
          <label class="export-checkbox">
            <input type="checkbox" id="export-multiple-files" checked>
            <span class="export-checkbox-label">
              <div class="export-option-title">导出为多个文件</div>
              <div class="export-option-desc">每个账号一个独立 JSON 文件，文件名格式：日期_时间_序号_邮箱.json</div>
            </span>
          </label>
        </div>

        <div class="export-option" id="batch-package-option">
          <label class="export-checkbox">
            <input type="checkbox" id="enable-batch-package">
            <span class="export-checkbox-label">
              <div class="export-option-title">批量打包模式</div>
              <div class="export-option-desc">将选中的账号分组打包为多个 ZIP 文件</div>
            </span>
          </label>
          <div class="batch-package-settings" id="batch-package-settings" style="display: none; margin-top: 0.75rem; padding-left: 1.75rem;">
            <div style="display: flex; gap: 1rem; align-items: center; flex-wrap: wrap;">
              <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: var(--text-primary);">
                <span style="white-space: nowrap;">每份包含</span>
                <input type="number" id="accounts-per-folder" value="15" min="1" max="100"
                       style="width: 70px; padding: 0.375rem 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); text-align: center;">
                <span style="white-space: nowrap;">个账号</span>
              </label>
              <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: var(--text-primary);">
                <span style="white-space: nowrap;">共导出</span>
                <input type="number" id="package-count" value="1" min="1" max="50"
                       style="width: 70px; padding: 0.375rem 0.5rem; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-primary); color: var(--text-primary); text-align: center;">
                <span style="white-space: nowrap;">份 ZIP</span>
              </label>
            </div>
            <div id="package-info-text" style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.5rem; line-height: 1.4;">
              可导出最多 1 份（共需 15 个账号，当前已选 ${accounts.length} 个）
            </div>
          </div>
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

  // 单文件导出选项
  const singleFileCheckbox = document.getElementById('export-single-file') as HTMLInputElement
  if (singleFileCheckbox) {
    singleFileCheckbox.addEventListener('change', () => {
      exportSingleFile = singleFileCheckbox.checked
      updatePreview()
    })
  }

  // 多文件导出选项
  const multipleFilesCheckbox = document.getElementById('export-multiple-files') as HTMLInputElement
  if (multipleFilesCheckbox) {
    multipleFilesCheckbox.addEventListener('change', () => {
      exportMultipleFiles = multipleFilesCheckbox.checked
      updatePreview()
    })
  }

  // 批量打包选项
  const batchPackageCheckbox = document.getElementById('enable-batch-package') as HTMLInputElement
  const batchPackageSettings = document.getElementById('batch-package-settings')
  const accountsPerFolderInput = document.getElementById('accounts-per-folder') as HTMLInputElement
  const packageCountInput = document.getElementById('package-count') as HTMLInputElement

  if (batchPackageCheckbox) {
    batchPackageCheckbox.addEventListener('change', () => {
      enableBatchPackage = batchPackageCheckbox.checked
      if (batchPackageSettings) {
        batchPackageSettings.style.display = enableBatchPackage ? 'block' : 'none'
      }
      if (enableBatchPackage) {
        // 勾选时立即更新一次，延迟确保DOM已渲染
        setTimeout(() => {
          console.log('[批量打包] 初始化 - 账号数:', accounts.length, '每份:', accountsPerFolder)
          updatePackageInfo()
        }, 100)
      }
      updatePreview()
    })
  }

  if (accountsPerFolderInput) {
    accountsPerFolderInput.addEventListener('change', () => {
      const newValue = parseInt(accountsPerFolderInput.value) || 15
      console.log('[批量打包] 每份数量改变:', accountsPerFolder, '->', newValue)
      accountsPerFolder = newValue
      updatePackageInfo()
    })
    accountsPerFolderInput.addEventListener('input', () => {
      const newValue = parseInt(accountsPerFolderInput.value) || 15
      accountsPerFolder = newValue
      updatePackageInfo()
    })
  }

  if (packageCountInput) {
    packageCountInput.addEventListener('change', () => {
      const newValue = parseInt(packageCountInput.value) || 1
      console.log('[批量打包] 份数改变:', packageCount, '->', newValue)
      packageCount = newValue
      updatePackageInfo()
    })
    packageCountInput.addEventListener('input', () => {
      const newValue = parseInt(packageCountInput.value) || 1
      packageCount = newValue
      updatePackageInfo()
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

      // 如果是 JSON 格式且启用了批量打包模式
      if (selectedFormat === 'json' && enableBatchPackage) {
        console.log('[批量打包] 开始批量打包导出...')
        console.log('[批量打包] 每文件夹账号数:', accountsPerFolder)
        console.log('[批量打包] 导出份数:', packageCount)

        // 直接使用当前选中的账号
        console.log('[批量打包] 选中账号数量:', accounts.length)

        if (accounts.length === 0) {
          window.UI?.toast.warning('没有选中的账号')
          return
        }

        // 计算需要的总账号数
        const totalNeeded = accountsPerFolder * packageCount
        if (accounts.length < totalNeeded) {
          const message = `选中账号不足！需要 ${totalNeeded} 个，但只选中了 ${accounts.length} 个账号`
          window.UI?.toast.warning(message)
          return
        }

        // 让用户选择导出目录
        const dirPath = await (window as any).__TAURI__.dialog.open({
          title: '选择导出目录',
          directory: true,
          multiple: false
        })

        if (!dirPath) {
          console.log('[批量打包] 用户取消了目录选择')
          return
        }

        const exportDate = new Date()
        const allZipFiles: string[] = []
        let totalExported = 0
        let successPackages = 0

        // 为每一份创建一个ZIP包
        for (let packageIndex = 0; packageIndex < packageCount; packageIndex++) {
          const packageStartIndex = packageIndex * accountsPerFolder
          const packageAccounts = accounts.slice(packageStartIndex, packageStartIndex + accountsPerFolder)

          console.log(`[批量打包] 处理第 ${packageIndex + 1}/${packageCount} 份，账号数: ${packageAccounts.length}`)

          // 创建临时文件夹名称
          const timestamp = exportDate.toISOString().replace(/[:.]/g, '-').slice(0, -5)
          const folderName = `package_${packageIndex + 1}_${timestamp}`
          const tempFiles: string[] = []
          let packageExportedCount = 0

          // 导出单个合并文件
          if (exportSingleFile) {
            try {
              const filename = `${folderName}_all.json`
              const filePath = `${dirPath}/${folderName}_${filename}`
              const content = generateExportContent(packageAccounts, 'json', includeCredentials)

              await (window as any).__TAURI__.fs.writeTextFile(filePath, content)
              tempFiles.push(filePath)
              console.log(`[批量打包] 第 ${packageIndex + 1} 份单文件导出成功: ${filename}`)
            } catch (error) {
              console.error(`[批量打包] 第 ${packageIndex + 1} 份单文件导出失败:`, error)
            }
          }

          // 导出多个独立文件
          if (exportMultipleFiles) {
            for (let i = 0; i < packageAccounts.length; i++) {
              try {
                const account = packageAccounts[i]
                const filename = buildSingleAccountFilename(account.email, i + 1, exportDate)
                const filePath = `${dirPath}/${folderName}_${filename}`

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
                tempFiles.push(filePath)
                packageExportedCount++
                totalExported++
              } catch (error) {
                console.error(`[批量打包] 导出第 ${i + 1} 个账号失败:`, error)
              }
            }
          }

          // 打包成ZIP
          if (tempFiles.length > 0) {
            try {
              const zipFilename = `${folderName}.zip`
              const zipPath = `${dirPath}/${zipFilename}`

              await (window as any).__TAURI__.core.invoke('create_zip_archive', {
                files: tempFiles,
                outputPath: zipPath
              })

              allZipFiles.push(zipPath)
              successPackages++
              console.log(`[批量打包] 第 ${packageIndex + 1} 份打包成功: ${zipFilename}（包含 ${packageExportedCount} 个账号）`)

              // 清理临时文件
              await (window as any).__TAURI__.core.invoke('cleanup_temp_files', {
                files: tempFiles
              })
            } catch (zipError) {
              console.error(`[批量打包] 第 ${packageIndex + 1} 份打包失败:`, zipError)
            }
          }
        }

        console.log(`[批量打包] 全部完成 - 成功打包 ${successPackages}/${packageCount} 份，共导出 ${totalExported} 个账号`)

        // 如果选择了标记为已卖出
        if (markAsSold && totalExported > 0) {
          console.log('[批量打包] 开始标记账号为已卖出...')
          const exportedAccounts = accounts.slice(0, totalExported)
          const updates = exportedAccounts
            .filter(account => !account.tags.includes('sold'))
            .map(account => ({
              id: account.id,
              updates: {
                tags: [...account.tags, 'sold'],
                lastExportedAt: Date.now()
              }
            }))
          accountStore.batchUpdateAccounts(updates)
          console.log(`[批量打包] 已将 ${updates.length} 个账号标记为已卖出`)
        } else if (totalExported > 0) {
          // 记录导出时间
          const exportedAccounts = accounts.slice(0, totalExported)
          const updates = exportedAccounts.map(account => ({
            id: account.id,
            updates: {
              lastExportedAt: Date.now()
            }
          }))
          accountStore.batchUpdateAccounts(updates)
        }

        const message = markAsSold
          ? `已成功导出 ${successPackages} 个 ZIP 文件（共 ${totalExported} 个账号），并标记为已卖出`
          : `已成功导出 ${successPackages} 个 ZIP 文件（共 ${totalExported} 个账号）`
        window.UI?.toast.success(message)

        try {
          await revealItemInDir(dirPath)
        } catch (openError) {
          console.warn('[批量打包] 打开导出目录失败:', openError)
        }

        window.UI?.modal.close(modal)
        delete window.closeExportDialog
        delete window.submitExport
        return
      }

      // 如果是 JSON 格式（非批量打包模式）
      if (selectedFormat === 'json') {
        // 检查是否至少选择了一种导出方式
        if (!exportSingleFile && !exportMultipleFiles) {
          window.UI?.toast.warning('请至少选择一种导出方式')
          return
        }

        console.log('[批量导出] 导出选项 - 单文件:', exportSingleFile, ', 多文件:', exportMultipleFiles)

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

        const exportDate = new Date()
        const filesToZip: string[] = []
        let successCount = 0
        let errorCount = 0

        // 导出单个文件
        if (exportSingleFile) {
          try {
            const filename = buildExportFilename(accounts.length, 'json')
            const filePath = `${dirPath}/${filename}`
            const content = generateExportContent(accounts, 'json', includeCredentials)

            await (window as any).__TAURI__.fs.writeTextFile(filePath, content)
            filesToZip.push(filePath)
            console.log('[批量导出] 单文件导出成功:', filename)
          } catch (error) {
            console.error('[批量导出] 单文件导出失败:', error)
            errorCount++
          }
        }

        // 导出多个文件
        if (exportMultipleFiles) {
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
              filesToZip.push(filePath)
              successCount++
              console.log(`[批量导出] 成功导出 ${i + 1}/${accounts.length}: ${filename}`)
            } catch (error) {
              errorCount++
              console.error(`[批量导出] 导出第 ${i + 1} 个账号失败:`, error)
            }
          }
        }

        console.log(`[批量导出] 完成，成功: ${successCount}, 失败: ${errorCount}`)

        // 如果同时选择了两种格式，或者多文件数量超过1，则打包成ZIP
        const shouldZip = (exportSingleFile && exportMultipleFiles) || (exportMultipleFiles && accounts.length > 1)
        let finalPath = dirPath

        if (shouldZip && filesToZip.length > 0) {
          try {
            console.log('[批量导出] 开始打包 ZIP，文件数量:', filesToZip.length)
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
            const zipFilename = `accounts_export_${timestamp}.zip`
            const zipPath = `${dirPath}/${zipFilename}`

            await (window as any).__TAURI__.core.invoke('create_zip_archive', {
              files: filesToZip,
              outputPath: zipPath
            })

            console.log('[批量导出] ZIP 打包成功:', zipPath)
            finalPath = zipPath

            // 清理临时文件
            console.log('[批量导出] 清理临时文件...')
            await (window as any).__TAURI__.core.invoke('cleanup_temp_files', {
              files: filesToZip
            })
            console.log('[批量导出] 临时文件清理完成')
          } catch (zipError) {
            console.error('[批量导出] ZIP 打包失败:', zipError)
            window.UI?.toast.warning('文件已导出，但打包失败')
          }
        }

        // 如果选择了标记为已卖出，且导出成功
        if (markAsSold && successCount > 0) {
          console.log('[批量导出] 开始标记账号为已卖出...')
          const updates = accounts
            .filter(account => !account.tags.includes('sold'))
            .map(account => ({
              id: account.id,
              updates: {
                tags: [...account.tags, 'sold'],
                lastExportedAt: Date.now()
              }
            }))
          accountStore.batchUpdateAccounts(updates)
          console.log(`[批量导出] 已将 ${updates.length} 个账号标记为已卖出`)
        } else if (successCount > 0) {
          // 即使不标记为已卖出，也记录导出时间
          console.log('[批量导出] 记录导出时间...')
          const updates = accounts.map(account => ({
            id: account.id,
            updates: {
              lastExportedAt: Date.now()
            }
          }))
          accountStore.batchUpdateAccounts(updates)
        }

        if (errorCount > 0) {
          window.UI?.toast.warning(`已导出 ${successCount} 个账号，${errorCount} 个失败`)
        } else {
          const message = markAsSold
            ? `已成功导出 ${successCount} 个账号${shouldZip ? '并打包为 ZIP' : ''}，已标记为已卖出`
            : `已成功导出 ${successCount} 个账号${shouldZip ? '并打包为 ZIP' : ''}`
          window.UI?.toast.success(message)
        }

        try {
          await revealItemInDir(finalPath)
        } catch (openError) {
          console.warn('[批量导出] 打开导出目录失败:', openError)
        }

        window.UI?.modal.close(modal)
        delete window.closeExportDialog
        delete window.submitExport
        return
      }

      // 单文件导出（非JSON格式：TXT/CSV）
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

        // 记录导出时间
        console.log('[导出] 记录导出时间...')
        const updates = accounts.map(account => ({
          id: account.id,
          updates: {
            lastExportedAt: Date.now()
          }
        }))
        accountStore.batchUpdateAccounts(updates)

        window.UI?.toast.success(`已导出 ${accounts.length} 个账号到: ${filePath}`)

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
