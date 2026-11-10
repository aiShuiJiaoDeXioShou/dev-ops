import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { z } from 'zod'
import { BotError } from '../errors.ts'
import { parseHistory } from '../history.ts'
import { MemoryWorkspace, normalizeMemory, type Memory } from '../memory.ts'
import { migrate } from './schema.ts'

const HISTORY_TURNS = 12
const sessionRow = z.object({ id: z.string(), version: z.number().int().nonnegative() })
const revisionRow = z.object({ memory_revision: z.number().int().nonnegative() })
const messageRow = z.object({ body_json: z.string() })
const memoryRow = z.object({
  id: z.string(),
  content: z.string(),
  essential: z.union([z.literal(0), z.literal(1)]),
  source_session_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export interface ConversationSnapshot {
  sessionId: string
  sessionVersion: number
  memoryRevision: number
  messages: AgentMessage[]
  memories: Memory[]
}

function databaseValue<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error('数据库 Bot 记录不合法')
  return result.data
}

/** 单机 Bot 持久化；运行期间不持有数据库事务，完成时通过版本检查共同提交。 */
export class BotStore {
  private readonly db: DatabaseSync

  /**
   * 打开 SQLite 并执行版本化迁移，数据文件仅当前用户可读写。
   * @param path 数据库绝对路径，测试允许使用 :memory:。
   * @returns 就绪的存储实例。
   * @throws 打开、迁移或权限设置失败时释放连接并抛出异常。
   */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: false, timeout: 5000 })
    try {
      if (path !== ':memory:') chmodSync(path, 0o600)
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
      migrate(this.db)
      const now = new Date().toISOString()
      this.db
        .prepare(
          `INSERT INTO bot_state (id, memory_revision, created_at, updated_at)
        VALUES ('default', 0, ?, ?) ON CONFLICT(id) DO NOTHING`,
        )
        .run(now, now)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  /**
   * 关闭本地数据库连接。
   * @returns 连接释放后结束，不删除数据文件；关闭失败时向上传递异常。
   */
  close(): void {
    this.db.close()
  }

  /**
   * 创建或读取会话，并在短事务内取得一致的历史和记忆快照。
   * @param name 会话名称，相同名称继续同一会话。
   * @returns 最近完整轮次与当前记忆修订。
   * @throws 名称不合法或数据库消息损坏时抛出异常。
   */
  snapshot(name: string): ConversationSnapshot {
    if (!name.trim() || name.trim().length > 80) throw new BotError('SESSION_INVALID', '会话名称须为 1-80 个字符')
    return this.transaction(() => {
      const now = new Date().toISOString()
      this.db
        .prepare(
          `INSERT INTO bot_session (id, name, version, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?) ON CONFLICT(name) DO NOTHING`,
        )
        .run(randomUUID(), name.trim(), now, now)
      const session = databaseValue(
        sessionRow,
        this.db.prepare('SELECT id, version FROM bot_session WHERE name = ?').get(name.trim()),
      )
      const memoryRevision = this.memoryRevision()
      const rows = this.db
        .prepare(
          `SELECT body_json FROM bot_message WHERE session_id = ? AND turn_number > ? AND memory_revision = ?
        ORDER BY sequence`,
        )
        .all(session.id, Math.max(0, session.version - HISTORY_TURNS), memoryRevision)
      const messages = rows.map((row) => JSON.parse(databaseValue(messageRow, row).body_json))
      return {
        sessionId: session.id,
        sessionVersion: session.version,
        memoryRevision,
        messages: parseHistory(messages),
        memories: this.memories(),
      }
    })
  }

  /**
   * 读取当前 Bot 的长期记忆。
   * @returns 已校验并按更新时间稳定排序的条目。
   * @throws 数据库记录不合法时抛出数据异常。
   */
  memories(): Memory[] {
    return this.db
      .prepare(
        `SELECT id, content, essential, source_session_id, created_at, updated_at
      FROM bot_memory ORDER BY updated_at DESC, id`,
      )
      .all()
      .map((value) => {
        const row = databaseValue(memoryRow, value)
        return {
          id: row.id,
          content: row.content,
          essential: row.essential === 1,
          sourceSessionId: row.source_session_id,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      })
  }

  /**
   * 原子提交一次成功运行的新消息和记忆工作副本。
   * @param snapshot 模型运行前的会话与记忆快照。
   * @param messages 本轮完整消息，包含工具调用及结果。
   * @param memories 本轮最终记忆副本。
   * @returns 提交完成后结束；版本冲突时回滚全部内容并抛出 CONVERSATION_CONFLICT。
   */
  commit(snapshot: ConversationSnapshot, messages: AgentMessage[], memories: Memory[]): void {
    const checked = parseHistory(messages)
    this.transaction(() => {
      if (this.memoryRevision() !== snapshot.memoryRevision) this.conflict()
      const now = new Date().toISOString()
      const updated = this.db
        .prepare(
          `UPDATE bot_session SET version = version + 1, updated_at = ?
        WHERE id = ? AND version = ?`,
        )
        .run(now, snapshot.sessionId, snapshot.sessionVersion)
      if (updated.changes !== 1) this.conflict()
      const sequenceRow = databaseValue(
        z.object({ next_sequence: z.number() }),
        this.db
          .prepare('SELECT COALESCE(MAX(sequence) + 1, 0) AS next_sequence FROM bot_message WHERE session_id = ?')
          .get(snapshot.sessionId),
      )
      const insert = this.db.prepare(`INSERT INTO bot_message
        (id, session_id, sequence, turn_number, memory_revision, body_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      for (const [index, message] of checked.entries()) {
        insert.run(
          randomUUID(),
          snapshot.sessionId,
          sequenceRow.next_sequence + index,
          snapshot.sessionVersion + 1,
          snapshot.memoryRevision,
          JSON.stringify(message),
          now,
          now,
        )
      }
      if (JSON.stringify(snapshot.memories) !== JSON.stringify(memories)) this.saveMemories(memories)
    })
  }

  /**
   * 在同一事务内处理手工记忆变更，保证运行中的旧快照不能恢复被遗忘内容。
   * @param edit 接收工作副本的同步回调，不得执行模型或其他网络调用。
   * @returns 编辑完成后结束；回调或保存失败时全部回滚。
   */
  editMemories(edit: (workspace: MemoryWorkspace) => void): void {
    this.transaction(() => {
      const previous = this.memories()
      const workspace = new MemoryWorkspace(previous)
      edit(workspace)
      const memories = workspace.list()
      if (JSON.stringify(previous) !== JSON.stringify(memories)) this.saveMemories(memories)
    })
  }

  private memoryRevision(): number {
    return databaseValue(
      revisionRow,
      this.db.prepare("SELECT memory_revision FROM bot_state WHERE id = 'default'").get(),
    ).memory_revision
  }

  private saveMemories(memories: Memory[]): void {
    const ids = new Set(memories.map((memory) => memory.id))
    for (const previous of this.memories()) {
      if (!ids.has(previous.id)) this.db.prepare('DELETE FROM bot_memory WHERE id = ?').run(previous.id)
    }
    const upsert = this.db.prepare(`INSERT INTO bot_memory
      (id, content, normalized_content, essential, source_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET content = excluded.content, normalized_content = excluded.normalized_content,
        essential = excluded.essential, source_session_id = excluded.source_session_id, updated_at = excluded.updated_at`)
    for (const memory of memories) {
      upsert.run(
        memory.id,
        memory.content,
        normalizeMemory(memory.content),
        Number(memory.essential),
        memory.sourceSessionId,
        memory.createdAt,
        memory.updatedAt,
      )
    }
    this.db
      .prepare("UPDATE bot_state SET memory_revision = memory_revision + 1, updated_at = ? WHERE id = 'default'")
      .run(new Date().toISOString())
  }

  private conflict(): never {
    throw new BotError('CONVERSATION_CONFLICT', '会话或记忆已被其他操作修改，本轮未保存，请重新发送')
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
