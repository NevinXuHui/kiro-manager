// 账号相关工具函数

/**
 * 获取订阅类型对应的颜色类名
 */
export function getSubscriptionColor(type: string): string {
  const text = type.toUpperCase()
  if (text.includes('PRO+') || text.includes('PRO_PLUS')) return 'badge-pro'
  if (text.includes('PRO')) return 'badge-pro'
  return 'badge-free'
}

/**
 * 获取状态文本
 */
export function getStatusText(status: string): string {
  const statusMap: Record<string, string> = {
    active: '正常',
    expired: '已过期',
    error: '错误',
    refreshing: '刷新中',
    unknown: '未知',
    suspended: '已封禁'
  }
  return statusMap[status] || status
}

/**
 * 获取 IDP 显示名称
 */
export function getIdpDisplayName(idp: string): string {
  const displayNames: Record<string, string> = {
    'BuilderId': 'Builder ID',
    'Enterprise': 'Enterprise',
    'Google': 'Google',
    'Github': 'GitHub'
  }
  return displayNames[idp] || idp
}

/**
 * 格式化 Token 到期时间
 */
export function formatTokenExpiry(expiresAt: number): string {
  const now = Date.now()
  const diff = expiresAt - now
  
  if (diff <= 0) return '已过期'
  
  const minutes = Math.floor(diff / (60 * 1000))
  const hours = Math.floor(diff / (60 * 60 * 1000))
  
  if (minutes < 60) {
    return `${minutes}分钟`
  } else if (hours < 24) {
    const remainingMinutes = minutes % 60
    return remainingMinutes > 0 ? `${hours}小时${remainingMinutes}分` : `${hours}小时`
  } else {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    return remainingHours > 0 ? `${days}天${remainingHours}小时` : `${days}天`
  }
}

export function buildExportFilename(accountCount: number, format: 'json' | 'txt' | 'csv', date = new Date()): string {
  const safeCount = Math.max(0, Math.floor(accountCount))
  const day = date.toISOString().slice(0, 10)
  return `kiro-accounts-${safeCount}-${day}.${format}`
}

/**
 * 生成单个账号导出的文件名
 * 格式：日期_时间_序号_邮箱.json
 * 例如：20260618_131736_135_JaredBrown8180_at_outlook_com.json
 */
export function buildSingleAccountFilename(email: string, index: number, date = new Date()): string {
  // 格式化日期和时间
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  const seconds = String(date.getSeconds()).padStart(2, '0')

  const dateStr = `${year}${month}${day}`
  const timeStr = `${hours}${minutes}${seconds}`

  // 处理邮箱：将 @ 替换为 _at_，. 替换为 _
  const emailPart = email.replace(/@/g, '_at_').replace(/\./g, '_')

  return `${dateStr}_${timeStr}_${index}_${emailPart}.json`
}

/**
 * 将 Account 对象转换为简化的导出格式
 * 匹配目标格式：clientId, clientSecret, creditLimit, creditUsed, email, password, provider, proxy_ip, proxy_region, refreshToken, region, subscription
 */
export function convertAccountToSimplifiedFormat(account: any): any {
  return {
    clientId: account.credentials?.clientId || '',
    clientSecret: account.credentials?.clientSecret || '',
    creditLimit: account.usage?.limit || 0,
    creditUsed: account.usage?.current || 0,
    email: account.email || '',
    password: '', // 密码字段系统中未存储，导出为空
    provider: account.idp || 'BuilderId',
    proxy_ip: '', // 代理IP系统中未存储，导出为空
    proxy_region: '', // 代理地区系统中未存储，导出为空
    refreshToken: account.credentials?.refreshToken || '',
    region: account.credentials?.region || 'us-east-1',
    subscription: account.subscription?.title || account.subscription?.type || 'FREE'
  }
}

/**
 * 生成导出内容
 */
export function generateExportContent(
  accounts: any[],
  format: string,
  includeCredentials: boolean
): string {
  try {
    // 限制导出数量
    if (accounts.length > 1000) {
      throw new Error('导出账号数量过多，最多支持 1000 个')
    }

    switch (format) {
      case 'json':
        const exportData = {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          accounts: includeCredentials
            ? accounts
            : accounts.map(acc => ({
                ...acc,
                credentials: {
                  ...acc.credentials,
                  accessToken: '',
                  refreshToken: '',
                  csrfToken: ''
                }
              }))
        }
        return JSON.stringify(exportData, null, 2)

      case 'txt':
        if (includeCredentials) {
          return accounts.map(acc =>
            [
              acc.email,
              acc.credentials?.refreshToken || '',
              acc.nickname || '',
              acc.idp || 'BuilderId'
            ].join(',')
          ).join('\n')
        }
        return accounts.map(acc => {
          const lines = [
            `邮箱: ${acc.email}`,
            acc.nickname ? `昵称: ${acc.nickname}` : null,
            acc.idp ? `登录方式: ${acc.idp}` : null,
            acc.subscription?.title ? `订阅: ${acc.subscription.title}` : null,
            acc.usage ? `用量: ${acc.usage.current ?? 0}/${acc.usage.limit ?? 0}` : null,
          ].filter(Boolean)
          return lines.join('\n')
        }).join('\n\n---\n\n')

      case 'csv':
        const headers = includeCredentials
          ? ['邮箱', '昵称', '登录方式', 'RefreshToken', 'ClientId', 'ClientSecret', 'Region']
          : ['邮箱', '昵称', '登录方式', '订阅类型', '订阅标题', '已用量', '总额度']
        const rows = accounts.map(acc => includeCredentials
          ? [
              acc.email,
              acc.nickname || '',
              acc.idp || '',
              acc.credentials?.refreshToken || '',
              acc.credentials?.clientId || '',
              acc.credentials?.clientSecret || '',
              acc.credentials?.region || 'us-east-1'
            ]
          : [
              acc.email,
              acc.nickname || '',
              acc.idp || '',
              acc.subscription?.type || '',
              acc.subscription?.title || '',
              String(acc.usage?.current ?? ''),
              String(acc.usage?.limit ?? '')
            ]
        )
        return '\ufeff' + [headers, ...rows].map(row =>
          row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\n')

      case 'clipboard':
        if (includeCredentials) {
          return accounts.map(acc =>
            `${acc.email},${acc.credentials?.refreshToken || ''}`
          ).join('\n')
        }
        return accounts.map(acc =>
          `${acc.email}${acc.nickname ? ` (${acc.nickname})` : ''} - ${acc.subscription?.title || '未知订阅'}`
        ).join('\n')

      default:
        throw new Error('不支持的导出格式')
    }
  } catch (error) {
    console.error('[导出] 生成内容失败:', error)
    throw error
  }
}
