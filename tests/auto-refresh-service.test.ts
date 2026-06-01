import assert from 'node:assert/strict'
import { shouldRefreshBeforeNextCheck } from '../src/services/auto-refresh-service'

const now = new Date('2026-06-01T12:00:00.000Z').getTime()

assert.equal(
  shouldRefreshBeforeNextCheck(now + 20 * 60 * 1000, now, 30),
  true,
  '30 分钟检查间隔下，20 分钟后过期的 token 应提前刷新'
)

assert.equal(
  shouldRefreshBeforeNextCheck(now + 45 * 60 * 1000, now, 30),
  false,
  '30 分钟检查间隔下，45 分钟后过期的 token 暂不需要刷新'
)

assert.equal(
  shouldRefreshBeforeNextCheck(now + 5 * 60 * 1000, now, 1),
  true,
  '短检查间隔仍保留至少 10 分钟提前刷新'
)
