import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  validateAccessUrl,
  validateBuildResultStatus,
  validateBuildSource,
  validateCollectedAt,
  validateEnvironment,
  validateReason,
} from '../src/modules/delivery/delivery.validators.ts'

test('交付校验：环境、状态、来源、URL、时间与原因', () => {
  assert.equal(validateEnvironment('test'), 'test')
  assert.throws(() => validateEnvironment('staging'))
  assert.equal(validateBuildResultStatus('succeeded'), 'succeeded')
  assert.throws(() => validateBuildResultStatus('done'))
  assert.equal(validateBuildSource('pipeline'), 'pipeline')
  assert.throws(() => validateBuildSource('ci'))
  assert.equal(validateAccessUrl('https://example.test/a.apk'), 'https://example.test/a.apk')
  assert.throws(() => validateAccessUrl('file:///tmp/a.apk'))
  assert.throws(() => validateAccessUrl('https://user:pass@example.test/a'))
  assert.throws(() => validateAccessUrl('javascript:alert(1)'))
  assert.equal(validateReason(' 修正结果 '), '修正结果')
  assert.throws(() => validateReason('   '))
  assert.ok(validateCollectedAt(new Date().toISOString()) instanceof Date)
  assert.throws(() => validateCollectedAt('1999-12-31T23:59:59Z'))
  assert.throws(() => validateCollectedAt('not-a-date'))
})
