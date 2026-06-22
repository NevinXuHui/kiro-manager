import { accountStore } from '../store'
import { renderAccountCard, renderAccountListItem } from './account-card'
import { renderFilterPanel } from './filter-panel'

export interface AccountPaginationState {
  currentPage: number
  pageSize: number
}

const PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

type PageButton = number | 'ellipsis-left' | 'ellipsis-right'

function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), totalPages)
}

function getPageButtons(currentPage: number, totalPages: number): PageButton[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const pages: PageButton[] = [1]
  const start = Math.max(2, currentPage - 1)
  const end = Math.min(totalPages - 1, currentPage + 1)

  if (start > 2) pages.push('ellipsis-left')

  for (let page = start; page <= end; page++) {
    pages.push(page)
  }

  if (end < totalPages - 1) pages.push('ellipsis-right')

  pages.push(totalPages)
  return pages
}

function renderPaginationControls(total: number, currentPage: number, pageSize: number): string {
  if (total === 0) return ''

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safeCurrentPage = clampPage(currentPage, totalPages)
  const startIndex = (safeCurrentPage - 1) * pageSize + 1
  const endIndex = Math.min(safeCurrentPage * pageSize, total)
  const isFirstPage = safeCurrentPage === 1
  const isLastPage = safeCurrentPage === totalPages

  const pageButtons = getPageButtons(safeCurrentPage, totalPages)
    .map(page => {
      if (typeof page !== 'number') {
        return '<span class="pagination-ellipsis">...</span>'
      }

      return `
        <button class="pagination-btn pagination-page-btn ${page === safeCurrentPage ? 'active' : ''}"
                data-pagination-page="${page}"
                ${page === safeCurrentPage ? 'disabled' : ''}>
          ${page}
        </button>
      `
    })
    .join('')

  return `
    <div class="accounts-pagination" id="accounts-pagination">
      <div class="pagination-summary">
        <span>第 ${startIndex}-${endIndex} 个，共 ${total} 个账号</span>
        <span>第 ${safeCurrentPage}/${totalPages} 页</span>
      </div>

      <div class="pagination-main">
        <div class="pagination-nav">
          <button class="pagination-btn" data-pagination-action="first" ${isFirstPage ? 'disabled' : ''}>首页</button>
          <button class="pagination-btn" data-pagination-action="prev" ${isFirstPage ? 'disabled' : ''}>上一页</button>
          <div class="pagination-pages">
            ${pageButtons}
          </div>
          <button class="pagination-btn" data-pagination-action="next" ${isLastPage ? 'disabled' : ''}>下一页</button>
          <button class="pagination-btn" data-pagination-action="last" ${isLastPage ? 'disabled' : ''}>末页</button>
        </div>

        <div class="pagination-tools">
          <label class="pagination-tool">
            <span>每页</span>
            <select class="pagination-select" id="account-page-size">
              ${PAGE_SIZE_OPTIONS.map(size => `
                <option value="${size}" ${size === pageSize ? 'selected' : ''}>${size}</option>
              `).join('')}
            </select>
          </label>
          <label class="pagination-tool">
            <span>跳转</span>
            <input class="pagination-input" id="account-page-jump" type="number" min="1" max="${totalPages}" value="${safeCurrentPage}">
          </label>
          <button class="pagination-btn" data-pagination-action="jump">确定</button>
        </div>
      </div>
    </div>
  `
}

export function renderAccountsView(
  selectedIds: Set<string>,
  isFilterExpanded: boolean,
  viewMode: 'grid' | 'list',
  pagination: AccountPaginationState
): string {
  const filteredAccounts = accountStore.getFilteredAccounts()
  const filter = accountStore.getFilter()
  const totalAccounts = filteredAccounts.length
  const allAccounts = accountStore.getAccounts()
  const totalAllAccounts = allAccounts.length
  const isFiltered = totalAccounts !== totalAllAccounts
  const totalPages = Math.max(1, Math.ceil(totalAccounts / pagination.pageSize))
  const currentPage = clampPage(pagination.currentPage, totalPages)
  const pageStart = (currentPage - 1) * pagination.pageSize
  const pageAccounts = filteredAccounts.slice(pageStart, pageStart + pagination.pageSize)
  const allFilteredSelected = selectedIds.size > 0 && selectedIds.size === totalAccounts

  return `
    <div class="content-body">
      <div class="toolbar-container">
        <div class="toolbar">
          <div class="search-box">
            <div class="ui-form-group">
              <div class="ui-input-group">
                <div class="ui-input-icon">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input type="text" class="ui-input" placeholder="搜索账号（邮箱/昵称/ID）..." id="search-input" value="${filter.search || ''}">
                ${filter.search ? `
                  <button class="search-clear-btn" id="search-clear-btn" title="清空搜索">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                ` : ''}
              </div>
            </div>
          </div>
          <div class="account-count-badge">
            ${isFiltered ? `
              <span class="count-filtered">${totalAccounts}</span>
              <span class="count-separator">/</span>
              <span class="count-total">${totalAllAccounts}</span>
            ` : `
              <span class="count-total">${totalAllAccounts}</span>
            `}
            <span class="count-label">个账号</span>
          </div>
          <div class="toolbar-actions">
            <button class="ui-btn ui-btn-secondary ${isFilterExpanded ? 'active' : ''}" id="filter-toggle-btn" title="展开/收起筛选">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              筛选
            </button>
            <button class="ui-btn ui-btn-primary" id="add-account-btn">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              添加账号
            </button>
            <button class="ui-btn ui-btn-secondary" id="format-import-btn">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              格式化导入
            </button>
            <button class="ui-btn ui-btn-secondary" id="export-btn">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              导出
            </button>
          </div>
        </div>

        <div class="toolbar-secondary">
          <div class="select-all-wrapper">
            <div class="custom-checkbox ${allFilteredSelected ? 'checked' : ''}" id="select-all-checkbox" title="${allFilteredSelected ? '取消全选' : '全选'}">
              ${allFilteredSelected ? '<svg fill="currentColor" viewBox="0 0 20 20" width="12" height="12"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>' : ''}
            </div>
            ${selectedIds.size > 0 ? `
              <span class="selection-text">已选中 ${selectedIds.size} 个</span>
            ` : ''}
          </div>
          <div class="quick-select-wrapper">
            <span class="quick-select-label">快速选择:</span>
            <button class="ui-btn ui-btn-xs ui-btn-secondary" id="quick-select-15" title="选择15个未使用、未卖出、未封禁账号">15个</button>
            <button class="ui-btn ui-btn-xs ui-btn-secondary" id="quick-select-35" title="选择35个未使用、未卖出、未封禁账号">35个</button>
            <button class="ui-btn ui-btn-xs ui-btn-secondary" id="quick-select-custom" title="自定义选择未使用、未卖出、未封禁账号数量">自定义</button>
          </div>
          <div class="toolbar-batch-actions">
            <button class="ui-btn ui-btn-sm ui-btn-secondary" id="batch-notes-btn" title="批量编辑备注" ${selectedIds.size === 0 ? 'disabled' : ''}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
              </svg>
              备注
            </button>
            <button class="ui-btn ui-btn-sm ui-btn-warning" id="batch-sold-btn" title="批量标记为已卖出" ${selectedIds.size === 0 ? 'disabled' : ''}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              标记卖出
            </button>
            <button class="ui-btn ui-btn-sm ui-btn-secondary" id="batch-check-btn" title="批量刷新Token" ${selectedIds.size === 0 ? 'disabled' : ''}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              刷新Token
            </button>
            <button class="ui-btn ui-btn-sm ui-btn-secondary" id="batch-refresh-btn" title="刷新账号信息" ${selectedIds.size === 0 ? 'disabled' : ''}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              刷新
            </button>
            <button class="ui-btn ui-btn-sm ui-btn-secondary" id="batch-overages-btn" title="为选中账号开通 Overages" ${selectedIds.size === 0 ? 'disabled' : ''}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6M19 12l3 3-3 3M22 15h-7" />
              </svg>
              开通 $
            </button>
            <button class="ui-btn ui-btn-sm ui-btn-secondary" id="batch-disable-overages-btn" title="为选中账号取消 Overages" ${selectedIds.size === 0 ? 'disabled' : ''}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6M5 12l-3 3 3 3M2 15h7" />
              </svg>
              取消 $
            </button>
            <button class="ui-btn ui-btn-sm ui-btn-danger" id="batch-delete-btn" title="删除选中账号" ${selectedIds.size === 0 ? 'disabled' : ''}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="14" height="14" style="margin-right: 0.25rem">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              删除
            </button>
          </div>
          <div class="view-mode-switch">
            <button class="view-mode-btn ${viewMode === 'grid' ? 'active' : ''}" id="view-grid-btn" title="卡片视图">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
            <button class="view-mode-btn ${viewMode === 'list' ? 'active' : ''}" id="view-list-btn" title="列表视图">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      ${isFilterExpanded ? renderFilterPanel() : ''}

      ${totalAccounts > 0 ? `
        <div class="${viewMode === 'grid' ? 'account-grid' : 'account-list'}" id="account-grid" data-current-page="${currentPage}" data-page-size="${pagination.pageSize}">
          ${pageAccounts.map(account => viewMode === 'grid' ? renderAccountCard(account, selectedIds.has(account.id)) : renderAccountListItem(account, selectedIds.has(account.id))).join('')}
        </div>
        ${renderPaginationControls(totalAccounts, currentPage, pagination.pageSize)}
      ` : `
        <div class="empty-state">
          <svg class="empty-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${filter.search || Object.keys(filter).length > 1 ? 'M21 21l-6-6m2-5a7 7 0 11-14 0 0114 0z' : 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'}" />
          </svg>
          <h3 class="empty-title">${filter.search || Object.keys(filter).length > 1 ? '未找到匹配的账号' : '暂无账号'}</h3>
          <p class="empty-text">${filter.search || Object.keys(filter).length > 1 ? '尝试调整筛选条件' : '点击下方按钮添加第一个账号'}</p>
          ${!filter.search && Object.keys(filter).length <= 1 ? '<button class="ui-btn ui-btn-primary" id="add-first-account-btn">添加账号</button>' : ''}
        </div>
      `}
    </div>
  `
}
