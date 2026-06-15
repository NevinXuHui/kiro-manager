/**
 * 性能优化方案 - 账号列表分页加载
 *
 * 问题分析：
 * 1. 3067个账号一次性渲染导致约15万个DOM节点
 * 2. 每次状态变化都全量重渲染
 * 3. 定时器（5秒）触发频繁的全局刷新
 *
 * 优化策略：
 * - 分页加载：初始只渲染前50个，滚动加载更多
 * - 防抖渲染：合并连续的状态更新
 * - 局部更新：单个账号变化时只更新对应卡片
 */

export class PaginatedRenderer {
  private allAccounts: any[] = []
  private renderedCount: number = 0
  private pageSize: number = 50
  private isLoading: boolean = false
  private container: HTMLElement | null = null
  private observer: IntersectionObserver | null = null

  constructor(pageSize: number = 50) {
    this.pageSize = pageSize
  }

  /**
   * 初始化分页渲染
   */
  init(container: HTMLElement, accounts: any[], renderFn: (account: any, isSelected: boolean) => string, selectedIds: Set<string>) {
    this.container = container
    this.allAccounts = accounts
    this.renderedCount = 0

    // 清空容器
    container.innerHTML = ''

    // 渲染第一页
    this.renderPage(renderFn, selectedIds)

    // 创建加载更多的触发器
    this.setupIntersectionObserver(renderFn, selectedIds)
  }

  /**
   * 渲染一页数据
   */
  private renderPage(renderFn: (account: any, isSelected: boolean) => string, selectedIds: Set<string>) {
    if (!this.container || this.isLoading) return

    const start = this.renderedCount
    const end = Math.min(start + this.pageSize, this.allAccounts.length)

    if (start >= this.allAccounts.length) return

    this.isLoading = true

    // 使用 requestAnimationFrame 分批渲染，避免阻塞UI
    requestAnimationFrame(() => {
      const fragment = document.createDocumentFragment()
      const tempDiv = document.createElement('div')

      for (let i = start; i < end; i++) {
        const account = this.allAccounts[i]
        const isSelected = selectedIds.has(account.id)
        tempDiv.innerHTML = renderFn(account, isSelected)

        const element = tempDiv.firstElementChild
        if (element) {
          fragment.appendChild(element.cloneNode(true))
        }
      }

      this.container!.appendChild(fragment)
      this.renderedCount = end

      // 添加加载指示器
      this.updateLoadingIndicator()

      this.isLoading = false

      // 触发事件通知外部重新绑定事件
      this.container!.dispatchEvent(new CustomEvent('page-rendered', {
        detail: { start, end, total: this.allAccounts.length }
      }))
    })
  }

  /**
   * 设置 Intersection Observer 监听滚动到底部
   */
  private setupIntersectionObserver(renderFn: (account: any, isSelected: boolean) => string, selectedIds: Set<string>) {
    // 创建一个加载触发器元素
    const trigger = document.createElement('div')
    trigger.className = 'pagination-trigger'
    trigger.style.height = '1px'
    this.container?.appendChild(trigger)

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.isLoading && this.renderedCount < this.allAccounts.length) {
          this.renderPage(renderFn, selectedIds)
        }
      })
    }, {
      root: null,
      rootMargin: '200px', // 提前200px开始加载
      threshold: 0.1
    })

    this.observer.observe(trigger)
  }

  /**
   * 更新加载指示器
   */
  private updateLoadingIndicator() {
    if (!this.container) return

    // 移除旧的指示器
    const oldIndicator = this.container.querySelector('.load-more-indicator')
    if (oldIndicator) {
      oldIndicator.remove()
    }

    // 如果还有更多数据，显示指示器
    if (this.renderedCount < this.allAccounts.length) {
      const indicator = document.createElement('div')
      indicator.className = 'load-more-indicator'
      indicator.style.cssText = `
        padding: 20px;
        text-align: center;
        color: var(--text-tertiary);
        font-size: 13px;
      `
      indicator.innerHTML = `
        <div style="display: inline-flex; align-items: center; gap: 8px;">
          <svg class="spinner" width="16" height="16" viewBox="0 0 50 50" style="animation: spin 1s linear infinite;">
            <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="4" stroke-dasharray="31.4 31.4" stroke-linecap="round"></circle>
          </svg>
          <span>加载中... (${this.renderedCount}/${this.allAccounts.length})</span>
        </div>
      `
      this.container.appendChild(indicator)
    } else {
      // 所有数据加载完成
      const indicator = document.createElement('div')
      indicator.className = 'load-complete-indicator'
      indicator.style.cssText = `
        padding: 20px;
        text-align: center;
        color: var(--text-tertiary);
        font-size: 13px;
      `
      indicator.textContent = `已加载全部 ${this.allAccounts.length} 个账号`
      this.container.appendChild(indicator)
    }
  }

  /**
   * 更新数据源（用于筛选、搜索等）
   */
  updateAccounts(accounts: any[], renderFn: (account: any, isSelected: boolean) => string, selectedIds: Set<string>) {
    this.allAccounts = accounts
    this.renderedCount = 0

    if (this.container) {
      this.container.innerHTML = ''
      this.renderPage(renderFn, selectedIds)
      this.setupIntersectionObserver(renderFn, selectedIds)
    }
  }

  /**
   * 销毁
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
  }
}

// 添加旋转动画的样式
const style = document.createElement('style')
style.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
`
document.head.appendChild(style)
