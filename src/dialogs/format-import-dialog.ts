import { accountStore } from '../store'
import { openFloatingProgress } from '../utils/floating-progress'
import { smartParseFormatImportAccounts } from '../utils/format-import-parser'
import type { AccountSubscription } from '../types'

interface ParsedAccount {
  email: string
  refreshToken: string
  clientId: string
  clientSecret: string
  provider: string
  region: string
  authMethod: string
  userId?: string
  accessToken?: string
  expiresAt?: number
  subscription?: AccountSubscription
  usage?: any
  status?: 'active' | 'expired' | 'error' | 'refreshing' | 'unknown' | 'suspended'
  lastError?: string
}

function isSuspendedError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    message.includes('封禁') ||
    message.includes('暂停') ||
    normalized.includes('suspended') ||
    normalized.includes('access_denied')
  )
}

function parseSubscriptionInfo(subInfo: any): AccountSubscription {
  if (!subInfo) return { type: 'Free' }
  let type: AccountSubscription['type'] = 'Free'
  const rawType = subInfo.type || subInfo.rawType || subInfo.raw_type || ''
  if (rawType.includes('PRO_PLUS')) type = 'Pro_Plus'
  else if (rawType.includes('PRO')) type = 'Pro'
  else if (rawType.includes('ENTERPRISE')) type = 'Enterprise'
  else if (rawType.includes('TEAMS')) type = 'Teams'
  return {
    type,
    title: subInfo.subscriptionTitle || subInfo.subscription_title || subInfo.title,
    rawType,
    profileArn: subInfo.profileArn || subInfo.profile_arn,
    managementTarget: subInfo.subscriptionManagementTarget || subInfo.managementTarget || subInfo.management_target,
    upgradeCapability: subInfo.upgradeCapability || subInfo.upgrade_capability,
    overageCapability: subInfo.overageCapability || subInfo.overage_capability,
    overageStatus: subInfo.overageStatus || subInfo.overage_status || subInfo.overageConfiguration?.overageStatus || subInfo.overage_configuration?.overage_status
  }
}

function parseUsageData(usageData: any) {
  const now = Date.now()
  if (!usageData) return { current: 0, limit: 0, percentUsed: 0, lastUpdated: now }
  const breakdown = (usageData.usageBreakdownList || usageData.usage_breakdown_list || [])[0]
  const current = breakdown?.currentUsageWithPrecision ?? breakdown?.current_usage_with_precision ?? breakdown?.currentUsage ?? breakdown?.current_usage ?? usageData.current ?? 0
  const limit = breakdown?.usageLimitWithPrecision ?? breakdown?.usage_limit_with_precision ?? breakdown?.usageLimit ?? breakdown?.usage_limit ?? usageData.limit ?? 0
  const freeTrialInfo = breakdown?.freeTrialInfo || breakdown?.free_trial_info
  return {
    current,
    limit,
    percentUsed: limit > 0 ? current / limit : 0,
    lastUpdated: now,
    baseLimit: limit,
    baseCurrent: current,
    freeTrialLimit: freeTrialInfo?.usageLimitWithPrecision ?? freeTrialInfo?.usage_limit_with_precision ?? freeTrialInfo?.usageLimit ?? freeTrialInfo?.usage_limit,
    freeTrialCurrent: freeTrialInfo?.currentUsageWithPrecision ?? freeTrialInfo?.current_usage_with_precision ?? freeTrialInfo?.currentUsage ?? freeTrialInfo?.current_usage,
    freeTrialExpiry: freeTrialInfo?.freeTrialExpiry || freeTrialInfo?.free_trial_expiry
      ? new Date((freeTrialInfo.freeTrialExpiry || freeTrialInfo.free_trial_expiry) * 1000).toISOString()
      : undefined,
    bonuses: breakdown?.bonuses,
    nextResetDate: usageData.nextDateReset || usageData.next_date_reset
      ? new Date((usageData.nextDateReset || usageData.next_date_reset) * 1000).toISOString()
      : undefined,
    resourceDetail: breakdown ? {
      displayName: breakdown.displayName || breakdown.display_name,
      displayNamePlural: breakdown.displayNamePlural || breakdown.display_name_plural,
      resourceType: breakdown.resourceType || breakdown.resource_type,
      currency: breakdown.currency,
      unit: breakdown.unit,
      overageRate: breakdown.overageRate || breakdown.overage_rate,
      overageCap: breakdown.overageCapWithPrecision ?? breakdown.overage_cap_with_precision ?? breakdown.overageCap ?? breakdown.overage_cap
    } : undefined
  }
}

function normalizeProfileArn(value: unknown): string | undefined {
  return typeof value === 'string' && value.startsWith('arn:aws:codewhisperer:')
    ? value
    : undefined
}

function extractProfileArnFromRaw(item: any): string | undefined {
  return normalizeProfileArn(item?.profileArn) ||
    normalizeProfileArn(item?.profile_arn) ||
    normalizeProfileArn(item?.subscription?.profileArn) ||
    normalizeProfileArn(item?.subscription?.profile_arn) ||
    normalizeProfileArn(item?.usageData?.profileArn) ||
    normalizeProfileArn(item?.usageData?.profile_arn) ||
    normalizeProfileArn(item?.usage_data?.profileArn) ||
    normalizeProfileArn(item?.usage_data?.profile_arn) ||
    normalizeProfileArn(item?.usageData?.subscriptionInfo?.profileArn) ||
    normalizeProfileArn(item?.usage_data?.subscription_info?.profile_arn)
}

/**
 * 智能解析：从任意格式的数据中提取账号信息
 */
function smartParseAccounts(rawText: string): ParsedAccount[] {
  const results: ParsedAccount[] = []

  let data: any
  try {
    data = JSON.parse(rawText)
  } catch {
    // JSON 解析失败时尝试逐行提取 JSON 对象
    const jsonObjects = extractJsonObjects(rawText)
    if (jsonObjects.length === 0) return []
    data = jsonObjects.length === 1 ? jsonObjects[0] : jsonObjects
  }

  // 展开包装格式
  if (!Array.isArray(data)) {
    if (data.accounts && Array.isArray(data.accounts)) {
      data = data.accounts
    } else {
      data = [data]
    }
  }

  for (const item of data) {
    const parsed = extractAccountFromObject(item)
    if (parsed) results.push(parsed)
  }

  return results
}

/**
 * 从文本中提取可能的 JSON 对象
 */
function extractJsonObjects(text: string): any[] {
  const results: any[] = []
  let depth = 0
  let start = -1

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '[') {
      if (depth === 0) start = i
      depth++
    } else if (text[i] === '}' || text[i] === ']') {
      depth--
      if (depth === 0 && start >= 0) {
        try {
          const obj = JSON.parse(text.slice(start, i + 1))
          results.push(obj)
        } catch { /* skip */ }
        start = -1
      }
    }
  }
  return results
}

/**
 * 从单个对象中提取账号关键字段
 */
function extractAccountFromObject(item: any): ParsedAccount | null {
  if (!item || typeof item !== 'object') return null

  const read = (...keys: string[]) => {
    for (const key of keys) {
      const value = item[key]
      if (value !== undefined && value !== null && value !== '') return value
    }
    return undefined
  }

  let refreshToken = ''
  let clientId = ''
  let clientSecret = ''
  let provider = ''
  let region = 'us-east-1'
  let authMethod = 'IdC'
  let email = ''
  let userId = ''
  let accessToken = ''
  let expiresAt: number | undefined
  let subscription: AccountSubscription | undefined
  let usage: any
  let status: ParsedAccount['status']
  let lastError = ''

  // 格式A：本应用导出格式 (credentials 嵌套)
  if (item.credentials?.refreshToken || item.credentials?.refresh_token) {
    refreshToken = item.credentials.refreshToken || item.credentials.refresh_token
    clientId = item.credentials.clientId || item.credentials.client_id || ''
    clientSecret = item.credentials.clientSecret || item.credentials.client_secret || ''
    provider = item.credentials.provider || item.idp || 'BuilderId'
    region = item.credentials.region || 'us-east-1'
    authMethod = item.credentials.authMethod || 'IdC'
    accessToken = item.credentials.accessToken || item.credentials.access_token || ''
    expiresAt = Number(item.credentials.expiresAt || item.credentials.expires_at) || undefined
    email = item.email || ''
    userId = item.userId || ''
    subscription = item.subscription
      ? { ...item.subscription, profileArn: item.subscription.profileArn || item.subscription.profile_arn || item.profileArn || item.profile_arn }
      : undefined
    usage = item.usage
    status = item.status
    lastError = item.lastError || item.last_error || ''
  }
  // 格式B：扁平格式 (顶层 refreshToken)
  else if (item.refreshToken || item.refresh_token) {
    const usageData = item.usageData || item.usage_data
    refreshToken = read('refreshToken', 'refresh_token') || ''
    clientId = read('clientId', 'client_id') || ''
    clientSecret = read('clientSecret', 'client_secret') || ''
    provider = item.provider || 'BuilderId'
    region = item.region || 'us-east-1'
    authMethod = item.authMethod || 'IdC'
    accessToken = read('accessToken', 'access_token') || ''
    expiresAt = Number(read('expiresAt', 'expires_at')) || undefined
    email = item.email || usageData?.userInfo?.email || usageData?.user_info?.email || ''
    userId = item.userId || item.user_id || usageData?.userInfo?.userId || usageData?.user_info?.user_id || ''
    status = item.status
    lastError = item.lastError || item.last_error || ''

    if (usageData?.subscriptionInfo || usageData?.subscription_info) {
      subscription = parseSubscriptionInfo(usageData.subscriptionInfo || usageData.subscription_info)
    }
    if (subscription) {
      subscription.profileArn = subscription.profileArn || item.profileArn || item.profile_arn || usageData?.profileArn || usageData?.profile_arn
      subscription.overageStatus = subscription.overageStatus || usageData?.overageConfiguration?.overageStatus || usageData?.overage_configuration?.overage_status
    }
    if (usageData) {
      usage = parseUsageData(usageData)
    }
  }
  // 格式C：尝试深度搜索 refreshToken
  else {
    refreshToken = deepFind(item, 'refreshToken') || deepFind(item, 'refresh_token') || ''
    clientId = deepFind(item, 'clientId') || deepFind(item, 'client_id') || ''
    clientSecret = deepFind(item, 'clientSecret') || deepFind(item, 'client_secret') || ''
    provider = deepFind(item, 'provider') || deepFind(item, 'idp') || 'BuilderId'
    region = deepFind(item, 'region') || 'us-east-1'
    email = deepFind(item, 'email') || ''
    userId = deepFind(item, 'userId') || deepFind(item, 'user_id') || ''
    accessToken = deepFind(item, 'accessToken') || deepFind(item, 'access_token') || ''
  }

  if (!refreshToken) return null

  const profileArn = extractProfileArnFromRaw(item) || normalizeProfileArn(deepFind(item, 'profileArn')) || normalizeProfileArn(deepFind(item, 'profile_arn'))
  if (profileArn) {
    subscription = {
      ...(subscription || { type: 'Free' as const }),
      profileArn
    }
  }

  const isSocial = provider === 'Google' || provider === 'Github'
  if (isSocial || !clientId || !clientSecret) authMethod = 'social'

  return {
    email,
    refreshToken,
    clientId,
    clientSecret,
    provider,
    region,
    authMethod,
    userId,
    accessToken,
    expiresAt,
    subscription,
    usage,
    status,
    lastError
  }
}

/**
 * 深度搜索对象中的某个 key
 */
function deepFind(obj: any, key: string, maxDepth = 3): string {
  if (maxDepth <= 0 || !obj || typeof obj !== 'object') return ''
  if (obj[key] && typeof obj[key] === 'string') return obj[key]
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === 'object') {
      const found = deepFind(obj[k], key, maxDepth - 1)
      if (found) return found
    }
  }
  return ''
}

function maskToken(token: string): string {
  if (!token) return '-'
  if (token.length <= 12) return token.slice(0, 4) + '...'
  return token.slice(0, 6) + '...' + token.slice(-4)
}

/**
 * 显示格式化导入对话框
 */
export function showFormatImportDialog(): void {
  let parsedAccounts: ParsedAccount[] = []

  const modal = window.UI?.modal.open({
    title: '格式化导入',
    html: `
      <div class="modal-form">
        <div class="form-section">
          <label class="form-label">粘贴数据</label>
          <textarea class="form-input form-textarea" id="format-import-input" rows="8"
            placeholder="支持多种格式自动识别：&#10;- 本应用导出的 JSON&#10;- 扁平格式 JSON（含 refreshToken/clientId 等）&#10;- rt: xxx / refreshToken: xxx&#10;- RT----social----google----邮箱 这类分隔文本&#10;&#10;粘贴后点击「解析」自动提取关键参数"></textarea>
        </div>
        <div class="form-section">
          <button class="ui-btn ui-btn-secondary" id="format-parse-btn" style="width: 100%;">
            解析数据
          </button>
        </div>
        <div id="format-preview" style="display: none;">
          <div class="form-section">
            <label class="form-label">解析结果预览</label>
            <div class="format-preview-info" id="format-preview-info"></div>
            <div class="format-preview-table-wrap" id="format-preview-table"></div>
          </div>
        </div>
      </div>
    `,
    footer: `
      <button class="ui-btn ui-btn-secondary" id="format-cancel-btn">取消</button>
      <button class="ui-btn ui-btn-primary" id="format-dialog-import-btn" disabled>
        <span id="format-dialog-import-text">导入</span>
      </button>
    `,
    size: 'lg',
    closable: true
  })

  const parseBtn = document.getElementById('format-parse-btn')
  const importBtn = document.getElementById('format-dialog-import-btn') as HTMLButtonElement
  const cancelBtn = document.getElementById('format-cancel-btn')

  parseBtn?.addEventListener('click', () => {
    const input = (document.getElementById('format-import-input') as HTMLTextAreaElement)?.value.trim()
    if (!input) {
      window.UI?.toast.error('请先粘贴数据')
      return
    }

    parsedAccounts = smartParseFormatImportAccounts(input)
    if (parsedAccounts.length === 0) {
      window.UI?.toast.error('未能从数据中提取到有效账号')
      return
    }

    renderPreview(parsedAccounts)
    importBtn.disabled = false
    window.UI?.toast.success(`成功解析 ${parsedAccounts.length} 个账号`)
  })

  cancelBtn?.addEventListener('click', () => {
    window.UI?.modal.close(modal)
  })

  importBtn?.addEventListener('click', async () => {
    if (parsedAccounts.length === 0) return
    await doFormatImport(parsedAccounts, modal)
  })
}

function renderPreview(accounts: ParsedAccount[]) {
  const previewDiv = document.getElementById('format-preview')
  const infoDiv = document.getElementById('format-preview-info')
  const tableDiv = document.getElementById('format-preview-table')
  if (!previewDiv || !infoDiv || !tableDiv) return

  previewDiv.style.display = 'block'

  const canVerify = (account: ParsedAccount) => Boolean(account.refreshToken)
  const usesDesktopAuth = (account: ParsedAccount) =>
    Boolean(account.refreshToken && (!account.clientId || !account.clientSecret))
  const verifiableCount = accounts.filter(canVerify).length
  const directOnlyCount = accounts.filter(a => !canVerify(a) && a.accessToken).length
  const desktopAuthCount = accounts.filter(usesDesktopAuth).length
  const invalidCount = accounts.length - verifiableCount - directOnlyCount

  infoDiv.innerHTML = `
    <span class="preview-badge">共 ${accounts.length} 个账号</span>
    ${verifiableCount > 0 ? `<span class="preview-badge badge-green">${verifiableCount} 个会验活</span>` : ''}
    ${desktopAuthCount > 0 ? `<span class="preview-badge badge-purple">${desktopAuthCount} 个桌面验活</span>` : ''}
    ${directOnlyCount > 0 ? `<span class="preview-badge badge-orange">${directOnlyCount} 个仅导入</span>` : ''}
    ${invalidCount > 0 ? `<span class="preview-badge badge-purple">${invalidCount} 个缺凭证</span>` : ''}
    ${desktopAuthCount > 0 ? '<span class="preview-note">缺少 clientId/clientSecret 时会走 Kiro Desktop Auth，只要 refreshToken 可用就会验活。</span>' : ''}
    ${directOnlyCount > 0 ? '<span class="preview-note">仅导入表示没有 refreshToken，无法验活，只保存原始 accessToken。</span>' : ''}
  `

  const maxShow = Math.min(accounts.length, 50)
  let rows = ''
  for (let i = 0; i < maxShow; i++) {
    const a = accounts[i]
    const importMode = canVerify(a)
      ? (usesDesktopAuth(a) ? '桌面验活' : '验活')
      : a.accessToken
        ? '仅导入'
        : '缺凭证'

    rows += `<tr>
      <td>${i + 1}</td>
      <td title="${a.email || '-'}">${a.email || '-'}</td>
      <td>${a.provider}</td>
      <td>${a.region}</td>
      <td title="${a.refreshToken}">${maskToken(a.refreshToken)}</td>
      <td>${importMode}</td>
    </tr>`
  }

  tableDiv.innerHTML = `
    <table class="format-preview-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Email</th>
          <th>Provider</th>
          <th>Region</th>
          <th>RefreshToken</th>
          <th>处理方式</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${accounts.length > maxShow ? `<p class="form-hint">... 还有 ${accounts.length - maxShow} 个账号未显示</p>` : ''}
  `
}

async function doFormatImport(accounts: ParsedAccount[], modal: any) {
  const importBtn = document.getElementById('format-dialog-import-btn') as HTMLButtonElement
  const importText = document.getElementById('format-dialog-import-text')
  importBtn.disabled = true
  importText!.textContent = '导入中...'

  let successCount = 0
  let failedCount = 0
  const errors: string[] = []
  let completedCount = 0

  const importProgress = openFloatingProgress({
    id: 'format-import',
    title: '格式化导入',
    total: accounts.length,
    detail: `0/${accounts.length} 已完成`
  })

  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))

  const CONCURRENCY = 10
  const queue = accounts.map((a, i) => ({ account: a, index: i }))

  function addDirectAccount(account: ParsedAccount, index: number, fallbackStatus: ParsedAccount['status'] = 'unknown') {
    const now = Date.now()
    accountStore.addAccount({
      email: account.email || `账号 ${index + 1}`,
      nickname: account.email ? account.email.split('@')[0] : undefined,
      idp: account.provider as any,
      userId: account.userId,
      credentials: {
        accessToken: account.accessToken || '',
        csrfToken: '',
        refreshToken: account.refreshToken,
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        region: account.region,
        expiresAt: account.expiresAt || now + 3600 * 1000,
        authMethod: account.authMethod as any,
        provider: account.provider
      },
      subscription: account.subscription || { type: 'Free' },
      usage: account.usage || { current: 0, limit: 0, percentUsed: 0, lastUpdated: now },
      groupId: undefined,
      tags: [],
      status: account.status || fallbackStatus || 'unknown',
      lastError: account.lastError || undefined,
      lastUsedAt: now
    })
  }

  async function processOne(account: ParsedAccount, index: number) {
    try {
      const canVerify = Boolean(account.refreshToken)

      if (!canVerify && account.accessToken) {
        addDirectAccount(account, index)
        successCount++
        errors.push(`#${index + 1}: 缺少验活所需 refreshToken，已仅导入原始数据，状态标记为未知`)
        return
      }

      // 需要 API 验证
      if (!canVerify) {
        failedCount++
        errors.push(`#${index + 1}: 缺少验活所需 refreshToken`)
        return
      }

      const result = await (window as any).__TAURI__.core.invoke('verify_account_credentials', {
        refreshToken: account.refreshToken,
        clientId: account.clientId || '',
        clientSecret: account.clientSecret || '',
        region: account.region
      })

      if (result.success && result.data) {
        const now = Date.now()
        accountStore.addAccount({
          email: result.data.email,
          nickname: result.data.email ? result.data.email.split('@')[0] : undefined,
          idp: account.provider as any,
          userId: result.data.user_id,
          credentials: {
            accessToken: result.data.access_token,
            csrfToken: '',
            refreshToken: result.data.refresh_token,
            clientId: account.clientId,
            clientSecret: account.clientSecret,
            region: account.region,
            expiresAt: result.data.expires_in ? Date.now() + result.data.expires_in * 1000 : Date.now() + 3600 * 1000,
            authMethod: account.authMethod as any,
            provider: account.provider
          },
          subscription: {
            type: result.data.subscription_type,
            title: result.data.subscription_title,
            rawType: result.data.raw_type,
            profileArn: result.data.profile_arn || account.subscription?.profileArn,
            daysRemaining: result.data.days_remaining,
            expiresAt: result.data.expires_at,
            managementTarget: result.data.management_target,
            upgradeCapability: result.data.upgrade_capability,
            overageCapability: result.data.overage_capability,
            overageStatus: result.data.overage_status
          },
          usage: {
            current: result.data.usage.current,
            limit: result.data.usage.limit,
            percentUsed: result.data.usage.limit > 0 ? result.data.usage.current / result.data.usage.limit : 0,
            lastUpdated: Date.now(),
            baseLimit: result.data.usage.baseLimit,
            baseCurrent: result.data.usage.baseCurrent,
            freeTrialLimit: result.data.usage.freeTrialLimit,
            freeTrialCurrent: result.data.usage.freeTrialCurrent,
            freeTrialExpiry: result.data.usage.freeTrialExpiry,
            bonuses: result.data.usage.bonuses,
            nextResetDate: result.data.usage.nextResetDate,
            resourceDetail: result.data.usage.resourceDetail
          },
          groupId: undefined,
          tags: [],
          status: 'active',
          lastUsedAt: Date.now()
        })
        successCount++
      } else if (result.data && result.data.user_id) {
        const now = Date.now()
        const email = result.data.email || account.email || '已封禁账号'
        accountStore.addAccount({
          email,
          nickname: email.includes('@') ? email.split('@')[0] : undefined,
          idp: account.provider as any,
          userId: result.data.user_id,
          credentials: {
            accessToken: result.data.access_token || '',
            csrfToken: '',
            refreshToken: result.data.refresh_token || account.refreshToken,
            clientId: account.clientId,
            clientSecret: account.clientSecret,
            region: account.region,
            expiresAt: now + 3600 * 1000,
            authMethod: account.authMethod as any,
            provider: account.provider
          },
          subscription: {
            type: 'Free' as any,
            title: result.data.subscription_title,
            profileArn: result.data.profile_arn || account.subscription?.profileArn
          },
          usage: { current: 0, limit: 0, percentUsed: 0, lastUpdated: now },
          groupId: undefined,
          tags: [],
          status: 'suspended',
          lastUsedAt: now
        })
        successCount++
        errors.push(`#${index + 1}: ${result.error || '账号被封禁'}（已标记为已封禁）`)
      } else if (account.accessToken) {
        const fallbackError = result.error || '验活失败'
        account.lastError = fallbackError
        addDirectAccount(account, index, isSuspendedError(fallbackError) ? 'suspended' : 'error')
        successCount++
        errors.push(`#${index + 1}: ${fallbackError}（已按原始数据导入）`)
      } else {
        failedCount++
        errors.push(`#${index + 1}: ${result.error || '验证失败'}`)
      }
    } catch (error) {
      failedCount++
      errors.push(`#${index + 1}: ${(error as Error).message}`)
    } finally {
      completedCount++
      importProgress.update({
        completed: completedCount,
        total: accounts.length,
        detail: `成功 ${successCount}，失败 ${failedCount}`
      })
    }
  }

  const workers: Promise<void>[] = []
  for (let w = 0; w < Math.min(CONCURRENCY, queue.length); w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const next = queue.shift()
        if (!next) return
        await processOne(next.account, next.index)
        await new Promise<void>(resolve => setTimeout(resolve, 0))
      }
    })())
  }
  await Promise.all(workers)

  if (successCount > 0) {
    window.UI?.toast.success(`成功导入 ${successCount} 个账号`)
  }
  importProgress.finish(
    `格式化导入完成：成功 ${successCount}，失败 ${failedCount}`,
    failedCount === 0 ? 'success' : 'warning'
  )

  if (failedCount === 0) {
    setTimeout(() => window.UI?.modal.close(modal), 1500)
  } else {
    renderImportErrors(errors)
    importBtn.disabled = false
    importText!.textContent = `导入完成 (失败 ${failedCount})`
  }
}

function renderImportErrors(errors: string[]) {
  const tableDiv = document.getElementById('format-preview-table')
  if (!tableDiv || errors.length === 0) return

  const maxShow = Math.min(errors.length, 12)
  const rows = errors
    .slice(0, maxShow)
    .map(error => `<div class="format-import-error-line">${error}</div>`)
    .join('')

  tableDiv.insertAdjacentHTML('afterbegin', `
    <div class="format-import-errors">
      <div class="format-import-errors-title">失败原因预览</div>
      ${rows}
      ${errors.length > maxShow ? `<div class="format-import-error-more">还有 ${errors.length - maxShow} 条失败信息未显示</div>` : ''}
    </div>
  `)
}
