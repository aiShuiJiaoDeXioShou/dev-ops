import { and, asc, count, eq, gt, inArray, lt, lte, ne, notExists, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Database } from '../../platform/database/client.ts'
import { appendBotEvents } from '../collaboration/bot-events.repository.ts'
import { botTask } from '../tasks/bot-tasks.tables.ts'
import { snapshotBotSkills } from './bots.skills.ts'
import { bot, botRun } from './bots.tables.ts'

export type BotRunTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
export type BotRunRecord = typeof botRun.$inferSelect

export interface BotRunLease {
  id: string
  owner: string
  epoch: number
}

export interface BotQueueLimits {
  global: number
  perTeam: number
  ttlSeconds: number
}

type FinishInput = {
  turns?: number
  usage?: unknown
} & ({ status: 'succeeded' | 'stopped' } | { status: 'failed'; failureKind: string; failureMessage: string })

/**
 * 新增已由业务用例校验的运行，并在同一事务发布排队状态。
 * @param tx 创建消息或任务时使用的事务。
 * @param input 所属团队、会话、Bot、触发人和可选的任务或消息。
 * @returns 排队记录；创建失败时抛错。
 */
export async function enqueueBotRun(
  tx: BotRunTransaction,
  input: Pick<
    typeof botRun.$inferInsert,
    'team_id' | 'conversation_id' | 'task_id' | 'bot_id' | 'trigger_user_id' | 'trigger_message_id' | 'input_version'
  >,
): Promise<BotRunRecord> {
  const [run] = await tx
    .insert(botRun)
    .values({
      ...input,
      created_at: sql`clock_timestamp()`,
      updated_at: sql`clock_timestamp()`,
    })
    .returning()
  if (!run) throw new Error('未能创建 Bot 运行')
  await writeRunState(tx, run)
  return run
}

async function writeRunState(tx: BotRunTransaction, run: BotRunRecord, actorId?: string) {
  await appendBotEvents(tx, { teamId: run.team_id, conversationId: run.conversation_id, runId: run.id }, [
    {
      kind: 'run_status',
      payload: {
        runId: run.id,
        botId: run.bot_id,
        status: run.status,
        failureKind: run.failure_kind,
        failureMessage: run.failure_message,
        stopRequested: run.stop_requested,
        ...(actorId ? { actorId } : {}),
      },
    },
  ])
}

function activeLease(lease: BotRunLease) {
  return and(
    eq(botRun.id, lease.id),
    eq(botRun.status, 'running'),
    eq(botRun.lease_owner, lease.owner),
    eq(botRun.lease_epoch, lease.epoch),
    gt(botRun.lease_until, sql`clock_timestamp()`),
  )
}

/**
 * 领取首条符合全局、团队与会话并发条件的工作，固定运行配置。
 * @param db 当前执行进程使用的数据库连接。
 * @param owner 执行进程唯一标识。
 * @param limits 全局和团队并发上限及租约秒数。
 * @returns 本进程领取的运行；当前没有名额或任务时返回 null。
 */
export async function claimBotRun(db: Database, owner: string, limits: BotQueueLimits): Promise<BotRunRecord | null> {
  return db.transaction(async (tx) => {
    // 领取需要跨进程核对同一份额度，单纯锁定候选运行无法防止超领。
    await tx.execute(sql`select pg_advisory_xact_lock(164836, 2)`)
    const [capacity] = await tx.select({ running: count() }).from(botRun).where(eq(botRun.status, 'running'))
    if (!capacity || capacity.running >= limits.global) return null

    const previous = alias(botRun, 'previous_run')
    const teamRunning = alias(botRun, 'team_running')
    const [candidate] = await tx
      .select({ id: botRun.id, teamId: botRun.team_id, botId: botRun.bot_id })
      .from(botRun)
      .where(
        and(
          eq(botRun.status, 'queued'),
          notExists(
            tx
              .select({ id: previous.id })
              .from(previous)
              .where(
                and(
                  eq(previous.conversation_id, botRun.conversation_id),
                  or(
                    eq(previous.status, 'running'),
                    and(
                      eq(previous.status, 'queued'),
                      or(
                        lt(previous.created_at, botRun.created_at),
                        and(eq(previous.created_at, botRun.created_at), lt(previous.id, botRun.id)),
                      ),
                    ),
                  ),
                ),
              ),
          ),
          sql`(${tx
            .select({ amount: count() })
            .from(teamRunning)
            .where(
              and(eq(teamRunning.team_id, botRun.team_id), eq(teamRunning.status, 'running')),
            )}) < ${limits.perTeam}`,
        ),
      )
      .orderBy(asc(botRun.created_at), asc(botRun.id))
      .limit(1)
      .for('update', { skipLocked: true })
    if (!candidate) return null
    const skillVersions = await snapshotBotSkills(tx, candidate.teamId, candidate.botId)

    const [run] = await tx
      .update(botRun)
      .set({
        status: 'running',
        lease_owner: owner,
        lease_until: sql`clock_timestamp() + ${limits.ttlSeconds} * interval '1 second'`,
        lease_epoch: sql`${botRun.lease_epoch} + 1`,
        config_snapshot: sql`coalesce((
          select jsonb_build_object(
            'name', ${bot.name}, 'responsibility', ${bot.responsibility}, 'instructions', ${bot.instructions},
            'modelConnectionId', ${bot.model_connection_id}, 'modelId', ${bot.model_id}, 'status', ${bot.status},
            'accessMode', ${bot.access_mode},
            'skillVersions', ${JSON.stringify(skillVersions)}::jsonb
          )
          from ${bot}
          where ${bot.id} = ${botRun.bot_id} and ${bot.team_id} = ${botRun.team_id}
        ), '{}'::jsonb)`,
        started_at: sql`clock_timestamp()`,
        updated_at: sql`clock_timestamp()`,
      })
      .where(and(eq(botRun.id, candidate.id), eq(botRun.status, 'queued')))
      .returning()
    if (!run) return null
    if (run.task_id) {
      await tx
        .update(botTask)
        .set({
          status: 'in_progress',
          wait_reason: null,
          version: sql`${botTask.version} + 1`,
          updated_at: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(botTask.id, run.task_id),
            eq(botTask.team_id, run.team_id),
            eq(botTask.executor_bot_id, run.bot_id),
            eq(botTask.input_version, run.input_version),
            eq(botTask.blocked, false),
            inArray(botTask.status, ['pending', 'waiting']),
          ),
        )
    }
    await writeRunState(tx, run)
    return run
  })
}

/**
 * 校验当前运行仍属于该租约，并把行锁持有到调用方事务结束。
 * @param tx 为工具事件或结果提供原子性的事务。
 * @param lease 执行进程持有的运行、领取者和代次。
 * @returns 当前状态；租约失效、结束或代次不符时返回 null。
 */
export async function lockBotRunLease(tx: BotRunTransaction, lease: BotRunLease): Promise<BotRunRecord | null> {
  const [run] = await tx.select().from(botRun).where(activeLease(lease)).for('update')
  return run ?? null
}

/**
 * 续租并读取停止请求。
 * @param db 数据库写入端。
 * @param lease 当前执行进程的领取凭证。
 * @param ttlSeconds 新租约在数据库当前时间之后的有效秒数。
 * @returns 停止标记；租约已失效时返回 null，失效的租约不能复活。
 */
export async function renewBotRunLease(db: Database, lease: BotRunLease, ttlSeconds: number) {
  const [updated] = await db
    .update(botRun)
    .set({
      lease_until: sql`clock_timestamp() + ${ttlSeconds} * interval '1 second'`,
      updated_at: sql`clock_timestamp()`,
    })
    .where(activeLease(lease))
    .returning({ stopRequested: botRun.stop_requested })
  return updated ?? null
}

async function updateTaskAfterRun(tx: BotRunTransaction, run: BotRunRecord) {
  if (!run.task_id) return
  const reason = run.status === 'stopped' ? 'stopped' : run.status === 'failed' ? 'run_failed' : 'needs_input'
  await tx
    .update(botTask)
    .set({
      status: 'waiting',
      wait_reason: reason,
      version: sql`${botTask.version} + 1`,
      updated_at: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(botTask.id, run.task_id),
        eq(botTask.team_id, run.team_id),
        eq(botTask.executor_bot_id, run.bot_id),
        eq(botTask.input_version, run.input_version),
        eq(botTask.status, 'in_progress'),
        eq(botTask.blocked, false),
      ),
    )
}

/**
 * 防止旧代次覆盖运行，原子写入终态与用量，并收口仍在执行的任务。
 * @param tx 用于同时提交最终消息的事务。
 * @param lease 执行进程的领取凭证。
 * @param outcome 运行终态、轮次和测得的用量。
 * @returns 更新后的运行；代次失效时返回 null，其他数据库异常向上传递。
 */
export async function finishBotRun(tx: BotRunTransaction, lease: BotRunLease, outcome: FinishInput) {
  const failure = outcome.status === 'failed' ? outcome : null
  const [run] = await tx
    .update(botRun)
    .set({
      status: sql`case when ${botRun.stop_requested} then 'stopped' else ${outcome.status} end`,
      failure_kind: sql`case when ${botRun.stop_requested} then null else ${failure?.failureKind ?? null} end`,
      failure_message: sql`case when ${botRun.stop_requested} then null else ${failure?.failureMessage ?? null} end`,
      usage: outcome.usage ?? null,
      turns: outcome.turns ?? 0,
      lease_owner: null,
      lease_until: null,
      finished_at: sql`clock_timestamp()`,
      updated_at: sql`clock_timestamp()`,
    })
    .where(activeLease(lease))
    .returning()
  if (!run) return null
  await updateTaskAfterRun(tx, run)
  await writeRunState(tx, run)
  return run
}

/**
 * 将一批已过期的运行收口为执行中断，不重新入队。
 * @param db 调度进程的数据库连接。
 * @returns 本次收口数量；另一调度进程持有的行留给该进程。
 */
export async function reconcileExpiredBotRuns(db: Database): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: botRun.id })
      .from(botRun)
      .where(and(eq(botRun.status, 'running'), lte(botRun.lease_until, sql`clock_timestamp()`)))
      .orderBy(asc(botRun.lease_until), asc(botRun.id))
      .limit(50)
      .for('update', { skipLocked: true })
    if (rows.length === 0) return 0
    const runs = await tx
      .update(botRun)
      .set({
        status: 'failed',
        failure_kind: 'execution_interrupted',
        failure_message: '执行服务已断开，可重新运行任务',
        lease_owner: null,
        lease_until: null,
        finished_at: sql`clock_timestamp()`,
        updated_at: sql`clock_timestamp()`,
      })
      .where(
        and(
          inArray(
            botRun.id,
            rows.map((row) => row.id),
          ),
          ne(botRun.status, 'failed'),
        ),
      )
      .returning()
    // 同一批次以会话标识排序，避免两个调度进程以相反顺序获取事件锁。
    runs.sort((left, right) => left.conversation_id.localeCompare(right.conversation_id))
    for (const run of runs) {
      await updateTaskAfterRun(tx, run)
      await writeRunState(tx, run)
    }
    return runs.length
  })
}

/**
 * 标记已停用 Bot 的在途运行，并在同一事务取消尚未开始的运行。
 * @param tx 保存停用状态的事务。
 * @param teamId Bot 所属团队。
 * @param botId 被停用的 Bot。
 * @returns 成功更新后完成。
 */
export async function stopRunsForBot(tx: BotRunTransaction, teamId: string, botId: string) {
  const scope = and(eq(botRun.team_id, teamId), eq(botRun.bot_id, botId))
  await tx
    .update(botRun)
    .set({ stop_requested: true, updated_at: sql`clock_timestamp()` })
    .where(and(scope, eq(botRun.status, 'running'), eq(botRun.stop_requested, false)))
  const cancelled = await tx
    .update(botRun)
    .set({
      status: 'stopped',
      finished_at: sql`clock_timestamp()`,
      updated_at: sql`clock_timestamp()`,
    })
    .where(and(scope, eq(botRun.status, 'queued')))
    .returning()
  cancelled.sort((left, right) => left.conversation_id.localeCompare(right.conversation_id))
  for (const run of cancelled) await writeRunState(tx, run)
}

/**
 * 停止待领取的运行，或设置执行进程下一次续租可读的停止标记。
 * @param tx 保持会话权限及任务更新原子性的事务。
 * @param runId 当前可管理的运行。
 * @param actorId 发起停止的用户。
 * @param resetTask 是否将尚未启动的关联任务转入等待；取消任务时关闭。
 * @returns 已更新的运行；已结束或不存在时返回 null。
 */
export async function requestBotRunStop(tx: BotRunTransaction, runId: string, actorId: string, resetTask = true) {
  const [run] = await tx
    .update(botRun)
    .set({
      status: sql`case when ${botRun.status} = 'queued' then 'stopped' else ${botRun.status} end`,
      stop_requested: true,
      finished_at: sql`case when ${botRun.status} = 'queued' then clock_timestamp() else ${botRun.finished_at} end`,
      updated_at: sql`clock_timestamp()`,
    })
    .where(and(eq(botRun.id, runId), inArray(botRun.status, ['queued', 'running'])))
    .returning()
  if (!run) return null
  if (run.status === 'stopped' && run.task_id && resetTask) {
    await tx
      .update(botTask)
      .set({
        status: 'waiting',
        wait_reason: 'stopped',
        version: sql`${botTask.version} + 1`,
        updated_at: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(botTask.id, run.task_id),
          eq(botTask.team_id, run.team_id),
          eq(botTask.executor_bot_id, run.bot_id),
          eq(botTask.input_version, run.input_version),
          eq(botTask.blocked, false),
          inArray(botTask.status, ['pending', 'waiting', 'in_progress']),
        ),
      )
  }
  await writeRunState(tx, run, actorId)
  return run
}

/**
 * 在成员退出时停止由其在当前团队触发的运行。
 * @param tx 提交成员状态变更的事务。
 * @param teamId 退出的团队。
 * @param userId 失去团队权限的运行触发人。
 * @param actorId 处理成员变更的操作者。
 * @returns 所有在途运行处理后结束；正执行的运行在续租时取消。
 */
export async function stopBotRunsForTriggerUser(
  tx: BotRunTransaction,
  teamId: string,
  userId: string,
  actorId: string,
) {
  const rows = await tx
    .select({ id: botRun.id })
    .from(botRun)
    .where(
      and(
        eq(botRun.team_id, teamId),
        eq(botRun.trigger_user_id, userId),
        inArray(botRun.status, ['queued', 'running']),
      ),
    )
    .orderBy(asc(botRun.conversation_id), asc(botRun.id))
    .for('update')
  for (const run of rows) await requestBotRunStop(tx, run.id, actorId)
}
