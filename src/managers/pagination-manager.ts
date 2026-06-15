/**
 * 账号列表分页管理器
 * 处理大量账号时的性能优化
 */

import { PaginatedRenderer } from '../utils/paginated-renderer'
import { renderAccountCard, renderAccountListItem } from '../renderers/account-card'
import type { Account } from '../types'

let currentRenderer: PaginatedRenderer | null = null

/**
 * 初始化账号列表的分页渲染
 */
export function initPaginatedAccountList(
  container: HTMLElement,
  accounts: Account[],
  selectedIds: Set<string>,
  viewMode: 'grid' | 'list',
  onPageRendered: () => void
) {
  // 检查是否需要分页
  const gridElement = container.querySelector('#account-grid') as HTMLElement
  if (!gridElement) return

  const usePagination = gridElement.dataset.usePagination === 'true'
  if (!usePagination) {
    console.log('[分页] 账号数量较少，使用常规渲染')
    return
  }

  console.log(`[分页] 启用分页渲染，总账号数: ${accounts.length}`)

  // 销毁旧的渲染器
  if (currentRenderer) {
    currentRenderer.destroy()
  }

  // 创建新的分页渲染器
  currentRenderer = new PaginatedRenderer(50) // 每页50个

  // 定义渲染函数
  const renderFn = (account: Account, isSelected: boolean) => {
    return viewMode === 'grid'
      ? renderAccountCard(account, isSelected)
      : renderAccountListItem(account, isSelected)
  }

  // 初始化渲染
  currentRenderer.init(gridElement, accounts, renderFn, selectedIds)

  // 监听分页渲染完成事件
  gridElement.addEventListener('page-rendered', ((e: CustomEvent) => {
    const { start, end, total } = e.detail
    console.log(`[分页] 已渲染 ${end}/${total} 个账号 (${start}-${end})`)

    // 通知外部重新绑定事件
    onPageRendered()
  }) as EventListener)
}

/**
 * 更新分页数据（用于筛选、搜索等）
 */
export function updatePaginatedAccountList(
  container: HTMLElement,
  accounts: Account[],
  selectedIds: Set<string>,
  viewMode: 'grid' | 'list',
  onPageRendered: () => void
) {
  const gridElement = container.querySelector('#account-grid') as HTMLElement
  if (!gridElement || !currentRenderer) return

  const usePagination = gridElement.dataset.usePagination === 'true'
  if (!usePagination) return

  console.log(`[分页] 更新数据，新账号数: ${accounts.length}`)

  const renderFn = (account: Account, isSelected: boolean) => {
    return viewMode === 'grid'
      ? renderAccountCard(account, isSelected)
      : renderAccountListItem(account, isSelected)
  }

  currentRenderer.updateAccounts(accounts, renderFn, selectedIds)

  // 重新绑定事件监听
  gridElement.addEventListener('page-rendered', (() => {
    onPageRendered()
  }) as EventListener)
}

/**
 * 销毁分页渲染器
 */
export function destroyPaginatedRenderer() {
  if (currentRenderer) {
    currentRenderer.destroy()
    currentRenderer = null
    console.log('[分页] 渲染器已销毁')
  }
}
