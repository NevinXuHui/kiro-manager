/**
 * 虚拟滚动管理器
 * 只渲染可见区域的账号卡片，大幅提升大量数据的渲染性能
 */

export class VirtualScroller {
  private container: HTMLElement
  private items: any[]
  private renderItem: (item: any, index: number) => string
  private itemHeight: number
  private viewportHeight: number
  private visibleStart: number = 0
  private visibleEnd: number = 0
  private scrollTop: number = 0
  private scrollContainer: HTMLElement | null = null
  private contentContainer: HTMLElement | null = null
  private bufferSize: number = 5 // 上下额外渲染的项目数

  constructor(
    container: HTMLElement,
    items: any[],
    renderItem: (item: any, index: number) => string,
    itemHeight: number = 200 // 默认卡片高度
  ) {
    this.container = container
    this.items = items
    this.renderItem = renderItem
    this.itemHeight = itemHeight
    this.viewportHeight = window.innerHeight - 200 // 减去工具栏高度
  }

  /**
   * 初始化虚拟滚动
   */
  init() {
    const totalHeight = this.items.length * this.itemHeight

    this.container.innerHTML = `
      <div class="virtual-scroll-container" style="height: ${this.viewportHeight}px; overflow-y: auto; position: relative;">
        <div class="virtual-scroll-spacer" style="height: ${totalHeight}px; position: relative;">
          <div class="virtual-scroll-content" style="position: absolute; top: 0; left: 0; right: 0;"></div>
        </div>
      </div>
    `

    this.scrollContainer = this.container.querySelector('.virtual-scroll-container')
    this.contentContainer = this.container.querySelector('.virtual-scroll-content')

    if (this.scrollContainer) {
      this.scrollContainer.addEventListener('scroll', this.handleScroll.bind(this))
    }

    // 初始渲染
    this.updateVisibleItems()
  }

  /**
   * 处理滚动事件
   */
  private handleScroll() {
    if (!this.scrollContainer) return

    const newScrollTop = this.scrollContainer.scrollTop

    // 只有滚动超过一定距离才重新渲染
    if (Math.abs(newScrollTop - this.scrollTop) > this.itemHeight / 2) {
      this.scrollTop = newScrollTop
      this.updateVisibleItems()
    }
  }

  /**
   * 计算可见范围
   */
  private calculateVisibleRange(): { start: number; end: number } {
    const start = Math.floor(this.scrollTop / this.itemHeight)
    const visibleCount = Math.ceil(this.viewportHeight / this.itemHeight)
    const end = start + visibleCount

    // 添加缓冲区
    return {
      start: Math.max(0, start - this.bufferSize),
      end: Math.min(this.items.length, end + this.bufferSize)
    }
  }

  /**
   * 更新可见项目
   */
  private updateVisibleItems() {
    if (!this.contentContainer) return

    const { start, end } = this.calculateVisibleRange()

    // 如果范围没有变化，跳过渲染
    if (start === this.visibleStart && end === this.visibleEnd) {
      return
    }

    this.visibleStart = start
    this.visibleEnd = end

    // 渲染可见项目
    const visibleItems = this.items.slice(start, end)
    const itemsHtml = visibleItems
      .map((item, i) => this.renderItem(item, start + i))
      .join('')

    this.contentContainer.innerHTML = itemsHtml
    this.contentContainer.style.transform = `translateY(${start * this.itemHeight}px)`

    // 触发自定义事件，通知外部重新绑定事件
    this.container.dispatchEvent(new CustomEvent('virtual-scroll-render', {
      detail: { start, end }
    }))
  }

  /**
   * 更新数据源
   */
  updateItems(items: any[]) {
    this.items = items
    const totalHeight = this.items.length * this.itemHeight

    const spacer = this.container.querySelector('.virtual-scroll-spacer') as HTMLElement
    if (spacer) {
      spacer.style.height = `${totalHeight}px`
    }

    this.updateVisibleItems()
  }

  /**
   * 滚动到指定索引
   */
  scrollToIndex(index: number) {
    if (!this.scrollContainer) return

    const targetScrollTop = index * this.itemHeight
    this.scrollContainer.scrollTop = targetScrollTop
  }

  /**
   * 销毁虚拟滚动
   */
  destroy() {
    if (this.scrollContainer) {
      this.scrollContainer.removeEventListener('scroll', this.handleScroll.bind(this))
    }
  }
}
