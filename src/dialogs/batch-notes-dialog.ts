// 批量编辑备注对话框
import { accountStore } from '../store'

/**
 * 显示批量编辑备注对话框
 */
export function showBatchNotesDialog(accountIds: Set<string>): void {
  const notes = accountStore.getNotes()
  const accounts = accountStore.getAccounts().filter(a => accountIds.has(a.id))

  // 计算每个备注被多少个账号使用
  const noteUsage = new Map<string, number>()
  notes.forEach(note => {
    const count = accounts.filter(a => a.tags.includes(note.id)).length
    noteUsage.set(note.id, count)
  })

  const modal = window.UI?.modal.open({
    title: `批量编辑备注 (${accountIds.size} 个账号)`,
    html: `
      <div class="modal-form">
        <div class="form-section">
          <label class="form-label">选择备注标签</label>
          <p class="form-hint">勾选的备注将添加到所有选中的账号，取消勾选将从所有账号中移除</p>
          <div class="notes-container" id="batch-notes-container">
            ${notes.map(note => {
              const usageCount = noteUsage.get(note.id) || 0
              const isAllSelected = usageCount === accountIds.size
              const isPartialSelected = usageCount > 0 && usageCount < accountIds.size

              return `
                <label class="note-checkbox-item ${isPartialSelected ? 'partial' : ''}">
                  <input type="checkbox" value="${note.id}" ${isAllSelected ? 'checked' : ''} data-partial="${isPartialSelected}">
                  <span class="note-tag" style="background-color: ${note.color}20; color: ${note.color}; border-color: ${note.color}40;">
                    ${note.name}
                    ${isPartialSelected ? `<span class="note-usage-badge">${usageCount}/${accountIds.size}</span>` : ''}
                  </span>
                </label>
              `
            }).join('')}
          </div>
          <button class="ui-btn ui-btn-secondary" style="margin-top: 8px;" onclick="window.showAddNoteDialogFromBatch()">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            新建备注
          </button>
        </div>
      </div>
    `,
    footer: `
      <button class="ui-btn ui-btn-secondary" onclick="window.closeBatchNotesModal()">取消</button>
      <button class="ui-btn ui-btn-primary" onclick="window.submitBatchNotes()">应用</button>
    `,
    size: 'lg',
    closable: true
  })

  window.showAddNoteDialogFromBatch = () => {
    const noteModal = window.UI?.modal.open({
      title: '新建备注',
      html: `
        <div class="modal-form">
          <div class="form-section">
            <label class="form-label">备注名称 <span class="required">*</span></label>
            <input type="text" class="form-input" id="new-note-name-batch" placeholder="例如：主力账号" autofocus>
          </div>
          <div class="form-section">
            <label class="form-label">颜色</label>
            <div class="color-picker">
              ${['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'].map(color => `
                <label class="color-option">
                  <input type="radio" name="note-color-batch" value="${color}" ${color === '#3b82f6' ? 'checked' : ''}>
                  <span class="color-swatch" style="background-color: ${color};"></span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
      `,
      footer: `
        <button class="ui-btn ui-btn-secondary" onclick="window.closeAddNoteModalBatch()">取消</button>
        <button class="ui-btn ui-btn-primary" onclick="window.submitAddNoteBatch()">创建</button>
      `,
      closable: true
    })

    window.closeAddNoteModalBatch = () => {
      window.UI?.modal.close(noteModal)
      delete window.closeAddNoteModalBatch
      delete window.submitAddNoteBatch
    }

    window.submitAddNoteBatch = () => {
      const name = (document.getElementById('new-note-name-batch') as HTMLInputElement)?.value.trim()
      const color = (document.querySelector('input[name="note-color-batch"]:checked') as HTMLInputElement)?.value || '#3b82f6'

      if (!name) {
        window.UI?.toast.error('请输入备注名称')
        return
      }

      const noteId = accountStore.addNote(name, color)
      window.UI?.toast.success('备注创建成功')
      window.UI?.modal.close(noteModal)

      // 刷新备注列表
      const notesContainer = document.getElementById('batch-notes-container')
      if (notesContainer) {
        const newNote = accountStore.getNoteById(noteId)
        if (newNote) {
          const label = document.createElement('label')
          label.className = 'note-checkbox-item'
          label.innerHTML = `
            <input type="checkbox" value="${newNote.id}" checked>
            <span class="note-tag" style="background-color: ${newNote.color}20; color: ${newNote.color}; border-color: ${newNote.color}40;">
              ${newNote.name}
            </span>
          `
          notesContainer.appendChild(label)
        }
      }

      delete window.closeAddNoteModalBatch
      delete window.submitAddNoteBatch
    }
  }

  window.closeBatchNotesModal = () => {
    window.UI?.modal.close(modal)
    delete window.closeBatchNotesModal
    delete window.submitBatchNotes
    delete window.showAddNoteDialogFromBatch
  }

  window.submitBatchNotes = () => {
    // 获取选中的备注
    const selectedNotes: string[] = []
    const noteCheckboxes = document.querySelectorAll('#batch-notes-container input[type="checkbox"]:checked')
    noteCheckboxes.forEach((checkbox) => {
      selectedNotes.push((checkbox as HTMLInputElement).value)
    })

    // 批量更新账号
    const batchUpdates = Array.from(accountIds)
      .map(accountId => {
        const account = accountStore.getAccounts().find(a => a.id === accountId)
        if (!account) return null
        return {
          id: accountId,
          updates: { tags: selectedNotes }
        }
      })
      .filter(Boolean) as Array<{ id: string; updates: any }>

    // 使用批量更新，只保存一次
    accountStore.batchUpdateAccounts(batchUpdates)

    window.UI?.toast.success(`已为 ${batchUpdates.length} 个账号更新备注`)
    window.UI?.modal.close(modal)
    delete window.closeBatchNotesModal
    delete window.submitBatchNotes
    delete window.showAddNoteDialogFromBatch
  }
}
