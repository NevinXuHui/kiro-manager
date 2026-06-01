import assert from 'node:assert/strict'
import { smartParseFormatImportAccounts } from '../src/utils/format-import-parser'

const dashedSocialLine = 'aorTEST_REFRESH_TOKEN_VALUE_1234567890:TEST_SIGNATURE_VALUE_abcdefghijklmnopqrstuvwxyz+/=----social----google----person@example.com----alias----backup@example.net----metadata'

const accounts = smartParseFormatImportAccounts(dashedSocialLine)

assert.equal(accounts.length, 1)
assert.equal(accounts[0].refreshToken, dashedSocialLine.split('----')[0])
assert.equal(accounts[0].authMethod, 'social')
assert.equal(accounts[0].provider, 'Google')
assert.equal(accounts[0].email, 'person@example.com')
assert.equal(accounts[0].region, 'us-east-1')

const rtFieldAccounts = smartParseFormatImportAccounts(`
  备注: 手工整理
  rt: aorBBBBBExample:abcDEF+ghi/jkl
  email: test@example.com
`)

assert.equal(rtFieldAccounts.length, 1)
assert.equal(rtFieldAccounts[0].refreshToken, 'aorBBBBBExample:abcDEF+ghi/jkl')
assert.equal(rtFieldAccounts[0].email, 'test@example.com')

const jsonAccounts = smartParseFormatImportAccounts(JSON.stringify({
  accounts: [
    {
      credentials: {
        refreshToken: 'aorCCCCCTest',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        region: 'eu-west-1'
      },
      email: 'json@example.com'
    }
  ]
}))

assert.equal(jsonAccounts.length, 1)
assert.equal(jsonAccounts[0].refreshToken, 'aorCCCCCTest')
assert.equal(jsonAccounts[0].clientId, 'client-id')
assert.equal(jsonAccounts[0].email, 'json@example.com')
assert.equal(jsonAccounts[0].region, 'eu-west-1')
