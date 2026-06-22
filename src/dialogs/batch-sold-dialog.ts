// 批量标记卖出对话框
import { accountStore } from '../store'

/**
 * 显示批量标记卖出对话框
 */
export function showBatchSoldDialog(accountIds: Set<string>): void {
  const accounts = accountStore.getAccounts().filter(a => accountIds.has(a.id))
  const alreadySoldCount = accounts.filter(a => a.tags.includes('sold')).length

  const modal = window.UI?.modal.open({
    title: `批量标记卖出 (${accountIds.size} 个账号)`,
    html: `
      <div class="modal-form">
        ${alreadySoldCount > 0 ? `
          <div style="padding: 10px; background: rgba(249, 115, 22, 0.1); border: 1px solid rgba(249, 115, 22, 0.3); border-radius: 6px; margin-bottom: 16px; font-size: 13px; color: #ea580c;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -3px; margin-right: 4px;">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            其中 ${alreadySoldCount} 个账号已被标记为卖出
          </div>
        ` : ''}
        <div class="form-section">
          <label class="form-label">操作类型</label>
          <div style="display: flex; gap: 12px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="radio" name="sold-action" value="mark" checked style="margin-right: 6px;">
              添加"已卖出"标签
            </label>
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="radio" name="sold-action" value="unmark" style="margin-right: 6px;">
              移除"已卖出"标签
            </label>
          </div>
        </div>
        <div class="form-section" id="sold-note-section">
          <label class="form-label">卖出备注（可选）</label>
          <textarea class="form-input" id="batch-sold-note" rows="2" placeholder="例如：卖给某某客户，价格100元"></textarea>
          <div style="margin-top: 6px; font-size: 11px; color: var(--text-muted);">
            此备注将显示在账号的备注标签区域
          </div>
        </div>
        <div style="padding: 10px; background: var(--slate-50); border: 1px solid var(--border-color); border-radius: 6px; font-size: 12px; color: var(--text-muted);">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          提示："已卖出"是一个特殊的备注标签，标记后账号会以橙色显示。
        </div>
      </div>
    `,
    footer: `
      <button class="ui-btn ui-btn-secondary" onclick="window.closeBatchSoldModal()">取消</button>
      <button class="ui-btn ui-btn-primary" onclick="window.submitBatchSold()">确认</button>
    `,
    size: 'lg',
    closable: true
  })

  // 监听操作类型切换
  const radioButtons = document.querySelectorAll('input[name="sold-action"]')
  const noteSection = document.getElementById('sold-note-section')

  radioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const value = (e.target as HTMLInputElement).value
      if (noteSection) {
        noteSection.style.display = value === 'mark' ? 'block' : 'none'
      }
    })
  })

  window.closeBatchSoldModal = () => {
    window.UI?.modal.close(modal)
    delete window.closeBatchSoldModal
    delete window.submitBatchSold
  }

  window.submitBatchSold = () => {
    const action = (document.querySelector('input[name="sold-action"]:checked') as HTMLInputElement)?.value
    const soldNote = (document.getElementById('batch-sold-note') as HTMLTextAreaElement)?.value.trim()
    const isMark = action === 'mark'

    const batchUpdates = Array.from(accountIds)
      .map(accountId => {
        const account = accountStore.getAccounts().find(a => a.id === accountId)
        if (!account) return null

        const currentTags = account.tags || []
        let newTags: string[]
        const updates: any = {}

        if (isMark) {
          // 添加"已卖出"标签（如果还没有）
          if (!currentTags.includes('sold')) {
            newTags = [...currentTags, 'sold']
          } else {
            newTags = currentTags
          }
          // 保存卖出备注
          if (soldNote) {
            updates.soldNote = soldNote
          }
        } else {
          // 移除"已卖出"标签和备注
          newTags = currentTags.filter(t => t !== 'sold')
          updates.soldNote = undefined
        }

        updates.tags = newTags
        return { id: accountId, updates }
      })
      .filter(Boolean) as Array<{ id: string; updates: any }>

    // 使用批量更新，只保存一次
    accountStore.batchUpdateAccounts(batchUpdates)

    const message = isMark
      ? `已为 ${batchUpdates.length} 个账号添加"已卖出"标签`
      : `已移除 ${batchUpdates.length} 个账号的"已卖出"标签`

    window.UI?.toast.success(message)
    window.UI?.modal.close(modal)
    delete window.closeBatchSoldModal
    delete window.submitBatchSold
  }
}
