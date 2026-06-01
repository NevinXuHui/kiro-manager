import assert from 'node:assert/strict'
import { buildExportFilename } from '../src/utils/account-utils'

const fixedDate = new Date('2026-06-01T12:00:00.000Z')

assert.equal(buildExportFilename(6, 'json', fixedDate), 'kiro-accounts-6-2026-06-01.json')
assert.equal(buildExportFilename(4, 'txt', fixedDate), 'kiro-accounts-4-2026-06-01.txt')
assert.equal(buildExportFilename(0, 'csv', fixedDate), 'kiro-accounts-0-2026-06-01.csv')
