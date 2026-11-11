import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildRequestFingerprint, requireIdempotencyKey } from '../../src/modules/tools/tools.service.ts'

test('幂等指纹对键顺序不敏感且对内容敏感', () => {
  const a = buildRequestFingerprint({ repositoryId: 'repo-1', title: '修复', nested: { b: 2, a: 1 } })
  const b = buildRequestFingerprint({ nested: { a: 1, b: 2 }, title: '修复', repositoryId: 'repo-1' })
  assert.equal(a, b)
  assert.match(a, /^[0-9a-f]{64}$/)
  const c = buildRequestFingerprint({ repositoryId: 'repo-1', title: '修复', nested: { a: 1, b: 3 } })
  assert.notEqual(a, c)
})

test('数组顺序参与指纹，未定义字段被忽略', () => {
  const first = buildRequestFingerprint({ values: ['a', 'b'], ignored: undefined })
  const second = buildRequestFingerprint({ values: ['b', 'a'] })
  assert.notEqual(first, second)
  assert.equal(first, buildRequestFingerprint({ values: ['a', 'b'] }))
})

test('幂等键缺失、空白或超长时拒绝', () => {
  assert.throws(() => requireIdempotencyKey(undefined), /缺少 Idempotency-Key/)
  assert.throws(() => requireIdempotencyKey('   '), /缺少 Idempotency-Key/)
  assert.throws(() => requireIdempotencyKey('x'.repeat(201)), /不能超过 200 字符/)
  assert.equal(requireIdempotencyKey(' demo-key '), 'demo-key')
})
