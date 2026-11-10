import type { DatabaseSync } from 'node:sqlite'

const migrations = [
  `
  -- 会话保存人类可读名称与乐观锁；版本用于阻止并发覆盖。
  CREATE TABLE bot_session (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX uk_bot_session_name ON bot_session(name);
  -- 每个消息保存 pi 的完整文本协议；不保存系统提示词，避免已遗忘记忆随历史重新注入。
  CREATE TABLE bot_message (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence >= 0),
    turn_number INTEGER NOT NULL CHECK(turn_number > 0),
    -- 记忆版本变化后隔离旧上下文，防止遗忘内容经历史再次传给模型。
    memory_revision INTEGER NOT NULL CHECK(memory_revision >= 0),
    body_json TEXT NOT NULL CHECK(json_valid(body_json)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX uk_bot_message_session_sequence ON bot_message(session_id, sequence);
  -- 长期记忆按条目保存；essential 表示常驻上下文，source_session_id 为空表示手工添加。
  CREATE TABLE bot_memory (
    id TEXT PRIMARY KEY, content TEXT NOT NULL, normalized_content TEXT NOT NULL,
    essential INTEGER NOT NULL CHECK(essential IN (0, 1)), source_session_id TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX uk_bot_memory_normalized_content ON bot_memory(normalized_content);
  -- 本地单 Bot 的记忆修订；所有会话与手工记忆修改共同检查，防止已删记忆被旧运行恢复。
  CREATE TABLE bot_state (
    id TEXT PRIMARY KEY, memory_revision INTEGER NOT NULL DEFAULT 0 CHECK(memory_revision >= 0),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT;
  `,
]

/**
 * 在短事务中执行版本化 SQLite 迁移，不创建数据库外键。
 * @param db 已配置的 SQLite 连接。
 * @returns 迁移完成后结束；失败时回滚当前迁移并向上传递异常。
 */
export function migrate(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  ) STRICT`)
  for (const [index, sql] of migrations.entries()) {
    db.exec('BEGIN IMMEDIATE')
    try {
      if (!db.prepare('SELECT id FROM schema_migration WHERE id = ?').get(index + 1)) {
        db.exec(sql)
        const now = new Date().toISOString()
        db.prepare('INSERT INTO schema_migration (id, created_at, updated_at) VALUES (?, ?, ?)').run(
          index + 1,
          now,
          now,
        )
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
}
