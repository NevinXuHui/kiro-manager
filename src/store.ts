// 简化的状态管理
import type { Account, AccountFilter, SubscriptionType, AccountStatus } from './types'

// 备注定义
interface AccountNote {
  id: string
  name: string
  color: string
}

// 设置配置接口
interface Settings {
  privacyMode: boolean // 隐私模式
  usagePrecision: boolean // 使用量精度显示
  showSidebarLogo: boolean // 显示侧边栏 Logo
  customLogoPath: string // 自定义 Logo 路径
  sidebarTitle: string // 侧边栏标题文本
  viewMode: 'grid' | 'list' // 显示视图模式
}

class AccountStore {
  private accounts: Account[] = []
  private listeners: Set<() => void> = new Set()
  private filter: AccountFilter = {}
  private activeAccountId: string | null = null
  private notes: AccountNote[] = []
  private settings: Settings = {
    privacyMode: false,
    usagePrecision: false,
    showSidebarLogo: true,
    customLogoPath: '',
    sidebarTitle: 'Kiro Manager',
    viewMode: 'grid'
  }

  async loadAccounts() {
    try {
      // 从 Tauri 后端加载
      const data = await (window as any).__TAURI__.core.invoke('load_accounts')
      if (data) {
        this.accounts = JSON.parse(data)
        this.notify()
      }
    } catch (error) {
      console.error('[Store] 加载账号失败:', error)
      // 降级到 localStorage
      const saved = localStorage.getItem('accounts')
      if (saved) {
        this.accounts = JSON.parse(saved)
        this.notify()
      }
    }

    // 加载设置
    const savedSettings = localStorage.getItem('settings')
    if (savedSettings) {
      this.settings = { ...this.settings, ...JSON.parse(savedSettings) }
    }

    // 加载备注
    const savedNotes = localStorage.getItem('account_notes')
    if (savedNotes) {
      this.notes = JSON.parse(savedNotes)
    } else {
      // 初始化默认备注
      this.notes = [
        { id: '1', name: '主力账号', color: '#3b82f6' },
        { id: '2', name: '备用账号', color: '#10b981' },
        { id: '3', name: '测试账号', color: '#f59e0b' },
        { id: '4', name: '已过期', color: '#ef4444' },
        { id: '5', name: '团队共享', color: '#8b5cf6' }
      ]
      this.saveNotes()
    }
  }

  async saveAccounts() {
    try {
      // 保存到 Tauri 后端
      await (window as any).__TAURI__.core.invoke('save_accounts', {
        data: JSON.stringify(this.accounts)
      })
    } catch (error) {
      console.error('[Store] 保存账号失败:', error)
      // 降级到 localStorage
      localStorage.setItem('accounts', JSON.stringify(this.accounts))
    }
  }
  
  private saveSettings() {
    localStorage.setItem('settings', JSON.stringify(this.settings))
  }

  getAccounts(): Account[] {
    return this.accounts
  }
  
  // 设置相关方法
  getSettings(): Settings {
    return { ...this.settings }
  }
  
  setPrivacyMode(enabled: boolean) {
    this.settings.privacyMode = enabled
    this.saveSettings()
    this.notify()
  }
  
  setUsagePrecision(enabled: boolean) {
    this.settings.usagePrecision = enabled
    this.saveSettings()
    this.notify()
  }
  
  setShowSidebarLogo(enabled: boolean) {
    this.settings.showSidebarLogo = enabled
    this.saveSettings()
    this.notify()
  }
  
  setCustomLogoPath(path: string) {
    this.settings.customLogoPath = path
    this.saveSettings()
    this.notify()
  }
  
  setSidebarTitle(title: string) {
    this.settings.sidebarTitle = title
    this.saveSettings()
    this.notify()
  }
  
  setViewMode(mode: 'grid' | 'list') {
    this.settings.viewMode = mode
    this.saveSettings()
    this.notify()
  }

  notifyAccountsChanged() {
    this.notify()
  }
  
  // 隐藏邮箱
  maskEmail(email: string): string {
    if (!this.settings.privacyMode || !email) return email
    
    // 生成固定的伪装邮箱
    const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    const fakeEmail = `user${hash % 10000}@example.com`
    return fakeEmail
  }
  
  // 隐藏昵称
  maskNickname(nickname: string | undefined): string {
    if (!this.settings.privacyMode || !nickname) return nickname || ''
    
    // 生成固定的伪装昵称
    const hash = nickname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return `User${hash % 10000}`
  }

  addAccount(account: Omit<Account, 'id' | 'createdAt' | 'isActive'>) {
    const newAccount: Account = {
      ...account,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      isActive: false
    }
    this.accounts.push(newAccount)
    this.saveAccounts()
    this.notify()
    return newAccount.id
  }

  updateAccount(id: string, updates: Partial<Account>) {
    const index = this.accounts.findIndex(a => a.id === id)
    if (index !== -1) {
      this.accounts[index] = { ...this.accounts[index], ...updates }
      this.saveAccounts()
      // 触发单个账号更新而不是全局通知
      this.notifyAccountUpdate(id)
    }
  }

  deleteAccount(id: string) {
    this.accounts = this.accounts.filter(a => a.id !== id)
    this.saveAccounts()
    // 触发账号删除事件，避免全量重渲染
    this.notifyAccountDelete(id)
  }

  // 批量删除账号（性能优化：一次性删除，只保存一次）
  batchDeleteAccounts(ids: string[]) {
    console.log(`[Store] 批量删除 ${ids.length} 个账号`)
    this.accounts = this.accounts.filter(a => !ids.includes(a.id))
    this.saveAccounts()
    // 触发批量删除事件
    const event = new CustomEvent('accounts-batch-deleted', { detail: { accountIds: ids } })
    window.dispatchEvent(event)
  }

  // 单个账号删除通知
  private notifyAccountDelete(accountId: string) {
    // 触发账号删除事件，让UI层直接移除DOM节点
    const event = new CustomEvent('account-deleted', { detail: { accountId } })
    window.dispatchEvent(event)
  }

  // 单个账号更新通知
  private notifyAccountUpdate(accountId: string) {
    // 触发账号卡片的局部更新
    const event = new CustomEvent('account-updated', { detail: { accountId } })
    window.dispatchEvent(event)
    
    // 仍然需要保存数据
    this.saveAccounts()
  }

  // 筛选相关方法
  getFilter(): AccountFilter {
    return this.filter
  }

  setFilter(filter: AccountFilter) {
    this.filter = filter
    this.notify()
  }

  clearFilter() {
    this.filter = {}
    this.notify()
  }

  getFilteredAccounts(): Account[] {
    let result = [...this.accounts]

    // 应用搜索筛选
    if (this.filter.search) {
      const search = this.filter.search.toLowerCase()
      result = result.filter(a =>
        a.email.toLowerCase().includes(search) ||
        a.nickname?.toLowerCase().includes(search) ||
        a.userId?.toLowerCase().includes(search) ||
        a.subscription?.title?.toLowerCase().includes(search) ||
        a.idp?.toLowerCase().includes(search)
      )
    }

    // 应用卖出状态筛选
    if (this.filter.showSoldOnly === true) {
      result = result.filter(a => a.isSold === true)
    } else if (this.filter.showSoldOnly === false) {
      result = result.filter(a => !a.isSold)
    }

    // 应用订阅类型筛选
    if (this.filter.subscriptionTypes?.length) {
      result = result.filter(a => this.filter.subscriptionTypes!.includes(a.subscription.type))
    }

    // 应用状态筛选
    if (this.filter.statuses?.length) {
      result = result.filter(a => this.filter.statuses!.includes(a.status))
    }

    // 应用登录方式筛选
    if (this.filter.idps?.length) {
      result = result.filter(a => this.filter.idps!.includes(a.idp))
    }

    // 应用使用量范围筛选
    if (this.filter.usageMin !== undefined) {
      result = result.filter(a => a.usage.percentUsed >= this.filter.usageMin!)
    }

    if (this.filter.usageMax !== undefined) {
      result = result.filter(a => a.usage.percentUsed <= this.filter.usageMax!)
    }

    // 应用剩余天数范围筛选
    if (this.filter.daysRemainingMin !== undefined) {
      result = result.filter(a =>
        a.subscription.daysRemaining !== undefined &&
        a.subscription.daysRemaining >= this.filter.daysRemainingMin!
      )
    }

    if (this.filter.daysRemainingMax !== undefined) {
      result = result.filter(a =>
        a.subscription.daysRemaining !== undefined &&
        a.subscription.daysRemaining <= this.filter.daysRemainingMax!
      )
    }

    // 应用导入日期范围筛选
    if (this.filter.importDateStart !== undefined) {
      result = result.filter(a => a.createdAt >= this.filter.importDateStart!)
    }

    if (this.filter.importDateEnd !== undefined) {
      result = result.filter(a => a.createdAt <= this.filter.importDateEnd!)
    }

    return result
  }

  getStats() {
    const bySubscription: Record<SubscriptionType, number> = {
      Free: 0,
      Pro: 0,
      Pro_Plus: 0,
      Enterprise: 0,
      Teams: 0
    }

    const byStatus: Record<AccountStatus, number> = {
      active: 0,
      expired: 0,
      error: 0,
      refreshing: 0,
      unknown: 0,
      suspended: 0
    }

    const byIdp: Record<string, number> = {}

    this.accounts.forEach(account => {
      bySubscription[account.subscription.type] = (bySubscription[account.subscription.type] || 0) + 1
      byStatus[account.status] = (byStatus[account.status] || 0) + 1
      byIdp[account.idp] = (byIdp[account.idp] || 0) + 1
    })

    return {
      total: this.accounts.length,
      bySubscription,
      byStatus,
      byIdp
    }
  }

  // 激活账号管理
  getActiveAccountId(): string | null {
    return this.activeAccountId
  }

  setActiveAccount(accountId: string | null) {
    this.activeAccountId = accountId
    this.notify()
  }

  // 根据 accessToken 查找并设置激活账号
  private syncInProgress = false
  async syncActiveAccountFromLocal() {
    // 防止并发执行
    if (this.syncInProgress) {
      return
    }

    this.syncInProgress = true
    try {
      const accessToken = await (window as any).__TAURI__.core.invoke('get_active_account')
      
      console.log('[Store] get_active_account 返回:', accessToken ? `token长度: ${accessToken.length}` : '无token')
      
      if (!accessToken) {
        // 没有本地激活账号
        if (this.activeAccountId !== null) {
          this.activeAccountId = null
          this.notify()
        }
        return
      }
      
      console.log('[Store] 开始匹配账号，当前账号数量:', this.accounts.length)
      console.log('[Store] 本地 token 前50字符:', accessToken.substring(0, 50))
      
      // 在账号列表中查找匹配的账号
      const matchedAccount = this.accounts.find(
        (account, index) => {
          console.log(`[Store] 检查账号 ${index + 1}: ${account.email}, token前50字符:`, account.credentials.accessToken?.substring(0, 50) || '无token')
          const match = account.credentials.accessToken === accessToken
          if (match) {
            console.log('[Store] ✓ 找到匹配账号:', account.email)
          }
          return match
        }
      )
      
      if (matchedAccount) {
        if (this.activeAccountId !== matchedAccount.id) {
          this.activeAccountId = matchedAccount.id
          this.notify()
          console.log('[Store] 同步本地激活账号:', matchedAccount.email)
        }
      } else {
        console.log('[Store] ✗ 未找到匹配的账号')
        // 本地有激活账号但列表中找不到
        if (this.activeAccountId !== null) {
          this.activeAccountId = null
          this.notify()
        }
      }
    } catch (error) {
      console.error('[Store] 同步本地激活账号失败:', error)
    } finally {
      this.syncInProgress = false
    }
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify() {
    this.listeners.forEach(listener => listener())
  }

  // 备注相关方法
  getNotes(): AccountNote[] {
    return [...this.notes]
  }

  addNote(name: string, color: string): string {
    const newNote: AccountNote = {
      id: crypto.randomUUID(),
      name,
      color
    }
    this.notes.push(newNote)
    this.saveNotes()
    return newNote.id
  }

  updateNote(id: string, updates: Partial<AccountNote>) {
    const index = this.notes.findIndex(n => n.id === id)
    if (index !== -1) {
      this.notes[index] = { ...this.notes[index], ...updates }
      this.saveNotes()
    }
  }

  deleteNote(id: string) {
    this.notes = this.notes.filter(n => n.id !== id)
    // 从所有账号中移除该备注
    this.accounts.forEach(account => {
      if (account.tags.includes(id)) {
        account.tags = account.tags.filter(t => t !== id)
      }
    })
    this.saveNotes()
    this.saveAccounts()
  }

  private saveNotes() {
    localStorage.setItem('account_notes', JSON.stringify(this.notes))
  }

  getNoteById(id: string): AccountNote | undefined {
    return this.notes.find(n => n.id === id)
  }
}

export const accountStore = new AccountStore()
