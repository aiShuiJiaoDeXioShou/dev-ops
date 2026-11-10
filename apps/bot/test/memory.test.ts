import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MemoryWorkspace } from '../src/memory.ts'

test('记忆去重、关键词检索、更新和遗忘', () => {
  const workspace = new MemoryWorkspace([])
  const original = workspace.remember(' 喜欢 TypeScript ', false, null)
  assert.equal(workspace.remember('喜欢 typescript', false, null).id, original.id)
  assert.equal(workspace.search('TYPESCRIPT').length, 1)
  workspace.remember('喜欢中文', true, null, original.id)
  assert.equal(workspace.search('typescript').length, 0)
  assert.equal(workspace.list()[0]?.essential, true)
  workspace.forget(original.id)
  assert.deepEqual(workspace.list(), [])
  assert.throws(() => workspace.forget(original.id), /不存在/u)
})

test('拒绝空内容、明显凭据和超出常驻预算的内容，工作副本不改变来源', () => {
  const workspace = new MemoryWorkspace([])
  assert.throws(() => workspace.remember('', false, null), /正文/u)
  assert.throws(() => workspace.remember(`sk-${'x'.repeat(24)}`, false, null), /凭据/u)
  assert.throws(() => workspace.remember('中'.repeat(2000), true, null), /预算/u)
  const record = workspace.remember('保留', false, null)
  const copy = new MemoryWorkspace(workspace.list())
  copy.forget(record.id)
  assert.equal(workspace.list().length, 1)
})
