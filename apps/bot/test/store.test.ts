import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { BotStore } from '../src/storage/store.ts'
import { MemoryWorkspace } from '../src/memory.ts'

test('SQLite 迁移、重启恢复和会话隔离，长期记忆由所有会话共享', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bot-store-'))
  const path = join(directory, 'bot.sqlite')
  let store = new BotStore(path)
  try {
    const first = store.snapshot('first')
    store.commit(first, [{ role: 'user', content: '第一轮', timestamp: 1 }], first.memories)
    assert.equal(store.snapshot('first').messages.length, 1)
    assert.equal(store.snapshot('second').messages.length, 0)
    store.editMemories((workspace) => workspace.remember('偏好中文', true, null))
    store.close()
    store = new BotStore(path)
    assert.equal(store.snapshot('second').memories[0]?.content, '偏好中文')
    assert.equal(store.snapshot('first').messages.length, 0, '记忆修订后不再加载旧上下文')
    const current = store.snapshot('first')
    store.commit(current, [{ role: 'user', content: '新上下文', timestamp: 2 }], current.memories)
    assert.equal(store.snapshot('first').messages.length, 1)
    const db = new DatabaseSync(path)
    try {
      for (const table of ['bot_session', 'bot_message', 'bot_memory', 'bot_state']) {
        assert.equal(db.prepare(`PRAGMA foreign_key_list(${table})`).all().length, 0)
      }
      assert.equal(db.prepare('SELECT id FROM schema_migration').all().length, 1)
    } finally {
      db.close()
    }
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('并发会话提交只能成功一次，冲突不写入消息或记忆', () => {
  const directory = mkdtempSync(join(tmpdir(), 'bot-conflict-'))
  const path = join(directory, 'bot.sqlite')
  const first = new BotStore(path)
  const second = new BotStore(path)
  try {
    const snapshot = first.snapshot('shared')
    const stale = second.snapshot('shared')
    first.commit(snapshot, [{ role: 'user', content: '已提交', timestamp: 1 }], [])
    const workspace = new MemoryWorkspace([])
    workspace.remember('冲突记忆', false, stale.sessionId)
    assert.throws(
      () => second.commit(stale, [{ role: 'user', content: '冲突', timestamp: 2 }], workspace.list()),
      /其他操作修改/u,
    )
    assert.equal(first.snapshot('shared').messages.length, 1)
    assert.deepEqual(first.memories(), [])
  } finally {
    first.close()
    second.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('遗忘隔离旧历史，并阻止运行中的旧快照恢复被删除的记忆', () => {
  const store = new BotStore(':memory:')
  try {
    store.editMemories((workspace) => workspace.remember('需要遗忘的事实', false, null))
    const snapshot = store.snapshot('main')
    store.commit(snapshot, [{ role: 'user', content: '需要遗忘的事实', timestamp: 1 }], snapshot.memories)
    const stale = store.snapshot('main')
    const memory = stale.memories[0]
    assert.ok(memory)
    store.editMemories((workspace) => workspace.forget(memory.id))
    assert.throws(() => store.commit(stale, [], stale.memories), /其他操作修改/u)
    assert.deepEqual(store.snapshot('main').messages, [])
    assert.deepEqual(store.memories(), [])
    assert.throws(
      () =>
        store.editMemories((workspace) => {
          workspace.remember('回滚内容', false, null)
          throw new Error('失败')
        }),
      /失败/u,
    )
    assert.deepEqual(store.memories(), [])
  } finally {
    store.close()
  }
})

test('历史仅加载最近十二个完整轮次', () => {
  const store = new BotStore(':memory:')
  try {
    for (let index = 0; index < 15; index += 1) {
      const snapshot = store.snapshot('bounded')
      store.commit(snapshot, [{ role: 'user', content: String(index), timestamp: index }], [])
    }
    const messages = store.snapshot('bounded').messages
    assert.equal(messages.length, 12)
    assert.equal(messages[0]?.content, '3')
  } finally {
    store.close()
  }
})
