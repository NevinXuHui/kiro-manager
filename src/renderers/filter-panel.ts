// 筛选面板渲染器
import { accountStore } from '../store'

interface FilterOptions {
  subscriptionTypes?: string[]
  statuses?: string[]
  idps?: string[]
  emailDomains?: string[]
  usageMin?: number
  usageMax?: number
  daysRemainingMin?: number
  daysRemainingMax?: number
  importDateStart?: number
  importDateEnd?: number
  enableImportDateFilter?: boolean
  exportDateStart?: number
  exportDateEnd?: number
  enableExportDateFilter?: boolean
  showSoldOnly?: boolean
  showExportedOnly?: boolean
  search?: string
}

function formatDateTimeInput(timestamp?: number): string {
  if (!timestamp) return ''

  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

/**
 * 渲染筛选面板
 */
export function renderFilterPanel(): string {
  const filter = accountStore.getFilter() as FilterOptions
  const stats = accountStore.getStats()

  const subscriptionOptions = [
    { value: 'Free', label: 'KIRO FREE', count: stats.bySubscription.Free },
    { value: 'Pro', label: 'KIRO PRO', count: stats.bySubscription.Pro },
    { value: 'Pro_Plus', label: 'KIRO PRO+', count: stats.bySubscription.Pro_Plus },
    { value: 'Enterprise', label: 'KIRO POWER', count: stats.bySubscription.Enterprise }
  ]

  const statusOptions = [
    { value: 'active', label: '正常', count: stats.byStatus.active },
    { value: 'expired', label: '已过期', count: stats.byStatus.expired },
    { value: 'error', label: '错误', count: stats.byStatus.error },
    { value: 'suspended', label: '已封禁', count: stats.byStatus.suspended },
    { value: 'unknown', label: '未知', count: stats.byStatus.unknown }
  ]

  const idpOptions = [
    { value: 'BuilderId', label: 'BuilderId', count: stats.byIdp.BuilderId || 0 },
    { value: 'Enterprise', label: 'Enterprise', count: stats.byIdp.Enterprise || 0 },
    { value: 'Google', label: 'Google', count: stats.byIdp.Google || 0 },
    { value: 'Github', label: 'GitHub', count: stats.byIdp.Github || 0 }
  ]

  // 统计包含"已卖出"标签的账号数量
  const soldCount = accountStore.getAccounts().filter(a => a.tags.includes('sold')).length

  // 获取邮箱后缀统计并排序（按数量降序）
  const emailDomainOptions = Object.entries(stats.byEmailDomain || {})
    .sort((a, b) => b[1] - a[1]) // 按数量降序排序
    .map(([domain, count]) => ({ value: domain, label: domain, count }))
    .slice(0, 10) // 只显示前10个最常见的后缀

  return `
    <div class="filter-panel">
      <div class="filter-row">
        <div class="filter-group">
          <span class="filter-label">订阅:</span>
          <div class="filter-buttons">
            ${subscriptionOptions.map(opt => `
              <button class="filter-btn ${filter.subscriptionTypes?.includes(opt.value) ? 'active' : ''}"
                      data-filter-type="subscription"
                      data-filter-value="${opt.value}">
                ${opt.label}(${opt.count})
              </button>
            `).join('')}
          </div>
        </div>

        <div class="filter-group">
          <span class="filter-label">状态:</span>
          <div class="filter-buttons">
            ${statusOptions.map(opt => `
              <button class="filter-btn ${filter.statuses?.includes(opt.value) ? 'active' : ''}"
                      data-filter-type="status"
                      data-filter-value="${opt.value}">
                ${opt.label}(${opt.count})
              </button>
            `).join('')}
          </div>
        </div>

        <div class="filter-group">
          <span class="filter-label">IDP:</span>
          <div class="filter-buttons">
            ${idpOptions.map(opt => `
              <button class="filter-btn ${filter.idps?.includes(opt.value) ? 'active' : ''}"
                      data-filter-type="idp"
                      data-filter-value="${opt.value}">
                ${opt.label}(${opt.count})
              </button>
            `).join('')}
          </div>
        </div>

        ${emailDomainOptions.length > 0 ? `
          <div class="filter-group">
            <span class="filter-label">邮箱后缀:</span>
            <div class="filter-buttons">
              ${emailDomainOptions.map(opt => `
                <button class="filter-btn ${filter.emailDomains?.includes(opt.value) ? 'active' : ''}"
                        data-filter-type="emailDomain"
                        data-filter-value="${opt.value}">
                  @${opt.label}(${opt.count})
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="filter-group">
          <span class="filter-label">卖出:</span>
          <div class="filter-buttons">
            <button class="filter-btn ${filter.showSoldOnly === true ? 'active' : ''}"
                    data-filter-type="sold"
                    data-filter-value="only">
              仅已卖出(${soldCount})
            </button>
            <button class="filter-btn ${filter.showSoldOnly === false ? 'active' : ''}"
                    data-filter-type="sold"
                    data-filter-value="exclude">
              排除已卖出
            </button>
          </div>
        </div>
      </div>

      <div class="filter-row">
        <div class="filter-group">
          <span class="filter-label">使用量:</span>
          <div class="filter-range">
            <input type="number" min="0" max="100" placeholder="最小" class="filter-input"
                   id="usage-min" value="${filter.usageMin !== undefined ? filter.usageMin * 100 : ''}">
            <span class="filter-separator">-</span>
            <input type="number" min="0" max="100" placeholder="最大" class="filter-input"
                   id="usage-max" value="${filter.usageMax !== undefined ? filter.usageMax * 100 : ''}">
            <span class="filter-unit">%</span>
          </div>
        </div>

        <div class="filter-group">
          <span class="filter-label">剩余:</span>
          <div class="filter-range">
            <input type="number" min="0" placeholder="最小" class="filter-input"
                   id="days-min" value="${filter.daysRemainingMin || ''}">
            <span class="filter-separator">-</span>
            <input type="number" min="0" placeholder="最大" class="filter-input"
                   id="days-max" value="${filter.daysRemainingMax || ''}">
            <span class="filter-unit">天</span>
          </div>
        </div>
      </div>

      <div class="filter-row">
        <div class="filter-group">
          <span class="filter-label">导入时间:</span>
          <div class="filter-buttons">
            <button class="filter-btn ${filter.enableImportDateFilter ? 'active' : ''}"
                    data-filter-type="importDateEnabled"
                    data-filter-value="toggle">
              ${filter.enableImportDateFilter ? '已启用' : '未启用'}
            </button>
          </div>
          <div class="filter-range">
            <input type="datetime-local" placeholder="开始时间" class="filter-input filter-datetime-input"
                   id="import-date-start" value="${formatDateTimeInput(filter.importDateStart)}">
            <span class="filter-separator">-</span>
            <input type="datetime-local" placeholder="结束时间" class="filter-input filter-datetime-input"
                   id="import-date-end" value="${formatDateTimeInput(filter.importDateEnd)}">
          </div>
        </div>
      </div>

      <div class="filter-row">
        <div class="filter-group">
          <span class="filter-label">导出时间:</span>
          <div class="filter-buttons">
            <button class="filter-btn ${filter.enableExportDateFilter ? 'active' : ''}"
                    data-filter-type="exportDateEnabled"
                    data-filter-value="toggle">
              ${filter.enableExportDateFilter ? '已启用' : '未启用'}
            </button>
          </div>
          <div class="filter-range">
            <input type="datetime-local" placeholder="开始时间" class="filter-input filter-datetime-input"
                   id="export-date-start" value="${formatDateTimeInput(filter.exportDateStart)}">
            <span class="filter-separator">-</span>
            <input type="datetime-local" placeholder="结束时间" class="filter-input filter-datetime-input"
                   id="export-date-end" value="${formatDateTimeInput(filter.exportDateEnd)}">
          </div>
        </div>
      </div>

      <div class="filter-row">
        <div class="filter-group">
          <span class="filter-label">导出状态:</span>
          <div class="filter-buttons">
            <button class="filter-btn ${filter.showExportedOnly === true ? 'active' : ''}"
                    data-filter-type="exported"
                    data-filter-value="only">
              仅已导出
            </button>
            <button class="filter-btn ${filter.showExportedOnly === false ? 'active' : ''}"
                    data-filter-type="exported"
                    data-filter-value="exclude">
              排除已导出
            </button>
          </div>
        </div>
      </div>
    </div>
  `
}
