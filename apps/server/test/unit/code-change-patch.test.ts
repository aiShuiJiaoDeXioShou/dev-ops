import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { validateCodeChangeInput } from '../../src/modules/tools/tools.code-change.service.ts'

const MAX = 1024

function input(overrides: Record<string, unknown> = {}) {
  const patch = 'diff --git a/a.ts b/a.ts\n+const a = 1\n'
  return {
    idempotencyKey: 'key-1',
    repositoryId: 'repo-1',
    baseRef: 'main',
    branchName: 'feature/demo',
    commitMessage: '演示',
    patch,
    patchSha256: createHash('sha256').update(patch, 'utf8').digest('hex'),
    validationWorkflowPath: '.devops/workflows/validate.yml',
    ...overrides,
  }
}

test('代码变更补丁校验：摘要、大小、分支与空补丁', () => {
  const valid = validateCodeChangeInput(input(), MAX)
  assert.equal(valid.patchSizeBytes > 0, true)
  assert.equal(valid.branchName, 'feature/demo')

  assert.throws(() => validateCodeChangeInput(input({ patchSha256: 'c'.repeat(64) }), MAX), /摘要不一致/)
  assert.throws(() => validateCodeChangeInput(input({ patch: 'x'.repeat(MAX + 1) }), MAX), /超过/)
  assert.throws(() => validateCodeChangeInput(input({ patch: '   ' }), MAX), /不能为空/)
  assert.throws(() => validateCodeChangeInput(input({ branchName: 'main' }), MAX), /不能与基线相同/)
  assert.throws(() => validateCodeChangeInput(input({ branchName: 'bad..branch' }), MAX), /不合法/)
})
