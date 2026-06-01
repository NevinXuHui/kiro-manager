import type { AccountSubscription } from '../types'

export interface ParsedFormatImportAccount {
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

export function smartParseFormatImportAccounts(_rawText: string): ParsedFormatImportAccount[] {
  const jsonAccounts = parseJsonLikeAccounts(_rawText)
  if (jsonAccounts.length > 0) return jsonAccounts

  return extractLooseTextAccounts(_rawText)
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

function parseJsonLikeAccounts(rawText: string): ParsedFormatImportAccount[] {
  let data: any
  try {
    data = JSON.parse(rawText)
  } catch {
    const jsonObjects = extractJsonObjects(rawText)
    if (jsonObjects.length === 0) return []
    data = jsonObjects.length === 1 ? jsonObjects[0] : jsonObjects
  }

  return toAccountItems(data)
    .map(item => extractAccountFromObject(item))
    .filter((account): account is ParsedFormatImportAccount => Boolean(account))
}

function toAccountItems(data: any): any[] {
  const source = data?.accounts && Array.isArray(data.accounts) ? data.accounts : data
  const items = Array.isArray(source) ? source : [source]
  return items.flatMap(item => Array.isArray(item) ? item : [item])
}

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
          results.push(JSON.parse(text.slice(start, i + 1)))
        } catch { /* skip */ }
        start = -1
      }
    }
  }
  return results
}

function extractAccountFromObject(item: any): ParsedFormatImportAccount | null {
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
  let status: ParsedFormatImportAccount['status']
  let lastError = ''

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
  } else if (item.refreshToken || item.refresh_token || item.rt) {
    const usageData = item.usageData || item.usage_data
    refreshToken = read('refreshToken', 'refresh_token', 'rt') || ''
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
    if (usageData) usage = parseUsageData(usageData)
  } else {
    refreshToken = deepFind(item, 'refreshToken') || deepFind(item, 'refresh_token') || deepFind(item, 'rt') || ''
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

function extractLooseTextAccounts(rawText: string): ParsedFormatImportAccount[] {
  const results: ParsedFormatImportAccount[] = []
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)

  for (const line of lines) {
    const account = parseDelimitedLine(line)
    if (account) addUniqueAccount(results, account)
  }

  for (const token of extractLabeledTokens(rawText)) {
    addUniqueAccount(results, buildLooseAccount(token, rawText))
  }

  for (const line of lines) {
    const token = normalizeRefreshToken(line)
    if (token && isLikelyRefreshToken(token)) {
      addUniqueAccount(results, buildLooseAccount(token, line || rawText))
    }
  }

  return results
}

function parseDelimitedLine(line: string): ParsedFormatImportAccount | null {
  if (!line.includes('----')) return null

  const parts = line.split('----').map(part => part.trim()).filter(Boolean)
  const refreshToken = normalizeRefreshToken(parts[0])
  if (!refreshToken || !isLikelyRefreshToken(refreshToken)) return null

  return buildLooseAccount(refreshToken, line, {
    provider: detectProvider(parts) || 'BuilderId',
    authMethod: parts.some(part => part.toLowerCase() === 'social') ? 'social' : undefined
  })
}

function extractLabeledTokens(text: string): string[] {
  const tokens: string[] = []
  const pattern = /\b(?:refresh\s*token|refresh[-_]?token|rt)\b\s*[:=：]\s*([^\s"'`,;，。]+)/gi
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const token = normalizeRefreshToken(match[1])
    if (token && isLikelyRefreshToken(token)) tokens.push(token)
  }

  return tokens
}

function buildLooseAccount(
  refreshToken: string,
  context: string | string[],
  overrides: Partial<ParsedFormatImportAccount> = {}
): ParsedFormatImportAccount {
  const contextParts = Array.isArray(context) ? context : context.split(/[-\s]+/)
  const provider = overrides.provider || detectProvider(contextParts) || 'BuilderId'

  return {
    email: overrides.email || findEmail(Array.isArray(context) ? context.join(' ') : context) || '',
    refreshToken,
    clientId: '',
    clientSecret: '',
    provider,
    region: overrides.region || findRegion(Array.isArray(context) ? context.join(' ') : context) || 'us-east-1',
    authMethod: overrides.authMethod || 'social'
  }
}

function addUniqueAccount(accounts: ParsedFormatImportAccount[], account: ParsedFormatImportAccount): void {
  if (accounts.some(existing => existing.refreshToken === account.refreshToken)) return
  accounts.push(account)
}

function normalizeRefreshToken(value: string): string {
  return value
    .replace(/^\s*(?:refresh\s*token|refresh[-_]?token|rt)\s*[:=：]\s*/i, '')
    .trim()
    .replace(/^[`'"]+|[`'",;，。]+$/g, '')
}

function isLikelyRefreshToken(value: string): boolean {
  return (
    value.length >= 10 &&
    value.length <= 10000 &&
    !/\s/.test(value) &&
    /^[A-Za-z0-9_:+/=.~-]+$/.test(value) &&
    !value.includes('@')
  )
}

function detectProvider(parts: string[]): string | undefined {
  for (const part of parts) {
    const normalized = part.toLowerCase().replace(/[^a-z0-9]/g, '')
    if (normalized === 'google') return 'Google'
    if (normalized === 'github' || normalized === 'git') return 'Github'
    if (normalized === 'enterprise') return 'Enterprise'
    if (normalized === 'builderid' || normalized === 'builder') return 'BuilderId'
  }
  return undefined
}

function findEmail(text: string): string | undefined {
  for (const part of text.split(/----|\s+/)) {
    const candidate = part.trim().replace(/^[`'":：]+|[`'",;，。]+$/g, '')
    if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(candidate)) {
      return candidate
    }
  }
  return undefined
}

function findRegion(text: string): string | undefined {
  return text.match(/\b(?:us|eu|ap|ca|sa|me|af)-[a-z]+-\d\b/)?.[0]
}
