import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isUniqueViolation } from '../../src/platform/database/errors.ts'

test('数据库唯一冲突识别直接和多层包装的 SQLSTATE', () => {
  const violation = { code: '23505' }
  assert.equal(isUniqueViolation(violation), true)
  assert.equal(isUniqueViolation(new Error('查询失败', { cause: { cause: violation } })), true)
  assert.equal(isUniqueViolation(new Error('查询失败', { cause: { code: '23503' } })), false)
  assert.equal(isUniqueViolation(null), false)
})
