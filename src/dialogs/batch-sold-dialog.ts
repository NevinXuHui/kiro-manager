// 批量标记卖出对话框
import { accountStore } from '../store'

/**
 * 显示批量标记卖出对话框
 */
export function showBatchSoldDialog(accountIds: Set<string>): void {
  const accounts = accountStore.getAccounts().filter(a => accountIds.has(a.id))
  const alreadySoldCount = accounts.filter(a => a.isSold).length

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
              标记为已卖出
            </label>
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="radio" name="sold-action" value="unmark" style="margin-right: 6px;">
              取消卖出标记
            </label>
          </div>
        </div>
        <div class="form-section" id="sold-price-section">
          <label class="form-label">卖出价格（可选）</label>
          <input type="number" class="form-input" id="batch-sold-price" placeholder="例如：100" min="0" step="0.01">
        </div>
        <div class="form-section" id="sold-note-section">
          <label class="form-label">备注（可选）</label>
          <textarea class="form-input" id="batch-sold-note" rows="3" placeholder="例如：卖给某某客户"></textarea>
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
  const priceSection = document.getElementById('sold-price-section')
  const noteSection = document.getElementById('sold-note-section')

  radioButtons.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const value = (e.target as HTMLInputElement).value
      if (priceSection && noteSection) {
        if (value === 'mark') {
          priceSection.style.display = 'block'
          noteSection.style.display = 'block'
        } else {
          priceSection.style.display = 'none'
          noteSection.style.display = 'none'
        }
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
    const price = (document.getElementById('batch-sold-price') as HTMLInputElement)?.value
    const note = (document.getElementById('batch-sold-note') as HTMLTextAreaElement)?.value

    const isMark = action === 'mark'
    let updatedCount = 0

    accountIds.forEach(accountId => {
      const account = accountStore.getAccounts().find(a => a.id === accountId)
      if (account) {
        const updates: any = {
          isSold: isMark
        }

        if (isMark) {
          updates.soldAt = Date.now()
          if (price) {
            updates.soldPrice = parseFloat(price)
          }
          if (note) {
            updates.soldNote = note.trim()
          }
        } else {
          // 取消卖出标记时清除相关字段
          updates.soldAt = undefined
          updates.soldPrice = undefined
          updates.soldNote = undefined
        }

        accountStore.updateAccount(accountId, updates)
        updatedCount++
      }
    })

    const message = isMark
      ? `已标记 ${updatedCount} 个账号为已卖出`
      : `已取消 ${updatedCount} 个账号的卖出标记`

    window.UI?.toast.success(message)
    window.UI?.modal.close(modal)
    delete window.closeBatchSoldModal
    delete window.submitBatchSold
  }
}
