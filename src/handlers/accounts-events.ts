import { accountStore } from '../store'
import { showAddAccountDialog } from '../dialogs/add-account-dialog'
import { showFormatImportDialog } from '../dialogs/format-import-dialog'
import { handleBatchCheck, handleBatchRefresh, handleBatchDelete, handleBatchEnableOverages } from '../actions/account-actions'
import { showBatchNotesDialog } from '../dialogs/batch-notes-dialog'
import { showBatchSoldDialog } from '../dialogs/batch-sold-dialog'

export function attachAccountsEvents(
  container: HTMLElement,
  selectedIds: Set<string>,
  onFilterToggle: () => void,
  onViewModeChange: (mode: 'grid' | 'list') => void,
  onExport: () => void,
  onUpdateAccountList: () => void,
  onUpdateSelectionUI: () => void,
  onAttachAccountCardEvents: () => void
) {
  const searchInput = container.querySelector('#search-input') as HTMLInputElement
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const value = (e.target as HTMLInputElement).value
      const filter = accountStore.getFilter()
      // 直接更新 filter 对象，不触发订阅通知
      filter.search = value || undefined

      // 只更新账号列表，不重新渲染整个页面
      onUpdateAccountList()
    })

    // 支持 ESC 键清空搜索
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const filter = accountStore.getFilter()
        filter.search = undefined
        searchInput.value = ''
        onUpdateAccountList()
      }
    })
  }

  // 清空搜索按钮
  const clearBtn = container.querySelector('#search-clear-btn')
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const filter = accountStore.getFilter()
      filter.search = undefined
      if (searchInput) searchInput.value = ''
      onUpdateAccountList()
      searchInput?.focus()
    })
  }

  // 筛选切换按钮
  const filterToggleBtn = container.querySelector('#filter-toggle-btn')
  if (filterToggleBtn) {
    filterToggleBtn.addEventListener('click', () => {
      onFilterToggle()
    })
  }

  // 视图模式切换
  const viewGridBtn = container.querySelector('#view-grid-btn')
  const viewListBtn = container.querySelector('#view-list-btn')
  if (viewGridBtn) {
    viewGridBtn.addEventListener('click', () => {
      onViewModeChange('grid')
    })
  }
  if (viewListBtn) {
    viewListBtn.addEventListener('click', () => {
      onViewModeChange('list')
    })
  }

  // 筛选按钮事件
  const filterBtns = container.querySelectorAll('.filter-btn')
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const type = (btn as HTMLElement).dataset.filterType
      const value = (btn as HTMLElement).dataset.filterValue
      toggleFilter(type!, value!)
    })
  })

  // 使用量范围筛选
  const usageMinInput = container.querySelector('#usage-min') as HTMLInputElement
  const usageMaxInput = container.querySelector('#usage-max') as HTMLInputElement
  if (usageMinInput && usageMaxInput) {
    usageMinInput.addEventListener('change', () => {
      const filter = accountStore.getFilter()
      accountStore.setFilter({
        ...filter,
        usageMin: usageMinInput.value ? Number(usageMinInput.value) / 100 : undefined
      })
    })
    usageMaxInput.addEventListener('change', () => {
      const filter = accountStore.getFilter()
      accountStore.setFilter({
        ...filter,
        usageMax: usageMaxInput.value ? Number(usageMaxInput.value) / 100 : undefined
      })
    })
  }

  // 剩余天数范围筛选
  const daysMinInput = container.querySelector('#days-min') as HTMLInputElement
  const daysMaxInput = container.querySelector('#days-max') as HTMLInputElement
  if (daysMinInput && daysMaxInput) {
    daysMinInput.addEventListener('change', () => {
      const filter = accountStore.getFilter()
      accountStore.setFilter({
        ...filter,
        daysRemainingMin: daysMinInput.value ? Number(daysMinInput.value) : undefined
      })
    })
    daysMaxInput.addEventListener('change', () => {
      const filter = accountStore.getFilter()
      accountStore.setFilter({
        ...filter,
        daysRemainingMax: daysMaxInput.value ? Number(daysMaxInput.value) : undefined
      })
    })
  }

  // 导入日期范围筛选
  const importDateStartInput = container.querySelector('#import-date-start') as HTMLInputElement
  const importDateEndInput = container.querySelector('#import-date-end') as HTMLInputElement
  if (importDateStartInput && importDateEndInput) {
    importDateStartInput.addEventListener('change', () => {
      const filter = accountStore.getFilter()
      accountStore.setFilter({
        ...filter,
        importDateStart: importDateStartInput.value ? new Date(importDateStartInput.value).setHours(0, 0, 0, 0) : undefined
      })
    })
    importDateEndInput.addEventListener('change', () => {
      const filter = accountStore.getFilter()
      accountStore.setFilter({
        ...filter,
        importDateEnd: importDateEndInput.value ? new Date(importDateEndInput.value).setHours(23, 59, 59, 999) : undefined
      })
    })
  }

  const addBtns = container.querySelectorAll('#add-account-btn, #add-first-account-btn')
  addBtns.forEach(btn => {
    btn.addEventListener('click', () => showAddAccountDialog())
  })

  const formatImportBtn = container.querySelector('#format-import-btn')
  if (formatImportBtn) {
    formatImportBtn.addEventListener('click', () => showFormatImportDialog())
  }

  const exportBtn = container.querySelector('#export-btn')
  if (exportBtn) {
    exportBtn.addEventListener('click', () => onExport())
  }

  // 全选复选框
  const selectAllCheckbox = container.querySelector('#select-all-checkbox')
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('click', () => {
      const filteredAccounts = accountStore.getFilteredAccounts()
      const allSelected = selectedIds.size > 0 && selectedIds.size === filteredAccounts.length

      if (allSelected) {
        // 取消全选
        selectedIds.clear()
      } else {
        // 全选
        filteredAccounts.forEach(account => {
          selectedIds.add(account.id)
        })
      }
      onUpdateSelectionUI()
    })
  }

  // 快速选择 15 个
  const quickSelect15Btn = container.querySelector('#quick-select-15')
  if (quickSelect15Btn) {
    quickSelect15Btn.addEventListener('click', () => {
      quickSelectUnusedAccounts(15, selectedIds, onUpdateSelectionUI)
    })
  }

  // 快速选择 35 个
  const quickSelect35Btn = container.querySelector('#quick-select-35')
  if (quickSelect35Btn) {
    quickSelect35Btn.addEventListener('click', () => {
      quickSelectUnusedAccounts(35, selectedIds, onUpdateSelectionUI)
    })
  }

  // 快速选择自定义数量
  const quickSelectCustomBtn = container.querySelector('#quick-select-custom')
  if (quickSelectCustomBtn) {
    quickSelectCustomBtn.addEventListener('click', () => {
      showCustomSelectDialog(selectedIds, onUpdateSelectionUI)
    })
  }

  const batchCheckBtn = container.querySelector('#batch-check-btn')
  if (batchCheckBtn) {
    batchCheckBtn.addEventListener('click', () => handleBatchCheck(selectedIds))
  }

  const batchNotesBtn = container.querySelector('#batch-notes-btn')
  if (batchNotesBtn) {
    batchNotesBtn.addEventListener('click', () => showBatchNotesDialog(selectedIds))
  }

  const batchSoldBtn = container.querySelector('#batch-sold-btn')
  if (batchSoldBtn) {
    batchSoldBtn.addEventListener('click', () => showBatchSoldDialog(selectedIds))
  }

  const batchRefreshBtn = container.querySelector('#batch-refresh-btn')
  if (batchRefreshBtn) {
    batchRefreshBtn.addEventListener('click', () => handleBatchRefresh(selectedIds))
  }

  const batchOveragesBtn = container.querySelector('#batch-overages-btn')
  if (batchOveragesBtn) {
    batchOveragesBtn.addEventListener('click', () => handleBatchEnableOverages(selectedIds))
  }

  const batchDisableOveragesBtn = container.querySelector('#batch-disable-overages-btn')
  if (batchDisableOveragesBtn) {
    batchDisableOveragesBtn.addEventListener('click', () => handleBatchEnableOverages(selectedIds, 'DISABLED'))
  }

  const batchDeleteBtn = container.querySelector('#batch-delete-btn')
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener('click', () => handleBatchDelete(selectedIds, () => { selectedIds.clear(); }))
  }

  onAttachAccountCardEvents()
}

function toggleFilter(type: string, value: string) {
  const filter = accountStore.getFilter()

  if (type === 'subscription') {
    const current = filter.subscriptionTypes || []
    const newValue = current.includes(value as any)
      ? current.filter(v => v !== value)
      : [...current, value as any]
    accountStore.setFilter({
      ...filter,
      subscriptionTypes: newValue.length > 0 ? newValue : undefined
    })
  } else if (type === 'status') {
    const current = filter.statuses || []
    const newValue = current.includes(value as any)
      ? current.filter(v => v !== value)
      : [...current, value as any]
    accountStore.setFilter({
      ...filter,
      statuses: newValue.length > 0 ? newValue : undefined
    })
  } else if (type === 'idp') {
    const current = filter.idps || []
    const newValue = current.includes(value as any)
      ? current.filter(v => v !== value)
      : [...current, value as any]
    accountStore.setFilter({
      ...filter,
      idps: newValue.length > 0 ? newValue : undefined
    })
  } else if (type === 'emailDomain') {
    const current = filter.emailDomains || []
    const newValue = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value]
    accountStore.setFilter({
      ...filter,
      emailDomains: newValue.length > 0 ? newValue : undefined
    })
  } else if (type === 'sold') {
    if (value === 'only') {
      // 点击"仅已卖出"
      accountStore.setFilter({
        ...filter,
        showSoldOnly: filter.showSoldOnly === true ? undefined : true
      })
    } else if (value === 'exclude') {
      // 点击"排除已卖出"
      accountStore.setFilter({
        ...filter,
        showSoldOnly: filter.showSoldOnly === false ? undefined : false
      })
    }
  }
}

/**
 * 显示自定义选择对话框
 */
function showCustomSelectDialog(
  selectedIds: Set<string>,
  onUpdateSelectionUI: () => void
) {
  const modal = window.UI?.modal.open({
    title: '自定义选择数量',
    html: `
      <div class="modal-form">
        <div class="form-section">
          <label class="form-label">请输入要选择的账号数量</label>
          <input type="number" class="form-input" id="custom-select-count" placeholder="例如：50" min="1" step="1" autofocus>
          <p class="form-hint">将从当前筛选结果中选择指定数量的未使用账号（用量为0）</p>
        </div>
      </div>
    `,
    footer: `
      <button class="ui-btn ui-btn-secondary" id="custom-select-cancel">取消</button>
      <button class="ui-btn ui-btn-primary" id="custom-select-confirm">确定</button>
    `,
    size: 'default',
    closable: true
  })

  const input = document.getElementById('custom-select-count') as HTMLInputElement
  const cancelBtn = document.getElementById('custom-select-cancel')
  const confirmBtn = document.getElementById('custom-select-confirm')

  // 自动聚焦输入框
  setTimeout(() => input?.focus(), 100)

  // 支持回车确认
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmBtn?.click()
    }
  })

  cancelBtn?.addEventListener('click', () => {
    window.UI?.modal.close(modal)
  })

  confirmBtn?.addEventListener('click', () => {
    const value = input?.value
    if (!value) {
      window.UI?.toast.error('请输入数量')
      return
    }

    const count = parseInt(value, 10)
    if (isNaN(count) || count <= 0) {
      window.UI?.toast.error('请输入有效的数量（大于0的整数）')
      return
    }

    quickSelectUnusedAccounts(count, selectedIds, onUpdateSelectionUI)
    window.UI?.modal.close(modal)
  })
}

/**
 * 快速选择未使用的账号
 * @param count 要选择的数量
 * @param selectedIds 当前选中的账号ID集合
 * @param onUpdateSelectionUI 更新选中状态UI的回调
 */
function quickSelectUnusedAccounts(
  count: number,
  selectedIds: Set<string>,
  onUpdateSelectionUI: () => void
) {
  const filteredAccounts = accountStore.getFilteredAccounts()

  // 筛选出未使用过用量的账号（current === 0）
  const unusedAccounts = filteredAccounts.filter(account => {
    return account.usage.current === 0
  })

  if (unusedAccounts.length === 0) {
    window.UI?.toast.warning('当前筛选结果中没有未使用的账号')
    return
  }

  // 清空当前选中
  selectedIds.clear()

  // 选择指定数量的账号
  const selectCount = Math.min(count, unusedAccounts.length)
  for (let i = 0; i < selectCount; i++) {
    selectedIds.add(unusedAccounts[i].id)
  }

  onUpdateSelectionUI()

  const message = selectCount < count
    ? `已选择 ${selectCount} 个未使用账号（仅有 ${unusedAccounts.length} 个可选）`
    : `已选择 ${selectCount} 个未使用账号`

  window.UI?.toast.success(message)
}
