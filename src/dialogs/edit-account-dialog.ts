// 编辑账号对话框
import type { Account } from '../types'
import { accountStore } from '../store'
import { getIdpDisplayName } from '../utils/account-utils'

/**
 * 显示编辑账号对话框
 */
export function showEditAccountDialog(account: Account): void {
  const notes = accountStore.getNotes()
  const accountTags = account.tags || []

  const modal = window.UI?.modal.open({
    title: '编辑账号',
    html: `
      <div class="modal-form">
        <div class="form-section">
          <label class="form-label">邮箱 <span class="required">*</span></label>
          <input type="email" class="form-input" id="edit-account-email" value="${account.email}" required>
        </div>
        <div class="form-row">
          <div class="form-section">
            <label class="form-label">昵称</label>
            <input type="text" class="form-input" id="edit-account-nickname" value="${account.nickname || ''}" placeholder="我的账号">
          </div>
          <div class="form-section">
            <label class="form-label">登录方式</label>
            <div class="ui-dropdown" style="width: 100%;">
              <button class="ui-btn ui-btn-secondary" data-dropdown style="width: 100%; justify-content: space-between;" id="edit-idp-btn">
                <span id="edit-idp-text">${getIdpDisplayName(account.idp)}</span>
                <span>▼</span>
              </button>
              <div class="ui-dropdown-menu" style="width: 100%;">
                <button class="ui-dropdown-item" onclick="window.selectEditIdp('BuilderId', 'Builder ID')">Builder ID</button>
                <button class="ui-dropdown-item" onclick="window.selectEditIdp('Enterprise', 'Enterprise')">Enterprise</button>
                <button class="ui-dropdown-item" onclick="window.selectEditIdp('Google', 'Google')">Google</button>
                <button class="ui-dropdown-item" onclick="window.selectEditIdp('Github', 'GitHub')">GitHub</button>
              </div>
            </div>
            <input type="hidden" id="edit-account-idp" value="${account.idp}">
          </div>
        </div>
        <div class="form-section">
          <label class="form-label">备注标签</label>
          <div class="notes-container" id="edit-account-notes">
            ${notes.map(note => `
              <label class="note-checkbox-item">
                <input type="checkbox" value="${note.id}" ${accountTags.includes(note.id) ? 'checked' : ''}>
                <span class="note-tag" style="background-color: ${note.color}20; color: ${note.color}; border-color: ${note.color}40;">
                  ${note.name}
                </span>
              </label>
            `).join('')}
          </div>
          <button class="ui-btn ui-btn-secondary" style="margin-top: 8px;" onclick="window.showAddNoteDialog()">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            新建备注
          </button>
        </div>
        <div class="form-section">
          <label class="form-label">Access Token <span class="required">*</span></label>
          <textarea class="form-input form-textarea" id="edit-account-access-token" rows="3">${account.credentials.accessToken}</textarea>
        </div>
        <div class="form-section">
          <label class="form-label">Refresh Token</label>
          <textarea class="form-input form-textarea" id="edit-account-refresh-token" rows="3">${account.credentials.refreshToken || ''}</textarea>
        </div>
      </div>
    `,
    footer: `
      <button class="ui-btn ui-btn-secondary" onclick="window.closeEditAccountModal()">取消</button>
      <button class="ui-btn ui-btn-primary" onclick="window.submitEditAccount()">保存</button>
    `,
    size: 'lg',
    closable: true
  })

  window.showAddNoteDialog = () => {
    const noteModal = window.UI?.modal.open({
      title: '新建备注',
      html: `
        <div class="modal-form">
          <div class="form-section">
            <label class="form-label">备注名称 <span class="required">*</span></label>
            <input type="text" class="form-input" id="new-note-name" placeholder="例如：主力账号" autofocus>
          </div>
          <div class="form-section">
            <label class="form-label">颜色</label>
            <div class="color-picker">
              ${['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'].map(color => `
                <label class="color-option">
                  <input type="radio" name="note-color" value="${color}" ${color === '#3b82f6' ? 'checked' : ''}>
                  <span class="color-swatch" style="background-color: ${color};"></span>
                </label>
              `).join('')}
            </div>
          </div>
        </div>
      `,
      footer: `
        <button class="ui-btn ui-btn-secondary" onclick="window.closeAddNoteModal()">取消</button>
        <button class="ui-btn ui-btn-primary" onclick="window.submitAddNote()">创建</button>
      `,
      closable: true
    })

    window.closeAddNoteModal = () => {
      window.UI?.modal.close(noteModal)
      delete window.closeAddNoteModal
      delete window.submitAddNote
    }

    window.submitAddNote = () => {
      const name = (document.getElementById('new-note-name') as HTMLInputElement)?.value.trim()
      const color = (document.querySelector('input[name="note-color"]:checked') as HTMLInputElement)?.value || '#3b82f6'

      if (!name) {
        window.UI?.toast.error('请输入备注名称')
        return
      }

      const noteId = accountStore.addNote(name, color)
      window.UI?.toast.success('备注创建成功')
      window.UI?.modal.close(noteModal)

      // 刷新备注列表
      const notesContainer = document.getElementById('edit-account-notes')
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

      delete window.closeAddNoteModal
      delete window.submitAddNote
    }
  }

  window.selectEditIdp = (idp: string, displayName: string) => {
    const idpInput = document.getElementById('edit-account-idp') as HTMLInputElement
    const idpText = document.getElementById('edit-idp-text')
    if (idpInput) idpInput.value = idp
    if (idpText) idpText.textContent = displayName
  }

  window.closeEditAccountModal = () => {
    window.UI?.modal.close(modal)
    delete window.closeEditAccountModal
    delete window.submitEditAccount
    delete window.selectEditIdp
  }

  window.submitEditAccount = () => {
    const email = (document.getElementById('edit-account-email') as HTMLInputElement)?.value
    const nickname = (document.getElementById('edit-account-nickname') as HTMLInputElement)?.value
    const idp = (document.getElementById('edit-account-idp') as HTMLInputElement)?.value
    const accessToken = (document.getElementById('edit-account-access-token') as HTMLTextAreaElement)?.value
    const refreshToken = (document.getElementById('edit-account-refresh-token') as HTMLTextAreaElement)?.value

    // 获取选中的备注
    const selectedNotes: string[] = []
    const noteCheckboxes = document.querySelectorAll('#edit-account-notes input[type="checkbox"]:checked')
    noteCheckboxes.forEach((checkbox) => {
      selectedNotes.push((checkbox as HTMLInputElement).value)
    })

    // 输入验证
    if (!email || !accessToken) {
      window.UI?.toast.error('请填写必填项')
      return
    }

    // 邮箱格式验证
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      window.UI?.toast.error('邮箱格式不正确')
      return
    }

    // Token 长度验证
    if (accessToken.length < 10 || accessToken.length > 10000) {
      window.UI?.toast.error('Access Token 长度不合法')
      return
    }

    if (refreshToken && (refreshToken.length < 10 || refreshToken.length > 10000)) {
      window.UI?.toast.error('Refresh Token 长度不合法')
      return
    }

    accountStore.updateAccount(account.id, {
      email,
      nickname: nickname || undefined,
      idp: idp as any,
      tags: selectedNotes,
      credentials: {
        ...account.credentials,
        accessToken,
        refreshToken: refreshToken || undefined
      }
    })

    window.UI?.toast.success('账号更新成功')
    window.UI?.modal.close(modal)
    delete window.closeEditAccountModal
    delete window.submitEditAccount
    delete window.selectEditIdp
    delete window.showAddNoteDialog
  }
}
