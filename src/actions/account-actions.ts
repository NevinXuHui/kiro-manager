// 账号操作模块
import type { Account } from '../types'
import { accountStore } from '../store'
import { openFloatingProgress } from '../utils/floating-progress'

function isSuspendedError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    message.includes('封禁') ||
    message.includes('暂停') ||
    normalized.includes('suspended') ||
    normalized.includes('access_denied')
  )
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return JSON.stringify(error) || '未知错误'
}

function isInvalidBearerError(error: unknown): boolean {
  const message = formatUnknownError(error).toLowerCase()
  return message.includes('bearer token') && message.includes('invalid')
}

function isOveragesEligible(account: Account): boolean {
  const planText = `${account.subscription.type || ''} ${account.subscription.title || ''} ${account.subscription.rawType || ''}`.toUpperCase()
  return (
    !planText.includes('FREE') &&
    (
      planText.includes('PRO') ||
      planText.includes('TEAM') ||
      planText.includes('ENTERPRISE') ||
      Boolean(account.subscription.overageCapability)
    )
  )
}

async function refreshAccountTokenForOverages(account: Account, showToasts: boolean): Promise<Account> {
  if (!account.credentials.refreshToken) return account

  try {
    if (showToasts) window.UI?.toast.info('正在刷新账号凭证...')
    await refreshTokenOnly(account)
    return accountStore.getAccounts().find(a => a.id === account.id) || account
  } catch (error) {
    console.warn('[Overages] 开通前刷新 Token 失败，继续尝试现有 Token:', error)
    return accountStore.getAccounts().find(a => a.id === account.id) || account
  }
}

function isOveragesEnabled(account: Account): boolean {
  return account.subscription.overageStatus === 'ENABLED' || account.usage.resourceDetail?.overageEnabled === true
}

function isProfileArn(value: string | undefined): value is string {
  return Boolean(value && value.startsWith('arn:aws:codewhisperer:'))
}

async function getLatestLocalProfileArn(): Promise<string> {
  try {
    const profileArn = await (window as any).__TAURI__.core.invoke('get_latest_kiro_profile_arn')
    return isProfileArn(profileArn) ? profileArn : ''
  } catch (error) {
    console.log('[Overages] 读取本机 profileArn 失败:', error)
    return ''
  }
}

async function isSameAsLocalActiveAccount(account: Account): Promise<boolean> {
  try {
    const localResult = await (window as any).__TAURI__.core.invoke('get_local_active_account')
    const localData = localResult?.success ? localResult.data : null
    return Boolean(
      localData?.refresh_token &&
      account.credentials.refreshToken &&
      localData.refresh_token === account.credentials.refreshToken
    )
  } catch {
    return false
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

async function getProfileArn(account: Account): Promise<string> {
  const subscription = account.subscription as Account['subscription'] & {
    profileArn?: string
    profile_arn?: string
  }
  const savedProfileArn = subscription.profileArn || subscription.profile_arn
  if (isProfileArn(savedProfileArn)) return savedProfileArn
  const isLocalActiveAccount = await isSameAsLocalActiveAccount(account)

  try {
    const localResult = await (window as any).__TAURI__.core.invoke('get_local_active_account')
    const localData = localResult?.success ? localResult.data : null
    const localProfileArn = localData?.profile_arn
    if (
      isProfileArn(localProfileArn) &&
      localData?.refresh_token &&
      localData.refresh_token === account.credentials.refreshToken
    ) {
      accountStore.updateAccount(account.id, {
        subscription: {
          ...account.subscription,
          profileArn: localProfileArn
        }
      })
      return localProfileArn
    }
  } catch (error) {
    console.log('[Overages] 读取本地 profileArn 缓存失败:', error)
  }

  const activeAccessToken = await (window as any).__TAURI__.core.invoke('get_active_account')
  if (isLocalActiveAccount || (activeAccessToken && activeAccessToken === account.credentials.accessToken)) {
    const activeProfileArn = await getLatestLocalProfileArn()
    if (isProfileArn(activeProfileArn)) {
      accountStore.updateAccount(account.id, {
        subscription: {
          ...account.subscription,
          profileArn: activeProfileArn
        }
      })
      return activeProfileArn
    }
  }

  if (account.credentials.refreshToken) {
    try {
      const fetchedArn = await (window as any).__TAURI__.core.invoke('fetch_profile_arn', {
        refreshToken: account.credentials.refreshToken
      })
      if (isProfileArn(fetchedArn)) {
        accountStore.updateAccount(account.id, {
          subscription: {
            ...account.subscription,
            profileArn: fetchedArn
          }
        })
        return fetchedArn
      }
    } catch (error) {
      console.log('[Overages] fetch_profile_arn 失败:', error)
    }
  }

  const DEFAULT_PROFILE_ARN = 'arn:aws:codewhisperer:us-east-1:638616132270:profile/AAAACCCCXXXX'
  return DEFAULT_PROFILE_ARN
}

interface EnableOveragesOptions {
  confirm?: boolean
  showToasts?: boolean
  refreshAfter?: boolean
  overageStatus?: 'ENABLED' | 'DISABLED'
}

/**
 * 刷新账号信息
 */
export async function refreshAccount(account: Account, silent: boolean = false): Promise<void> {
  if (!account.credentials.refreshToken) {
    if (!silent) window.UI?.toast.error('账号缺少刷新凭证')
    throw new Error('账号缺少刷新凭证')
  }

  if (!silent) window.UI?.toast.info(`正在刷新账号: ${account.email}`)

  try {
    const result = await (window as any).__TAURI__.core.invoke('verify_account_credentials', {
      refreshToken: account.credentials.refreshToken,
      clientId: account.credentials.clientId || '',
      clientSecret: account.credentials.clientSecret || '',
      region: account.credentials.region || 'us-east-1'
    })

    if (result.success && result.data) {
      console.log('[刷新] profile_arn from backend:', result.data.profile_arn)
      const now = Date.now()
      accountStore.updateAccount(account.id, {
        userId: result.data.user_id,
        credentials: {
          ...account.credentials,
          accessToken: result.data.access_token,
          refreshToken: result.data.refresh_token,
          expiresAt: now + (result.data.expires_in || 3600) * 1000
        },
        subscription: {
          type: result.data.subscription_type,
          title: result.data.subscription_title,
          rawType: result.data.raw_type,
          profileArn: result.data.profile_arn || account.subscription.profileArn,
          upgradeCapability: result.data.upgrade_capability,
          overageCapability: result.data.overage_capability,
          overageStatus: result.data.overage_status || account.subscription.overageStatus,
          managementTarget: result.data.management_target,
          daysRemaining: result.data.days_remaining
        },
        usage: {
          current: result.data.usage.current,
          limit: result.data.usage.limit,
          percentUsed: result.data.usage.limit > 0 ? result.data.usage.current / result.data.usage.limit : 0,
          lastUpdated: now,
          nextResetDate: result.data.usage.nextResetDate,
          baseLimit: result.data.usage.baseLimit,
          baseCurrent: result.data.usage.baseCurrent,
          freeTrialLimit: result.data.usage.freeTrialLimit,
          freeTrialCurrent: result.data.usage.freeTrialCurrent,
          freeTrialExpiry: result.data.usage.freeTrialExpiry,
          resourceDetail: result.data.usage.resourceDetail
        },
        status: 'active',
        lastError: undefined,
        lastUsedAt: now
      })

      if (!silent) window.UI?.toast.success('账号刷新成功')
      } else {
        // 根据错误类型设置状态
        const errorMsg = result.error || '刷新失败'
        const isSuspended = isSuspendedError(errorMsg)

      accountStore.updateAccount(account.id, {
        status: isSuspended ? 'suspended' : 'error',
        lastError: errorMsg
      })

      // 如果账号被封禁，删除机器码绑定
      if (isSuspended) {
        try {
          const { removeAccountBinding } = await import('../handlers/machine-id-storage')
          removeAccountBinding(account.id)
          console.log(`[账号刷新] 账号 ${account.email} 已封禁，已删除机器码绑定`)
        } catch (error) {
          console.error('[账号刷新] 删除机器码绑定失败:', error)
        }
      }

      // 只抛出错误，不显示 toast（由调用方决定是否显示）
      throw new Error(errorMsg)
    }
  } catch (error) {
    // 只抛出错误，不显示 toast（由调用方决定是否显示）
    throw error
  }
}

/**
 * 刷新账号但不保存到数据库（用于批量操作）
 * 返回需要更新的字段
 */
async function refreshAccountWithoutSave(account: Account): Promise<Partial<Account>> {
  if (!account.credentials.refreshToken) {
    throw new Error('账号缺少刷新凭证')
  }

  const result = await (window as any).__TAURI__.core.invoke('verify_account_credentials', {
    refreshToken: account.credentials.refreshToken,
    clientId: account.credentials.clientId || '',
    clientSecret: account.credentials.clientSecret || '',
    region: account.credentials.region || 'us-east-1'
  })

  if (result.success && result.data) {
    console.log('[刷新] profile_arn from backend:', result.data.profile_arn)
    const now = Date.now()
    return {
      userId: result.data.user_id,
      credentials: {
        ...account.credentials,
        accessToken: result.data.access_token,
        refreshToken: result.data.refresh_token,
        expiresAt: now + (result.data.expires_in || 3600) * 1000
      },
      subscription: {
        type: result.data.subscription_type,
        title: result.data.subscription_title,
        rawType: result.data.raw_type,
        profileArn: result.data.profile_arn || account.subscription.profileArn,
        upgradeCapability: result.data.upgrade_capability,
        overageCapability: result.data.overage_capability,
        overageStatus: result.data.overage_status || account.subscription.overageStatus,
        managementTarget: result.data.management_target,
        daysRemaining: result.data.days_remaining
      },
      usage: {
        current: result.data.usage.current,
        limit: result.data.usage.limit,
        percentUsed: result.data.usage.limit > 0 ? result.data.usage.current / result.data.usage.limit : 0,
        lastUpdated: now,
        nextResetDate: result.data.usage.nextResetDate,
        baseLimit: result.data.usage.baseLimit,
        baseCurrent: result.data.usage.baseCurrent,
        freeTrialLimit: result.data.usage.freeTrialLimit,
        freeTrialCurrent: result.data.usage.freeTrialCurrent,
        freeTrialExpiry: result.data.usage.freeTrialExpiry,
        resourceDetail: result.data.usage.resourceDetail
      },
      status: 'active',
      lastError: undefined,
      lastUsedAt: now
    }
  } else {
    // 根据错误类型设置状态
    const errorMsg = result.error || '刷新失败'
    const isSuspended = isSuspendedError(errorMsg)

    // 如果账号被封禁，删除机器码绑定
    if (isSuspended) {
      try {
        const { removeAccountBinding } = await import('../handlers/machine-id-storage')
        removeAccountBinding(account.id)
        console.log(`[账号刷新] 账号 ${account.email} 已封禁，已删除机器码绑定`)
      } catch (error) {
        console.error('[账号刷新] 删除机器码绑定失败:', error)
      }
    }

    throw new Error(errorMsg)
  }
}

/**
 * 只刷新 Token（不更新账号信息）
 */
export async function refreshTokenOnly(account: Account): Promise<void> {
  if (!account.credentials.refreshToken) {
    throw new Error('账号缺少刷新凭证')
  }

  try {
    const result = await (window as any).__TAURI__.core.invoke('verify_account_credentials', {
      refreshToken: account.credentials.refreshToken,
      clientId: account.credentials.clientId || '',
      clientSecret: account.credentials.clientSecret || '',
      region: account.credentials.region || 'us-east-1'
    })

    if (result.success && result.data) {
      const now = Date.now()
      const updatePayload: any = {
        credentials: {
          ...account.credentials,
          accessToken: result.data.access_token,
          refreshToken: result.data.refresh_token,
          expiresAt: now + (result.data.expires_in || 3600) * 1000
        },
        status: 'active',
        lastError: undefined
      }
      if (result.data.profile_arn) {
        updatePayload.subscription = {
          ...account.subscription,
          profileArn: result.data.profile_arn
        }
      }
      accountStore.updateAccount(account.id, updatePayload)
    } else {
      const errorMsg = result.error || '刷新失败'
      const isSuspended = isSuspendedError(errorMsg)

      accountStore.updateAccount(account.id, {
        status: isSuspended ? 'suspended' : 'error',
        lastError: errorMsg
      })

      // 如果账号被封禁，删除机器码绑定
      if (isSuspended) {
        try {
          const { removeAccountBinding } = await import('../handlers/machine-id-storage')
          removeAccountBinding(account.id)
          console.log(`[Token刷新] 账号 ${account.email} 已封禁，已删除机器码绑定`)
        } catch (error) {
          console.error('[Token刷新] 删除机器码绑定失败:', error)
        }
      }

      throw new Error(errorMsg)
    }
  } catch (error) {
    throw error
  }
}

/**
 * 为 Pro 及以上账号开通 Overages 超额配置
 */
export async function enableOveragesForAccount(account: Account, options: EnableOveragesOptions = {}): Promise<boolean> {
  const { confirm = true, showToasts = true, refreshAfter = true, overageStatus = 'ENABLED' } = options
  const isDisabling = overageStatus === 'DISABLED'

  if (!isOveragesEligible(account)) {
    if (showToasts) window.UI?.toast.warning('Overages 仅 Pro 及以上套餐可用')
    return false
  }

  if (account.status !== 'active') {
    if (showToasts) window.UI?.toast.warning('仅正常账号可开通 Overages')
    return false
  }

  if (!isDisabling && isOveragesEnabled(account)) {
    if (showToasts) window.UI?.toast.info('Overages 已开通')
    return true
  }

  if (confirm) {
    const confirmMsg = isDisabling
      ? `确定为 ${account.email} 关闭 Overages 超额配置吗？`
      : `确定为 ${account.email} 开通 Overages 超额配置吗？`
    const confirmed = window.confirm(confirmMsg)
    if (!confirmed) return false
  }

  let currentAccount = await refreshAccountTokenForOverages(account, showToasts)
  const tokenExpiresSoon = !currentAccount.credentials.accessToken ||
    (currentAccount.credentials.expiresAt && currentAccount.credentials.expiresAt - Date.now() < 2 * 60 * 1000)

  if (tokenExpiresSoon && currentAccount.credentials.refreshToken) {
    if (showToasts) window.UI?.toast.info('Token 即将过期，先刷新账号凭证')
    await refreshTokenOnly(currentAccount)
    currentAccount = accountStore.getAccounts().find(a => a.id === account.id) || currentAccount
  }

  let profileArn = await getProfileArn(currentAccount)
  console.log('[Overages] getProfileArn 结果:', profileArn, '账号subscription:', JSON.stringify((currentAccount.subscription as any)?.profileArn))
  if (!profileArn && currentAccount.credentials.refreshToken) {
    if (showToasts) window.UI?.toast.info('尝试通过完整刷新获取 profileArn...')
    try {
      await refreshAccount(currentAccount, true)
      currentAccount = accountStore.getAccounts().find(a => a.id === account.id) || currentAccount
      profileArn = await getProfileArn(currentAccount)
      console.log('[Overages] 刷新后 getProfileArn 结果:', profileArn)
    } catch (e) {
      console.log('[Overages] 刷新失败:', e)
    }
  }
  if (!profileArn) {
    const message = '缺少该账号自己的 profileArn，无法直接开通 Overages。请导入包含 profileArn 的账号数据，或先在 Kiro 登录这个账号后再开通。'
    if (showToasts) window.UI?.toast.error(message)
    throw new Error(message)
  }

  if (!currentAccount.credentials.accessToken) {
    if (showToasts) window.UI?.toast.error('缺少 Access Token，请先刷新账号')
    throw new Error('缺少 Access Token')
  }

  if (showToasts) window.UI?.toast.info(isDisabling ? '正在关闭 Overages...' : '正在开通 Overages...')
  const invokeEnableOverages = () => (window as any).__TAURI__.core.invoke('enable_overages', {
    accessToken: currentAccount.credentials.accessToken,
    profileArn,
    region: currentAccount.credentials.region || 'us-east-1',
    overageStatus
  })

  let result = await invokeEnableOverages()

  if (!result.success) {
    const error = new Error(result.error || '开通 Overages 失败')
    if (isInvalidBearerError(error) && currentAccount.credentials.refreshToken) {
      if (showToasts) window.UI?.toast.info('Token 已失效，刷新后重试开通...')
      await refreshTokenOnly(currentAccount)
      currentAccount = accountStore.getAccounts().find(a => a.id === account.id) || currentAccount
      result = await invokeEnableOverages()
    }

    if (!result.success) {
      if (isInvalidBearerError(result.error || '')) {
        const latestLocalProfileArn = await getLatestLocalProfileArn()
        const sameLocalAccount = await isSameAsLocalActiveAccount(currentAccount)
        if (latestLocalProfileArn && latestLocalProfileArn === profileArn && !sameLocalAccount) {
          accountStore.updateAccount(currentAccount.id, {
            subscription: {
              ...currentAccount.subscription,
              profileArn: undefined
            }
          })
          throw new Error('该账号的 profileArn 与 Token 不匹配，已清除错误缓存。请导入该账号自己的 profileArn，或先在 Kiro 登录这个账号后再开通。')
        }
      }
      throw new Error(result.error || '开通 Overages 失败')
    }
  }

  accountStore.updateAccount(currentAccount.id, {
    subscription: {
      ...currentAccount.subscription,
      overageStatus: 'ENABLED'
    }
  })

  if (showToasts) window.UI?.toast.success('Overages 已开通')

  if (refreshAfter) {
    try {
      await refreshAccount(currentAccount, true)
      accountStore.notifyAccountsChanged()
    } catch (error) {
      console.warn('[Overages] 开通后刷新账号失败:', error)
    }
  }

  return true
}

/**
 * 删除账号
 */
export async function deleteAccount(accountId: string, onDelete?: (accountId: string) => void): Promise<void> {
  const accounts = accountStore.getAccounts()
  const account = accounts.find(a => a.id === accountId)
  if (!account) return

  // 检查是否为当前激活账号
  const activeAccountId = accountStore.getActiveAccountId()
  const isActiveAccount = activeAccountId === accountId
  
  // 使用应用内模态框
  const message = isActiveAccount
    ? `账号 ${account.email} 是当前激活账号，删除后需要重新登录。确定要删除吗？`
    : `确定要删除账号 ${account.email} 吗？`
  
  const modal = window.UI?.modal.open({
    title: '确认删除',
    html: `
      <div style="padding: 24px;">
        <p style="margin: 0; color: var(--text-main); font-size: 14px;">${message}</p>
      </div>
    `,
    footer: `
      <button class="ui-btn ui-btn-secondary" onclick="window.cancelDeleteAccount()">取消</button>
      <button class="ui-btn ui-btn-danger" onclick="window.confirmDeleteAccount()">删除</button>
    `
  })
  
  // 注册全局函数
  ;(window as any).cancelDeleteAccount = () => {
    window.UI?.modal.close(modal)
    delete (window as any).cancelDeleteAccount
    delete (window as any).confirmDeleteAccount
  }
  
  ;(window as any).confirmDeleteAccount = async () => {
    window.UI?.modal.close(modal)
    delete (window as any).cancelDeleteAccount
    delete (window as any).confirmDeleteAccount
    
    // 如果是激活账号，先退出登录
    if (isActiveAccount) {
      try {
        await (window as any).__TAURI__.core.invoke('logout_account')
        await accountStore.syncActiveAccountFromLocal()
      } catch (error) {
        console.error('[删除账号] 退出登录失败:', error)
      }
    }
    
    accountStore.deleteAccount(accountId)
    if (onDelete) {
      onDelete(accountId)
    }
    window.UI?.toast.success('账号已删除')
  }
}

/**
 * 批量检查账号状态
 */
export async function handleBatchCheck(selectedIds: Set<string>): Promise<void> {
  const selectedAccounts = accountStore.getAccounts().filter(a => selectedIds.has(a.id))

  if (selectedAccounts.length === 0) {
    window.UI?.toast.warning('请先选择要检查的账号')
    return
  }


  window.UI?.toast.info(`正在检查 ${selectedAccounts.length} 个账号状态...`)

  let successCount = 0
  let failedCount = 0
  let completedCount = 0
  const checkProgress = openFloatingProgress({
    id: 'batch-check',
    title: '正在检查账号状态',
    total: selectedAccounts.length,
    detail: `0/${selectedAccounts.length} 已完成`
  })

  // 并发控制：每次最多10个并发请求（后端 ListAvailableModels + GetUsageLimits 已并发）
  const batchSize = 10
  for (let i = 0; i < selectedAccounts.length; i += batchSize) {
    const batch = selectedAccounts.slice(i, i + batchSize)
    await Promise.all(batch.map(async (account) => {
      try {
        if (!account.credentials.refreshToken) {
          failedCount++
          accountStore.updateAccount(account.id, { status: 'error', lastError: '缺少凭证信息' })
          return
        }

        // 只验证凭证是否有效，不更新详细信息
        const result = await (window as any).__TAURI__.core.invoke('verify_account_credentials', {
          refreshToken: account.credentials.refreshToken,
          clientId: account.credentials.clientId || '',
          clientSecret: account.credentials.clientSecret || '',
          region: account.credentials.region || 'us-east-1'
        })

        if (result.success && result.data) {
          const now = Date.now()
          accountStore.updateAccount(account.id, {
            email: result.data.email,
            userId: result.data.user_id,
            credentials: {
              ...account.credentials,
              accessToken: result.data.access_token,
              refreshToken: result.data.refresh_token,
              expiresAt: now + (result.data.expires_in || 3600) * 1000
            },
            subscription: {
              type: result.data.subscription_type,
              title: result.data.subscription_title,
              rawType: result.data.raw_type,
              profileArn: result.data.profile_arn || account.subscription.profileArn,
              upgradeCapability: result.data.upgrade_capability,
              overageCapability: result.data.overage_capability,
              overageStatus: result.data.overage_status || account.subscription.overageStatus,
              managementTarget: result.data.management_target,
              daysRemaining: result.data.days_remaining
            },
            usage: {
              current: result.data.usage.current,
              limit: result.data.usage.limit,
              percentUsed: result.data.usage.limit > 0 ? result.data.usage.current / result.data.usage.limit : 0,
              lastUpdated: now,
              nextResetDate: result.data.usage.nextResetDate,
              baseLimit: result.data.usage.baseLimit,
              baseCurrent: result.data.usage.baseCurrent,
              freeTrialLimit: result.data.usage.freeTrialLimit,
              freeTrialCurrent: result.data.usage.freeTrialCurrent,
              freeTrialExpiry: result.data.usage.freeTrialExpiry,
              resourceDetail: result.data.usage.resourceDetail
            },
            status: 'active',
            lastError: undefined
          })
          successCount++
        } else {
          const errorMsg = result.error || '验证失败'
          const isSuspended = isSuspendedError(errorMsg)

          accountStore.updateAccount(account.id, {
            status: isSuspended ? 'suspended' : 'error',
            lastError: errorMsg
          })

          // 如果账号被封禁，删除机器码绑定
          if (isSuspended) {
            try {
              const { removeAccountBinding } = await import('../handlers/machine-id-storage')
              removeAccountBinding(account.id)
              console.log(`[批量检查] 账号 ${account.email} 已封禁，已删除机器码绑定`)
            } catch (error) {
              console.error('[批量检查] 删除机器码绑定失败:', error)
            }
          }

          failedCount++
        }
      } catch (error) {
        accountStore.updateAccount(account.id, {
          status: 'error',
          lastError: (error as Error).message
        })
        failedCount++
      } finally {
        completedCount++
        checkProgress.update({
          completed: completedCount,
          total: selectedAccounts.length,
          detail: `正常 ${successCount} 个，异常 ${failedCount} 个`
        })
      }
    }))
  }

  if (failedCount === 0) {
    checkProgress.finish(`检查完成：${successCount} 个账号状态正常`, 'success')
    window.UI?.toast.success(`检查完成：${successCount} 个账号状态正常`)
  } else {
    checkProgress.finish(`检查完成：${successCount} 个正常，${failedCount} 个异常`, 'warning')
    window.UI?.toast.warning(`检查完成：${successCount} 个正常，${failedCount} 个异常`)
  }

  accountStore.notifyAccountsChanged()
}

/**
 * 批量刷新账号
 */
export async function handleBatchRefresh(selectedIds: Set<string>): Promise<void> {
  const selectedAccounts = accountStore.getAccounts().filter(a => selectedIds.has(a.id))

  if (selectedAccounts.length === 0) {
    window.UI?.toast.warning('请先选择要刷新的账号')
    return
  }


  window.UI?.toast.info(`正在刷新 ${selectedAccounts.length} 个账号...`)

  let successCount = 0
  let failedCount = 0
  let completedCount = 0
  let startedCount = 0
  const refreshProgress = openFloatingProgress({
    id: 'batch-refresh',
    title: '正在刷新账号',
    total: selectedAccounts.length,
    detail: `0/${selectedAccounts.length} 已完成`
  })

  // 收集所有更新，最后批量保存
  const accountUpdates: Array<{ id: string; updates: Partial<Account> }> = []

  // 并发过高时首批请求会同时卡住，进度看起来像无响应；降低并发并给单账号加超时。
  const batchSize = 4
  for (let i = 0; i < selectedAccounts.length; i += batchSize) {
    const batch = selectedAccounts.slice(i, i + batchSize)
    await Promise.all(batch.map(async (account) => {
      startedCount++
      refreshProgress.update({
        completed: completedCount,
        total: selectedAccounts.length,
        detail: `正在处理 ${startedCount}/${selectedAccounts.length}，已完成 ${completedCount}`
      })

      try {
        // 使用不保存到数据库的版本
        const updates = await withTimeout(
          refreshAccountWithoutSave(account),
          45_000,
          `刷新超时: ${account.email || account.nickname || account.id}`
        )
        accountUpdates.push({ id: account.id, updates })
        successCount++
      } catch (error) {
        accountUpdates.push({
          id: account.id,
          updates: {
            status: 'error',
            lastError: formatUnknownError(error)
          }
        })
        failedCount++
      } finally {
        completedCount++
        refreshProgress.update({
          completed: completedCount,
          total: selectedAccounts.length,
          detail: `成功 ${successCount} 个，失败 ${failedCount} 个，处理中 ${Math.max(0, startedCount - completedCount)} 个`
        })
      }
    }))
  }

  // 批量保存所有更新（只保存一次）
  if (accountUpdates.length > 0) {
    console.log(`[批量刷新] 批量保存 ${accountUpdates.length} 个账号更新`)
    accountStore.batchUpdateAccounts(accountUpdates)
  }

  if (failedCount === 0) {
    refreshProgress.finish(`刷新完成：${successCount} 个账号已更新`, 'success')
    window.UI?.toast.success(`刷新完成：${successCount} 个账号已更新`)
  } else {
    refreshProgress.finish(`刷新完成：${successCount} 个成功，${failedCount} 个失败`, 'warning')
    window.UI?.toast.warning(`刷新完成：${successCount} 个成功，${failedCount} 个失败`)
  }

  accountStore.notifyAccountsChanged()
}

/**
 * 批量为选中账号开通 Overages
 */
export async function handleBatchEnableOverages(selectedIds: Set<string>, overageStatus: 'ENABLED' | 'DISABLED' = 'ENABLED'): Promise<void> {
  const isDisabling = overageStatus === 'DISABLED'
  const selectedAccounts = accountStore.getAccounts().filter(a => selectedIds.has(a.id))

  if (selectedAccounts.length === 0) {
    window.UI?.toast.warning(isDisabling ? '请先选择要取消 Overages 的账号' : '请先选择要开通 Overages 的账号')
    return
  }

  const targets = selectedAccounts.filter(account =>
    account.status === 'active' &&
    isOveragesEligible(account) &&
    (isDisabling ? isOveragesEnabled(account) : !isOveragesEnabled(account))
  )
  const skippedCount = selectedAccounts.length - targets.length

  if (targets.length === 0) {
    window.UI?.toast.info(skippedCount > 0 ? (isDisabling ? '选中账号无需取消 Overages' : '选中账号无需开通 Overages') : (isDisabling ? '没有可取消的账号' : '没有可开通的账号'))
    return
  }

  const confirmMsg = isDisabling
    ? `将为 ${targets.length} 个选中账号取消 Overages 超额配置，确定继续吗？`
    : `将为 ${targets.length} 个选中账号开通 Overages 超额配置。该功能仅适用于 Pro 及以上套餐，确定继续吗？`
  const confirmed = window.confirm(confirmMsg)
  if (!confirmed) return

  let successCount = 0
  let failedCount = 0
  let completedCount = 0
  const progress = openFloatingProgress({
    id: 'batch-enable-overages',
    title: isDisabling ? '正在批量取消 Overages' : '正在批量开通 Overages',
    total: targets.length,
    detail: `0/${targets.length} 已完成`
  })

  const batchSize = 3
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize)
    await Promise.all(batch.map(async (account) => {
      try {
        const enabled = await enableOveragesForAccount(account, {
          confirm: false,
          showToasts: false,
          refreshAfter: true,
          overageStatus
        })
        if (enabled) {
          successCount++
        } else {
          failedCount++
        }
      } catch (error) {
        failedCount++
        accountStore.updateAccount(account.id, {
          lastError: formatUnknownError(error)
        })
      } finally {
        completedCount++
        progress.update({
          completed: completedCount,
          total: targets.length,
          detail: `成功 ${successCount} 个，失败 ${failedCount} 个${skippedCount > 0 ? `，跳过 ${skippedCount} 个` : ''}`
        })
      }
    }))
  }

  if (failedCount === 0) {
    progress.finish(`Overages 开通完成：成功 ${successCount} 个${skippedCount > 0 ? `，跳过 ${skippedCount} 个` : ''}`, 'success')
    window.UI?.toast.success(`Overages 开通完成：成功 ${successCount} 个`)
  } else {
    progress.finish(`Overages 开通完成：成功 ${successCount} 个，失败 ${failedCount} 个`, 'warning')
    window.UI?.toast.warning(`Overages 开通完成：成功 ${successCount} 个，失败 ${failedCount} 个`)
  }

  accountStore.notifyAccountsChanged()
}

/**
 * 批量删除账号
 */
export function handleBatchDelete(selectedIds: Set<string>, onClear: () => void): void {
  const selectedCount = selectedIds.size

  if (selectedCount === 0) {
    window.UI?.toast.warning('请先选择要删除的账号')
    return
  }

  // 使用应用内模态框
  const modal = window.UI?.modal.open({
    title: '确认批量删除',
    html: `
      <div style="padding: 24px;">
        <p style="margin: 0; color: var(--text-main); font-size: 14px;">
          确定要删除选中的 ${selectedCount} 个账号吗？此操作不可恢复。
        </p>
      </div>
    `,
    footer: `
      <button class="ui-btn ui-btn-secondary" onclick="window.cancelBatchDelete()">取消</button>
      <button class="ui-btn ui-btn-danger" onclick="window.confirmBatchDelete()">删除</button>
    `
  })
  
  // 注册全局函数
  ;(window as any).cancelBatchDelete = () => {
    window.UI?.modal.close(modal)
    delete (window as any).cancelBatchDelete
    delete (window as any).confirmBatchDelete
  }
  
  ;(window as any).confirmBatchDelete = () => {
    window.UI?.modal.close(modal)
    delete (window as any).cancelBatchDelete
    delete (window as any).confirmBatchDelete

    // 🚀 性能优化：批量删除，只保存一次文件
    const idsToDelete = Array.from(selectedIds)
    accountStore.batchDeleteAccounts(idsToDelete)
    onClear()
    window.UI?.toast.success(`已删除 ${selectedCount} 个账号`)
  }
}

/**
 * 切换到指定账号
 */
export async function switchToAccount(account: Account): Promise<void> {
  const { credentials } = account

  // 检查账号状态
  if (account.status === 'suspended') {
    window.UI?.toast.error('无法切换到已封禁的账号')
    throw new Error('账号已封禁')
  }

  if (account.status === 'error') {
    const confirm = window.confirm('该账号状态异常，是否尝试刷新后再切换？')
    if (confirm) {
      try {
        await refreshTokenOnly(account)
        // 重新获取更新后的账号
        const accounts = accountStore.getAccounts()
        const updatedAccount = accounts.find(a => a.id === account.id)
        if (updatedAccount) {
          account = updatedAccount
        }
      } catch (error) {
        window.UI?.toast.error('刷新失败，无法切换')
        throw error
      }
    } else {
      throw new Error('账号状态异常')
    }
  }

  // 检查凭证完整性
  if (!credentials.refreshToken) {
    window.UI?.toast.error('账号凭证不完整，无法切换')
    throw new Error('账号凭证不完整')
  }

  // 检查 Token 是否即将过期（5分钟内）
  const now = Date.now()
  if (credentials.expiresAt && credentials.expiresAt - now < 5 * 60 * 1000) {
    console.log('[切换账号] Token 即将过期，先刷新')
    try {
      await refreshTokenOnly(account)
      // 重新获取更新后的账号
      const accounts = accountStore.getAccounts()
      const updatedAccount = accounts.find(a => a.id === account.id)
      if (updatedAccount) {
        account = updatedAccount
      }
    } catch (error) {
      console.error('[切换账号] Token 刷新失败:', error)
      // 继续尝试切换，让后端处理过期问题
    }
  }

  window.UI?.toast.info(`正在切换到账号: ${account.email}`)

  try {
    // 先尝试应用机器码（如果启用了自动更换）
    try {
      const { applyMachineIdForAccount } = await import('../handlers/machine-id-events')
      const applied = await applyMachineIdForAccount(account.id)
      if (applied) {
        console.log('[切换账号] 已应用机器码')
      }
    } catch (error) {
      console.log('[切换账号] 应用机器码失败，继续切换:', error)
    }
    
    const result = await (window as any).__TAURI__.core.invoke('switch_account', {
      accessToken: account.credentials.accessToken,
      refreshToken: account.credentials.refreshToken,
      clientId: account.credentials.clientId || '',
      clientSecret: account.credentials.clientSecret || '',
      region: account.credentials.region || 'us-east-1',
      startUrl: account.credentials.startUrl,
      authMethod: account.credentials.authMethod || 'IdC',
      provider: account.credentials.provider || account.idp,
      profileArn: account.subscription.profileArn
    })

    if (result.success) {
      // 如果后端返回了新的 Token，更新账号
      if (result.access_token && result.access_token !== account.credentials.accessToken) {
        console.log('[切换账号] 后端返回了新 Token，更新账号')
        accountStore.updateAccount(account.id, {
          credentials: {
            ...account.credentials,
            accessToken: result.access_token,
            refreshToken: result.refresh_token || account.credentials.refreshToken,
            expiresAt: result.expires_in ? now + result.expires_in * 1000 : account.credentials.expiresAt
          }
        })
      }
      
      // 立即同步本地激活账号
      await accountStore.syncActiveAccountFromLocal()
      window.UI?.toast.success('账号切换成功')
    } else {
      window.UI?.toast.error(`切换失败: ${result.error}`)
      throw new Error(result.error || '切换失败')
    }
  } catch (error) {
    window.UI?.toast.error('切换失败: ' + (error as Error).message)
    throw error
  }
}

/**
 * 退出登录
 */
export async function logoutAccount(): Promise<void> {
  if (!confirm('这将清除本地 SSO 缓存并退出 Kiro 登录，是否继续？')) {
    return
  }

  try {
    const result = await (window as any).__TAURI__.core.invoke('logout_account')

    if (result.success) {
      // 立即同步本地激活账号（应该会清除）
      await accountStore.syncActiveAccountFromLocal()
      window.UI?.toast.success('退出成功，已清除本地缓存')
    } else {
      window.UI?.toast.error(`退出失败: ${result.error}`)
      throw new Error(result.error || '退出失败')
    }
  } catch (error) {
    window.UI?.toast.error('退出失败: ' + (error as Error).message)
    throw error
  }
}
