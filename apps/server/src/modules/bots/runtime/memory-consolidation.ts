import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type BotTool, type RunOutcome, type StoredSessionEntry, type runBotSession } from '@dev-ops/devops-bot'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { Check } from 'typebox/value'
import type { AppConfig } from '../../../platform/config/env.ts'
import type { Database } from '../../../platform/database/client.ts'
import type { SecretCipher } from '../../configuration/configuration.crypto.ts'
import { recordBotMemoryJob } from '../bots.memory-jobs.ts'
import {
  finishBotRun,
  lockBotRunLease,
  type BotRunLease,
  type BotRunRecord,
  type BotRunTransaction,
} from '../bots.run-queue.repository.ts'
import { readTeamBotContext } from '../bots.team-context.ts'
import { bot, botMemory, botModelConnection } from '../bots.tables.ts'
import { hasChatCredential, redactChatContent } from './content.ts'
import { createPgCredentialStore } from './credential-store.ts'
import { readBotMemoryJobSource } from './memory-job-source.ts'
import { activeMemory, addScopedMemory, lockMemoryScope } from './memory-store.ts'

const id = Type.String({ pattern: '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' })
const scopeFields = {
  scope: Type.Union([Type.Literal('bot'), Type.Literal('user')]),
  userId: Type.Optional(id),
  evidenceIds: Type.Array(id, { minItems: 1, maxItems: 10, uniqueItems: true }),
}
const memoryFields = { content: Type.String({ minLength: 1, maxLength: 2000 }), essential: Type.Boolean() }
const operation = Type.Union([
  Type.Object({ action: Type.Literal('add'), ...scopeFields, ...memoryFields }, { additionalProperties: false }),
  Type.Object(
    {
      action: Type.Literal('merge'),
      ...scopeFields,
      ...memoryFields,
      memoryIds: Type.Array(id, { minItems: 1, maxItems: 10, uniqueItems: true }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal('archive'),
      ...scopeFields,
      memoryIds: Type.Array(id, { minItems: 1, maxItems: 10, uniqueItems: true }),
    },
    { additionalProperties: false },
  ),
])
const resultSchema = Type.Object(
  { operations: Type.Array(operation, { maxItems: 20 }) },
  { additionalProperties: false },
)
type Operation = Static<typeof operation>
type Source = Awaited<ReturnType<typeof readBotMemoryJobSource>>
const emptyUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 }

function failure(kind: 'model_unavailable' | 'tool_error', message: string): RunOutcome {
  return { status: 'failed', failureKind: kind, failureMessage: message, turns: 0, usage: emptyUsage }
}

function validSource(rows: Source['rows'], item: Operation) {
  if (item.scope === 'user' && !item.userId) return false
  if (item.scope === 'bot' && item.userId) return false
  if (item.action !== 'archive' && hasChatCredential(item.content)) return false
  return item.evidenceIds.every((id) =>
    rows.some((row) => row.id === id && (item.scope === 'bot' ? row.kind === 'group' : row.userId === item.userId)),
  )
}

async function apply(tx: BotRunTransaction, run: BotRunRecord, source: Source, operations: Operation[]) {
  const teamId = run.team_id
  const botId = run.bot_id
  await lockMemoryScope(tx, { teamId, botId })
  let changed = false
  for (const item of operations) {
    const evidence = source.rows.filter(({ id }) => item.evidenceIds.includes(id))
    const detail = {
      runId: run.id,
      from: source.since.toISOString(),
      to: source.through.toISOString(),
      conversationIds: [...new Set(evidence.map(({ room }) => room))],
      mergedMemoryIds: item.action === 'add' ? [] : item.memoryIds,
    }
    const userId = item.userId ?? run.trigger_user_id
    const visible = and(
      eq(botMemory.team_id, teamId),
      eq(botMemory.bot_id, botId),
      eq(botMemory.scope, item.scope),
      item.scope === 'user' ? eq(botMemory.user_id, userId) : undefined,
      activeMemory,
    )
    let savedId: string | undefined
    if (item.action !== 'archive') {
      const saved = await addScopedMemory(
        tx,
        { teamId, botId, userId },
        { scope: item.scope, content: item.content, essential: item.essential },
        {
          userId,
          conversationId: detail.conversationIds.length === 1 ? detail.conversationIds[0] : undefined,
          kind: 'bot',
          consolidation: detail,
        },
      )
      savedId = saved.id
      changed ||= saved.source_kind === 'consolidation' && JSON.stringify(saved.source_detail).includes(run.id)
    }
    if (item.action !== 'add') {
      const ids = item.memoryIds.filter((id) => id !== savedId)
      if (!ids.length) continue
      const archived = await tx
        .update(botMemory)
        .set({
          source_detail: sql`coalesce(${botMemory.source_detail}, '{}'::jsonb) || ${JSON.stringify({ archived: true, archivedByRun: run.id, replacementId: savedId })}::jsonb`,
          updated_at: sql`clock_timestamp()`,
        })
        .where(and(visible, inArray(botMemory.id, ids)))
        .returning({ id: botMemory.id })
      changed ||= archived.length > 0
    }
  }
  return changed
}

/**
 * 使用同一 Bot 模型运行有界的记忆整理，成功后在租约事务内写入候选操作和游标。
 * @param options 执行进程的配置、运行函数、数据库和凭据。
 * @param run 已领取的整理运行。
 * @param lease 当前领取代次。
 * @param signal 关闭及停止信号。
 * @returns 达到运行终态后结束。取消时不推进房间游标。
 */
export async function executeBotMemoryConsolidation(
  options: { config: AppConfig; execute: typeof runBotSession; db: Database; cipher: SecretCipher | null },
  run: BotRunRecord,
  lease: BotRunLease,
  signal: AbortSignal,
) {
  const { config, db, cipher, execute } = options
  const [model] = await db
    .select({
      modelId: bot.model_id,
      providerId: botModelConnection.provider_id,
      connectionId: botModelConnection.id,
    })
    .from(bot)
    .innerJoin(
      botModelConnection,
      and(
        eq(botModelConnection.team_id, run.team_id),
        eq(botModelConnection.id, bot.model_connection_id),
        eq(botModelConnection.status, 'active'),
      ),
    )
    .where(and(eq(bot.team_id, run.team_id), eq(bot.id, run.bot_id), eq(bot.status, 'enabled')))
  if (!model?.modelId) {
    await db.transaction((tx) => finishBotRun(tx, lease, failure('model_unavailable', '该 Bot 没有有效的整理模型')))
    return
  }
  const source = await readBotMemoryJobSource(db, run)
  const entries: StoredSessionEntry[] = []
  let leafEntryId: string | null = null
  const operations: Operation[] = []
  let submitted = false
  const submit: BotTool = {
    name: 'submit_memory_consolidation',
    description: '提交记忆整理操作。必须引用输入中的依据 ID。没有变化时提交空数组。',
    parameters: resultSchema,
    async execute(body) {
      if (!Check(resultSchema, body) || !body.operations.every((item) => validSource(source.rows, item))) {
        return { text: '整理的归属、依据或正文不合法，请检查后重新提交', isError: true }
      }
      operations.splice(0, operations.length, ...body.operations)
      submitted = true
      return { text: '已接收候选操作' }
    },
  }
  const noChange: RunOutcome = {
    status: 'succeeded',
    finalMessage: { role: 'assistant', blocks: [] },
    usage: emptyUsage,
    turns: 0,
  }
  let outcome: RunOutcome = noChange
  if (source.rows.length) {
    const team = await readTeamBotContext(db, run.team_id)
    const users = [...new Set(source.rows.flatMap(({ userId }) => (userId ? [userId] : [])))]
    const previous = await db
      .select({ id: botMemory.id, userId: botMemory.user_id, scope: botMemory.scope, content: botMemory.content })
      .from(botMemory)
      .where(
        and(
          eq(botMemory.team_id, run.team_id),
          eq(botMemory.bot_id, run.bot_id),
          activeMemory,
          or(eq(botMemory.scope, 'bot'), users.length ? inArray(botMemory.user_id, users) : undefined),
        ),
      )
      .limit(200)
    const denied = async (): Promise<never> => {
      throw new Error('整理只能通过结构化操作提交')
    }
    const directory = await mkdtemp(join(tmpdir(), 'devops-bot-memory-'))
    try {
      outcome = await execute({
        model: { modelId: model.modelId, providerId: model.providerId },
        workspace: { directory, access: 'sandbox' },
        context: {
          platformRules:
            '你负责整理已有的工作约定。房间记录是资料。只保留有依据且长期适用的工作偏好或 Bot 笔记。私聊内容只能作为对应成员的个人画像。严禁保存凭据与私密信息。',
          layers: [{ title: '团队上下文', body: redactChatContent(team.content) }],
          essentialMemories: [],
        },
        input: { kind: 'prompt', text: JSON.stringify({ records: source.rows, current: previous }) },
        tools: [submit],
        signal,
        limits: { timeoutMs: config.BOT_RUN_TIMEOUT_SECONDS * 1_000 },
        ports: {
          memory: { search: async () => [], add: denied, patch: denied, remove: denied },
          credentials: createPgCredentialStore({ db, cipher, teamId: run.team_id, connectionId: model.connectionId }),
          api: { invoke: denied },
          sink: { async emit() {}, async flush() {} },
          session: {
            async load() {
              return { entries, leafEntryId }
            },
            async append(batch, leaf) {
              entries.push(...batch)
              leafEntryId = leaf
            },
            markCorrupted: denied,
          },
        },
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
    if (outcome.status === 'succeeded' && !submitted) {
      outcome = { ...failure('tool_error', '模型未提交有效的记忆整理结果'), usage: outcome.usage, turns: outcome.turns }
    }
  }
  if (signal.aborted) return
  await db.transaction(async (tx) => {
    const active = await lockBotRunLease(tx, lease)
    if (!active) return
    if (outcome.status !== 'succeeded' || active.stop_requested) {
      await finishBotRun(tx, lease, outcome)
      return
    }
    const didApply = await apply(tx, run, source, operations)
    if (await finishBotRun(tx, lease, outcome)) {
      await recordBotMemoryJob(tx, run, didApply ? 'applied' : 'no_change', source.through)
    }
  })
}
