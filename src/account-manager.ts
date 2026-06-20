import type { Account } from './types'
import { accountStore } from './store'
import { renderCurrentAccount } from './renderers/current-account'
import { renderAccountsView } from './renderers/accounts-view'
import { renderSettingsView, attachSettingsEvents } from './renderers/settings-view'
import { renderMachineIdView } from './renderers/machine-id-view'
import { initMachineIdPage } from './handlers/machine-id-events'
import { showExportDialog } from './dialogs/export-dialog'
import { attachTitlebarEvents } from './handlers/titlebar-events'
import { attachAccountsEvents } from './handlers/accounts-events'
import { attachAccountCardEvents } from './handlers/account-card-events'
import { toggleSelection, updateSelectionUI } from './managers/selection-manager'
import {
  autoImportCurrentAccount,
  handleAccountAction
} from './services/account-service'
import { autoRefreshService } from './services/auto-refresh-service'
import { REPOSITORY_URL, updateService, type UpdateInfo } from './services/update-service'
import logoSvg from './assets/logo.svg'
import kiroIconSvg from './assets/kiro-icon.svg'

const ACCOUNT_PAGE_SIZE_KEY = 'account_page_size'
const DEFAULT_ACCOUNT_PAGE_SIZE = 50
const ACCOUNT_PAGE_SIZE_OPTIONS = [20, 50, 100, 200]

export class AccountManager {
  private container: HTMLElement
  private selectedIds: Set<string> = new Set()
  private isFilterExpanded: boolean = false
  private unsubscribe: (() => void) | null = null
  private syncInterval: NodeJS.Timeout | null = null
  private accountCurrentPage: number = 1
  private accountPageSize: number = DEFAULT_ACCOUNT_PAGE_SIZE
  private lastFilterKey: string = ''

  constructor(container: HTMLElement) {
    this.container = container
    this.accountPageSize = this.loadAccountPageSize()
  }

  private loadAccountPageSize(): number {
    const saved = Number(localStorage.getItem(ACCOUNT_PAGE_SIZE_KEY))
    return ACCOUNT_PAGE_SIZE_OPTIONS.includes(saved) ? saved : DEFAULT_ACCOUNT_PAGE_SIZE
  }

  private getFilterKey(): string {
    return JSON.stringify(accountStore.getFilter())
  }

  private getAccountTotalPages(): number {
    return Math.max(1, Math.ceil(accountStore.getFilteredAccounts().length / this.accountPageSize))
  }

  private normalizeAccountPage() {
    this.accountCurrentPage = Math.min(Math.max(1, this.accountCurrentPage), this.getAccountTotalPages())
  }

  async init() {
    await accountStore.loadAccounts()

    // 同步本地激活账号
    await accountStore.syncActiveAccountFromLocal()

    this.lastFilterKey = this.getFilterKey()
    this.unsubscribe = accountStore.subscribe(() => {
      const nextFilterKey = this.getFilterKey()
      if (nextFilterKey !== this.lastFilterKey) {
        this.accountCurrentPage = 1
        this.lastFilterKey = nextFilterKey
      }

      this.normalizeAccountPage()
      this.renderContent()
      // 账号数据或激活状态变化时更新当前账号显示
      this.updateCurrentAccountDisplay()
    })

    // 监听单个账号更新事件
    window.addEventListener('account-updated', this.handleAccountUpdate.bind(this))

    // 监听账号删除事件（优化性能，避免全量重渲染）
    window.addEventListener('account-deleted', this.handleAccountDelete.bind(this))

    // 监听批量删除事件（性能优化）
    window.addEventListener('accounts-batch-deleted', this.handleBatchDelete.bind(this))

    // 启动时自动导入当前活跃账号
    await this.autoImportCurrentAccount()

    // 初始化并启动自动刷新服务
    autoRefreshService.loadConfig()
    const config = autoRefreshService.getConfig()
    if (config.enabled) {
      autoRefreshService.start()
    }

    // 定期同步本地激活账号（每5秒检查一次）
    this.syncInterval = setInterval(() => {
      accountStore.syncActiveAccountFromLocal()
    }, 5000)
  }

  private updateCurrentAccountDisplay() {
    const activeAccountId = accountStore.getActiveAccountId()
    if (activeAccountId) {
      const accounts = accountStore.getAccounts()
      const activeAccount = accounts.find(a => a.id === activeAccountId)
      this.renderCurrentAccount(activeAccount || null)
    } else {
      this.renderCurrentAccount(null)
    }
  }

  private async autoImportCurrentAccount() {
    await autoImportCurrentAccount(
      (account) => this.renderCurrentAccount(account)
    )
  }

  private renderCurrentAccount(account?: Account | null) {
    renderCurrentAccount(this.container, account)
  }

  // 处理批量账号删除（性能优化：一次性移除所有DOM节点）
  private handleBatchDelete(event: Event) {
    const customEvent = event as CustomEvent<{ accountIds: string[] }>
    const { accountIds } = customEvent.detail

    console.log(`[批量删除] 开始删除 ${accountIds.length} 个账号`)

    // 只在账号管理视图时处理
    const activeView = this.container.querySelector('.sidebar-link.active')?.getAttribute('data-view')
    if (activeView !== 'accounts') return

    accountIds.forEach(accountId => this.selectedIds.delete(accountId))
    this.normalizeAccountPage()
    this.renderContent()
  }

  public destroy() {
    if (this.unsubscribe) {
      this.unsubscribe()
    }
    // 移除账号更新监听器
    window.removeEventListener('account-updated', this.handleAccountUpdate.bind(this))
    // 移除账号删除监听器
    window.removeEventListener('account-deleted', this.handleAccountDelete.bind(this))
    // 移除批量删除监听器
    window.removeEventListener('accounts-batch-deleted', this.handleBatchDelete.bind(this))
    // 停止自动刷新服务
    autoRefreshService.stop()
    // 清除同步定时器
    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }
  }

  // 处理单个账号更新
  private handleAccountUpdate(event: Event) {
    const customEvent = event as CustomEvent<{ accountId: string }>
    const { accountId } = customEvent.detail

    // 只在账号管理视图时更新
    const activeView = this.container.querySelector('.sidebar-link.active')?.getAttribute('data-view')
    if (activeView !== 'accounts') return

    // 查找对应的账号卡片
    const cardElement = this.container.querySelector(`[data-account-id="${accountId}"]`)
    if (!cardElement) return

    // 获取更新后的账号数据
    const accounts = accountStore.getAccounts()
    const account = accounts.find(a => a.id === accountId)
    if (!account) return

    // 获取当前选中状态
    const isSelected = this.selectedIds.has(accountId)

    // 获取当前视图模式
    const settings = accountStore.getSettings()
    const viewMode = settings.viewMode

    // 重新渲染单个卡片
    import('./renderers/account-card').then(({ renderAccountCard, renderAccountListItem }) => {
      const newCardHtml = viewMode === 'grid'
        ? renderAccountCard(account, isSelected)
        : renderAccountListItem(account, isSelected)

      // 替换卡片内容
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = newCardHtml
      const newCard = tempDiv.firstElementChild

      if (newCard) {
        cardElement.replaceWith(newCard)
        // 重新绑定事件
        this.attachAccountCardEvents()
      }
    })
  }

  // 处理单个账号删除（性能优化：直接移除DOM节点，避免全量重渲染）
  private handleAccountDelete(event: Event) {
    const customEvent = event as CustomEvent<{ accountId: string }>
    const { accountId } = customEvent.detail

    console.log('[删除账号] 账号已删除:', accountId)

    // 只在账号管理视图时处理
    const activeView = this.container.querySelector('.sidebar-link.active')?.getAttribute('data-view')
    if (activeView !== 'accounts') return

    this.selectedIds.delete(accountId)
    this.normalizeAccountPage()
    this.renderContent()
  }

  public render() {
    const settings = accountStore.getSettings()
    const logoSrc = settings.customLogoPath || logoSvg
    const sidebarTitle = settings.sidebarTitle || 'Kiro Manager'
    
    this.container.innerHTML = `
      <div class="titlebar" data-tauri-drag-region>
        <div class="titlebar-left">
          <div class="titlebar-title">Kiro Manager</div>
        </div>
        <div class="titlebar-right">
          <button class="titlebar-button" id="minimize-btn" title="最小化">
            <svg viewBox="0 0 12 12" width="12" height="12">
              <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
            </svg>
          </button>
          <button class="titlebar-button close" id="close-btn" title="关闭">
            <svg viewBox="0 0 12 12" width="12" height="12">
              <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            </svg>
          </button>
        </div>
      </div>
      <div class="app-body">
        <div class="sidebar">
          <div class="sidebar-header">
            ${settings.showSidebarLogo ? `<img src="${logoSrc}" alt="Logo" class="sidebar-logo" />` : ''}
            <h1 class="sidebar-title">${sidebarTitle}</h1>
          </div>
          <nav class="sidebar-nav">
            <button class="sidebar-link active" data-view="accounts">
              <svg class="sidebar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>账号管理</span>
            </button>
            <button class="sidebar-link" data-view="machine-id">
              <svg class="sidebar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
              </svg>
              <span>机器码管理</span>
            </button>
            <button class="sidebar-link" data-view="proxy">
              <svg class="sidebar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
              </svg>
              <span>API 反代</span>
            </button>
            <button class="sidebar-link" data-view="chat">
              <svg class="sidebar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              <span>AI 对话</span>
            </button>
            <button class="sidebar-link" data-view="kiro-settings">
              <img src="${kiroIconSvg}" alt="Kiro" class="sidebar-icon" style="width: 20px; height: 20px;" />
              <span>Kiro 设置</span>
            </button>
            <button class="sidebar-link" data-view="settings">
              <svg class="sidebar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>设置</span>
            </button>
            <button class="sidebar-link" data-view="about">
              <svg class="sidebar-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>关于</span>
            </button>
          </nav>
          <div class="sidebar-footer">
            <div class="sidebar-footer-tools">
              <button class="sidebar-theme-button" id="sidebar-theme-switch" title="切换深色模式" aria-label="切换深色模式">
                <svg class="sidebar-theme-icon sidebar-theme-icon-sun" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="4"></circle>
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
                </svg>
                <svg class="sidebar-theme-icon sidebar-theme-icon-moon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                </svg>
              </button>
            </div>
            <div class="current-account-card" id="current-account-card">
              <div class="current-account-loading">加载中...</div>
            </div>
          </div>
        </div>
        <div class="main-content">
          <div id="content-area"></div>
        </div>
      </div>
    `

    this.attachTitlebarEvents()
    this.attachSidebarThemeEvents()
    this.renderContent()
    // DOM 渲染完成后更新当前账号显示
    this.updateCurrentAccountDisplay()
  }

  private attachTitlebarEvents() {
    attachTitlebarEvents(this.container, () => this.renderContent())
  }

  private attachSidebarThemeEvents() {
    const themeButton = this.container.querySelector('#sidebar-theme-switch') as HTMLButtonElement | null
    if (!themeButton) return

    const getCurrentTheme = () => {
      if (window.UI?.theme?.get) return window.UI.theme.get()
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    }

    const syncThemeButton = () => {
      const isDark = getCurrentTheme() === 'dark'
      themeButton.classList.toggle('is-dark', isDark)
      themeButton.title = isDark ? '切换浅色模式' : '切换深色模式'
      themeButton.setAttribute('aria-label', themeButton.title)
    }

    syncThemeButton()
    themeButton.addEventListener('click', () => {
      if (window.UI?.theme?.toggle) {
        window.UI.theme.toggle()
      } else {
        const nextDark = !document.documentElement.classList.contains('dark')
        document.documentElement.classList.toggle('dark', nextDark)
        localStorage.setItem('ui-theme', nextDark ? 'dark' : 'light')
      }

      const isDark = getCurrentTheme() === 'dark'
      syncThemeButton()
      const settingsThemeSwitch = document.querySelector('#theme-switch') as HTMLInputElement | null
      if (settingsThemeSwitch) settingsThemeSwitch.checked = isDark
    })
  }

  private renderContent() {
    const contentArea = this.container.querySelector('#content-area')
    if (!contentArea) return

    const activeView = this.container.querySelector('.sidebar-link.active')?.getAttribute('data-view') || 'accounts'

    if (activeView === 'accounts') {
      this.renderAccountsView(contentArea)
    } else if (activeView === 'machine-id') {
      this.renderMachineIdView(contentArea)
    } else if (activeView === 'kiro-settings') {
      this.renderKiroSettingsView(contentArea)
    } else if (activeView === 'proxy') {
      this.renderProxyView(contentArea)
    } else if (activeView === 'chat') {
      this.renderChatView(contentArea)
    } else if (activeView === 'settings') {
      this.renderSettingsView(contentArea)
    } else if (activeView === 'about') {
      this.renderAboutView(contentArea)
    }
  }

  private renderAccountsView(container: Element) {
    const settings = accountStore.getSettings()
    this.normalizeAccountPage()

    container.innerHTML = renderAccountsView(
      this.selectedIds,
      this.isFilterExpanded,
      settings.viewMode,
      {
        currentPage: this.accountCurrentPage,
        pageSize: this.accountPageSize
      }
    )

    this.attachAccountsEvents()
    this.attachPaginationEvents()
  }

  private async renderSettingsView(container: Element) {
    const html = await renderSettingsView()
    container.innerHTML = html
    attachSettingsEvents(container)
  }

  private renderAboutView(container: Element) {
    container.innerHTML = `
      <div style="max-width: 640px; margin: 0 auto; padding: 40px 24px;">
        <!-- Logo + 名称 -->
        <div style="text-align: center; margin-bottom: 40px;">
          <div style="width: 80px; height: 80px; margin: 0 auto 16px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(99, 102, 241, 0.3);">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="white" stroke-width="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <h1 style="font-size: 28px; font-weight: 800; margin-bottom: 4px; background: linear-gradient(135deg, #6366f1, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">Kiro 账号管理器</h1>
          <p style="color: var(--text-tertiary); font-size: 13px; letter-spacing: 1px;">VERSION 2.0.6</p>
        </div>

        <!-- 简介 -->
        <p style="text-align: center; color: var(--text-secondary); font-size: 14px; line-height: 1.8; margin-bottom: 32px; padding: 0 20px;">
          一站式 Kiro 账号管理工具，支持批量导入、刷新验活、一键切换、Overages 超额管理、API 反向代理等功能。
        </p>

        <!-- 技术栈 -->
        <div style="display: flex; justify-content: center; gap: 8px; flex-wrap: wrap; margin-bottom: 32px;">
          <span style="padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; background: rgba(99, 102, 241, 0.1); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.2);">Tauri 2.0</span>
          <span style="padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; background: rgba(59, 130, 246, 0.1); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.2);">TypeScript</span>
          <span style="padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; background: rgba(234, 88, 12, 0.1); color: #ea580c; border: 1px solid rgba(234, 88, 12, 0.2);">Rust</span>
          <span style="padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2);">Vite</span>
          <span style="padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 500; background: rgba(139, 92, 246, 0.1); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.2);">Tailwind</span>
        </div>

        <!-- 信息卡片 -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 24px;">
          <!-- GitHub -->
          <a href="#" id="about-github-link" style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--bg-sidebar); border: 1px solid var(--border-color); border-radius: 12px; text-decoration: none; color: inherit; transition: all 0.2s; cursor: pointer;">
            <div style="width: 36px; height: 36px; border-radius: 10px; background: #24292e; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            </div>
            <div>
              <div style="font-size: 13px; font-weight: 600;">GitHub</div>
              <div style="font-size: 11px; color: var(--text-tertiary);">NeuraLabHQ/kiro-manager</div>
            </div>
          </a>

          <!-- QQ 群 -->
          <div style="display: flex; align-items: center; gap: 12px; padding: 16px; background: var(--bg-sidebar); border: 1px solid var(--border-color); border-radius: 12px;">
            <div style="width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #12b7f5, #0099ff); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M12.003 2c-5.523 0-9.997 4.477-9.997 10 0 2.136.67 4.116 1.81 5.74L2 22l4.453-1.764A9.95 9.95 0 0012.003 22c5.523 0 9.997-4.477 9.997-10s-4.474-10-9.997-10z"/></svg>
            </div>
            <div>
              <div style="font-size: 13px; font-weight: 600;">QQ 交流群</div>
              <div style="font-size: 14px; font-weight: 700; color: var(--primary); user-select: all;">1090339570</div>
            </div>
          </div>
        </div>

        <!-- 检查更新 -->
        <div style="text-align: center; margin-top: 32px;">
          <button class="ui-btn ui-btn-primary" id="check-update-btn" style="padding: 10px 32px; border-radius: 10px; font-weight: 600;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; vertical-align: -2px;">
              <path d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9"/>
            </svg>
            检查更新
          </button>
        </div>

        <!-- 底部 -->
        <div style="text-align: center; margin-top: 32px; color: var(--text-tertiary); font-size: 12px;">
          Built with Tauri + Rust + TypeScript
        </div>
      </div>
    `

    container.querySelector('#about-github-link')?.addEventListener('click', (e) => {
      e.preventDefault()
      updateService.openRepository().catch((error) => {
        console.error('[关于] 打开仓库失败:', error)
        window.UI?.toast.error('打开仓库失败: ' + (error as Error).message)
      })
    })

    const checkUpdateBtn = container.querySelector('#check-update-btn')
    if (checkUpdateBtn) {
      checkUpdateBtn.addEventListener('click', () => this.handleCheckUpdate(checkUpdateBtn as HTMLButtonElement))
    }
  }

  private async handleCheckUpdate(button: HTMLButtonElement) {
    const originalHtml = button.innerHTML
    button.disabled = true
    button.innerHTML = '正在检查...'
    window.UI?.toast.info('正在检查更新...')

    try {
      const updateInfo = await updateService.checkForUpdates()
      this.showUpdateModal(updateInfo)
    } catch (error) {
      console.error('[更新] 检查失败:', error)
      window.UI?.toast.error('检查更新失败: ' + (error as Error).message)
    } finally {
      button.disabled = false
      button.innerHTML = originalHtml
    }
  }

  private showUpdateModal(updateInfo: UpdateInfo) {
    const asset = updateService.pickInstallAsset(updateInfo.assets)
    const releaseNotes = this.formatReleaseNotes(updateInfo.releaseNotes)
    const statusTitle = updateInfo.hasUpdate ? '发现新版本' : '当前已是最新版本'
    const statusDesc = updateInfo.hasUpdate
      ? `当前版本 ${this.escapeHtml(updateInfo.currentVersion)}，最新版本 ${this.escapeHtml(updateInfo.latestVersion)}`
      : `当前版本 ${this.escapeHtml(updateInfo.currentVersion)}，无需更新`
    const assetHtml = asset
      ? `
        <div style="padding: 12px; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-sidebar);">
          <div style="font-size: 13px; font-weight: 700; margin-bottom: 4px;">${this.escapeHtml(asset.name)}</div>
          <div style="font-size: 12px; color: var(--text-tertiary);">${updateService.formatAssetSize(asset.size)}</div>
        </div>
      `
      : '<div style="font-size: 13px; color: var(--text-tertiary);">该版本没有可下载的安装包资产。</div>'

    window.downloadKiroUpdate = async () => {
      if (!asset) return

      const downloadButton = document.querySelector('#download-update-btn') as HTMLButtonElement | null
      const originalText = downloadButton?.textContent || '下载并安装'
      if (downloadButton) {
        downloadButton.disabled = true
        downloadButton.textContent = '正在下载...'
      }

      try {
        const filePath = await updateService.downloadUpdateAsset(asset)
        window.UI?.toast.success('安装包已下载并启动: ' + filePath)
      } catch (error) {
        console.error('[更新] 下载失败:', error)
        window.UI?.toast.error('下载更新失败: ' + (error as Error).message)
      } finally {
        if (downloadButton) {
          downloadButton.disabled = false
          downloadButton.textContent = originalText
        }
      }
    }

    window.UI?.modal.open({
      title: '软件更新',
      size: 'lg',
      html: `
        <div class="modal-form">
          <div style="display: flex; flex-direction: column; gap: 16px;">
            <div style="padding: 16px; border-radius: 12px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.16);">
              <div style="font-size: 16px; font-weight: 800; margin-bottom: 6px;">${statusTitle}</div>
              <div style="font-size: 13px; color: var(--text-secondary);">${statusDesc}</div>
              <div style="font-size: 12px; color: var(--text-tertiary); margin-top: 8px;">更新源：${this.escapeHtml(REPOSITORY_URL)}</div>
            </div>

            ${updateInfo.hasUpdate ? assetHtml : ''}

            <div>
              <div style="font-size: 13px; font-weight: 700; margin-bottom: 8px;">更新说明</div>
              <div style="max-height: 220px; overflow: auto; white-space: pre-wrap; line-height: 1.7; padding: 12px; border-radius: 10px; background: var(--bg-sidebar); border: 1px solid var(--border-color); color: var(--text-secondary); font-size: 12px;">${releaseNotes}</div>
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 8px;">
              <button class="ui-btn ui-btn-secondary" onclick="window.UI?.modal.closeAll()">关闭</button>
              ${updateInfo.hasUpdate && asset ? '<button class="ui-btn ui-btn-primary" id="download-update-btn" onclick="window.downloadKiroUpdate()">下载并安装</button>' : ''}
            </div>
          </div>
        </div>
      `,
      onClose: () => {
        delete window.downloadKiroUpdate
      }
    })
  }

  private formatReleaseNotes(notes: string) {
    const trimmed = notes.trim()
    if (!trimmed) return '暂无更新说明'

    const shortNotes = trimmed.length > 1600
      ? `${trimmed.slice(0, 1600)}\n\n...`
      : trimmed

    return this.escapeHtml(shortNotes)
  }

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  private renderMachineIdView(container: Element) {
    container.innerHTML = renderMachineIdView()
    // 初始化机器码页面
    initMachineIdPage()
  }

  private renderKiroSettingsView(container: Element) {
    import('./renderers/kiro-settings-view').then(({ renderKiroSettingsView, initKiroSettingsPage }) => {
      container.innerHTML = renderKiroSettingsView()
      initKiroSettingsPage(container as HTMLElement)
    })
  }

  private renderProxyView(container: Element) {
    import('./renderers/proxy-view').then(({ renderProxyView, initProxyPage }) => {
      container.innerHTML = renderProxyView()
      initProxyPage(container as HTMLElement)
    })
  }

  private renderChatView(container: Element) {
    import('./renderers/chat-view').then(({ renderChatView, initChatPage }) => {
      container.innerHTML = renderChatView()
      initChatPage(container as HTMLElement)
      
      // 监听页面切换事件
      const switchHandler = (e: Event) => {
        const customEvent = e as CustomEvent<{ page: string }>
        if (customEvent.detail.page === 'config') {
          // 切换到配置页面
          import('./renderers/chat-config-view').then(({ renderChatConfigView, attachChatConfigEvents }) => {
            container.innerHTML = renderChatConfigView()
            attachChatConfigEvents(
              container as HTMLElement,
              () => {
                // 保存后返回对话页面
                container.innerHTML = renderChatView()
                initChatPage(container as HTMLElement)
              },
              () => {
                // 返回对话页面
                container.innerHTML = renderChatView()
                initChatPage(container as HTMLElement)
              }
            )
          })
        }
      }
      
      window.addEventListener('switch-chat-page', switchHandler)
      
      // 清理事件监听器
      const cleanup = () => {
        window.removeEventListener('switch-chat-page', switchHandler)
      }
      
      // 保存清理函数（可选，用于页面卸载时清理）
      ;(container as any).__chatCleanup = cleanup
    })
  }

  private attachAccountsEvents() {
    attachAccountsEvents(
      this.container,
      this.selectedIds,
      () => this.handleFilterToggle(),
      (mode) => this.handleViewModeChange(mode),
      () => this.handleExport(),
      () => this.updateAccountList(),
      () => this.updateSelectionUI(),
      () => this.attachAccountCardEvents()
    )
  }

  private attachAccountCardEvents() {
    attachAccountCardEvents(
      this.container,
      (accountId) => this.toggleSelection(accountId),
      (accountId, action) => this.handleAccountAction(accountId, action)
    )
  }

  private handleFilterToggle() {
    this.isFilterExpanded = !this.isFilterExpanded
    this.renderContent()
  }

  private handleViewModeChange(mode: 'grid' | 'list') {
    accountStore.setViewMode(mode)
    this.renderContent()
  }

  private toggleSelection(accountId: string) {
    toggleSelection(accountId, this.selectedIds, () => this.updateSelectionUI())
  }

  private updateSelectionUI() {
    updateSelectionUI(this.container, this.selectedIds)
  }

  private updateAccountList() {
    const searchInput = this.container.querySelector('#search-input') as HTMLInputElement | null
    const cursorPosition = searchInput?.selectionStart ?? searchInput?.value.length ?? 0
    const contentArea = this.container.querySelector('#content-area')
    if (!contentArea) return

    this.accountCurrentPage = 1
    this.renderAccountsView(contentArea)

    requestAnimationFrame(() => {
      const nextSearchInput = this.container.querySelector('#search-input') as HTMLInputElement | null
      if (!nextSearchInput) return

      const nextCursorPosition = Math.min(cursorPosition, nextSearchInput.value.length)
      nextSearchInput.focus()
      nextSearchInput.setSelectionRange(nextCursorPosition, nextCursorPosition)
    })
  }

  private attachPaginationEvents() {
    const pageButtons = this.container.querySelectorAll('[data-pagination-page]')
    pageButtons.forEach(button => {
      button.addEventListener('click', () => {
        const page = Number((button as HTMLElement).dataset.paginationPage)
        this.setAccountPage(page)
      })
    })

    const actionButtons = this.container.querySelectorAll('[data-pagination-action]')
    actionButtons.forEach(button => {
      button.addEventListener('click', () => {
        const action = (button as HTMLElement).dataset.paginationAction
        this.handlePaginationAction(action)
      })
    })

    const pageSizeSelect = this.container.querySelector('#account-page-size') as HTMLSelectElement | null
    pageSizeSelect?.addEventListener('change', () => {
      const pageSize = Number(pageSizeSelect.value)
      if (!ACCOUNT_PAGE_SIZE_OPTIONS.includes(pageSize)) return

      this.accountPageSize = pageSize
      this.accountCurrentPage = 1
      localStorage.setItem(ACCOUNT_PAGE_SIZE_KEY, String(pageSize))
      this.renderContent()
      this.scrollAccountsToTop()
    })

    const jumpInput = this.container.querySelector('#account-page-jump') as HTMLInputElement | null
    jumpInput?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return
      event.preventDefault()
      this.jumpToInputPage()
    })
  }

  private handlePaginationAction(action?: string) {
    if (!action) return

    const totalPages = this.getAccountTotalPages()
    if (action === 'first') {
      this.setAccountPage(1)
    } else if (action === 'prev') {
      this.setAccountPage(this.accountCurrentPage - 1)
    } else if (action === 'next') {
      this.setAccountPage(this.accountCurrentPage + 1)
    } else if (action === 'last') {
      this.setAccountPage(totalPages)
    } else if (action === 'jump') {
      this.jumpToInputPage()
    }
  }

  private jumpToInputPage() {
    const input = this.container.querySelector('#account-page-jump') as HTMLInputElement | null
    if (!input) return

    this.setAccountPage(Number(input.value))
  }

  private setAccountPage(page: number) {
    if (!Number.isFinite(page)) return

    const totalPages = this.getAccountTotalPages()
    const nextPage = Math.min(Math.max(1, Math.floor(page)), totalPages)
    if (nextPage === this.accountCurrentPage) return

    this.accountCurrentPage = nextPage
    this.renderContent()
    this.scrollAccountsToTop()
  }

  private scrollAccountsToTop() {
    const mainContent = this.container.querySelector('.main-content') as HTMLElement | null
    mainContent?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  private async handleAccountAction(accountId: string, action: string) {
    await handleAccountAction(
      accountId,
      action,
      this.selectedIds
    )
  }

  private handleExport() {
    const accounts = accountStore.getAccounts()
    const selectedAccounts = this.selectedIds.size > 0
      ? accounts.filter(a => this.selectedIds.has(a.id))
      : accounts

    if (selectedAccounts.length === 0) {
      window.UI?.toast.warning('没有可导出的账号')
      return
    }

    showExportDialog(selectedAccounts, this.selectedIds.size)
  }
}

declare global {
  interface Window {
    UI?: {
      toast: {
        show: (message: string) => void
        success: (message: string) => void
        error: (message: string) => void
        warning: (message: string) => void
        info: (message: string) => void
      }
      modal: {
        open: (options: {
          title: string
          content?: string
          html?: string
          size?: 'default' | 'lg' | 'xl'
          closable?: boolean
          showClose?: boolean
          footer?: string
          onClose?: () => void
        }) => any
        close: (modal?: any) => void
        closeAll: () => void
      }
      theme: {
        get: () => string
        toggle: () => void
      }
    }
    closeAddAccountModal?: () => void
    submitAddAccount?: () => void
    closeEditAccountModal?: () => void
    submitEditAccount?: () => void
    selectEditIdp?: (idp: string, displayName: string) => void
    switchImportMode?: (mode: 'single' | 'batch') => void
    selectRegion?: (region: string, displayText: string) => void
    selectLoginType?: (type: string) => void
    selectSocialProvider?: (provider: string) => void
    closeExportDialog?: () => void
    submitExport?: () => void
    closeAccountDetailModal?: () => void
    copyAccountJson?: () => void
    
    // MCP 服务器对话框
    closeMcpServerDialog?: () => void
    submitMcpServer?: () => void
    
    // Steering 文件对话框
    closeSteeringFileDialog?: () => void
    submitSteeringFile?: () => void
    
    // JSON 编辑器对话框
    closeJsonEditorDialog?: () => void
    formatJson?: () => void
    submitJsonEditor?: () => void
    
    // 重命名对话框
    closeRenameDialog?: () => void
    submitRename?: () => void
    
    // 反代账号选择对话框
    selectAllProxyAccounts?: () => void
    deselectAllProxyAccounts?: () => void
    closeProxyAccountSelectDialog?: () => void
    confirmProxyAccountSelect?: () => void
    
    // 删除账号确认
    cancelDeleteAccount?: () => void
    confirmDeleteAccount?: () => void
    cancelBatchDelete?: () => void
    confirmBatchDelete?: () => void
    downloadKiroUpdate?: () => void
    
    // Kiro 设置页面函数
    selectAgentAutonomy?: (value: string) => void
    selectConfigureMcp?: (value: string) => void
    addMcpServer?: () => void
    editMcpServer?: (name: string) => void
    deleteMcpServer?: (name: string) => void
    openUserMcpConfig?: () => void
    openWorkspaceMcpConfig?: () => void
    createSteeringFile?: () => void
    editSteeringFile?: (filename: string) => void
    renameSteeringFile?: (filename: string) => void
    openSteeringFile?: (filename: string) => void
    deleteSteeringFile?: (filename: string) => void
    openSteeringFolder?: () => void
    addTrustedCommand?: () => void
    removeTrustedCommand?: (index: number) => void
    addDenyCommand?: () => void
    removeDenyCommand?: (index: number) => void
    addDefaultDenyCommands?: () => void
  }
}
