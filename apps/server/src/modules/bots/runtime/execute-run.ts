import { runBot, webTools, type RunOutcome } from '@dev-ops/devops-bot'
import type { Database } from '../../../platform/database/client.ts'
import type { AppConfig } from '../../../platform/config/env.ts'
import type { SecretCipher } from '../../configuration/configuration.crypto.ts'
import { finishBotRun, renewBotRunLease, type BotRunRecord } from '../bots.run-queue.repository.ts'
import { loadBotRunContext } from './context.ts'
import { createPgCredentialStore } from './credential-store.ts'
import { createPgRunSink } from './run-sink.ts'

export type BotRunner = typeof runBot

type RuntimeOptions = {
  config: AppConfig
  db: Database
  cipher: SecretCipher | null
  execute: BotRunner
  onFailure: (run: BotRunRecord) => void
}

const unavailable: RunOutcome = {
  status: 'failed',
  failureKind: 'model_unavailable',
  failureMessage: 'Bot 的模型连接、会话或触发人已不可用',
  turns: 0,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
}

async function unavailableMemoryWrite(): Promise<never> {
  throw new Error('当前运行未注册记忆工具')
}

/**
 * 在当前代次内调用运行库，订阅停止请求并持久化结果。
 * @param options 已校验配置、数据库与运行时依赖。
 * @param run 已领取的运行。
 * @param shutdown 执行进程关闭信号。
 * @returns 本次运行结束后完成，写入异常向进程调度器传播。
 */
export async function executeClaimedBotRun(options: RuntimeOptions, run: BotRunRecord, shutdown: AbortSignal) {
  const { db, config } = options
  if (!run.lease_owner) throw new Error('Bot 运行缺少租约领取者')
  const lease = { id: run.id, owner: run.lease_owner, epoch: run.lease_epoch }
  const cancellation = new AbortController()
  const signal = AbortSignal.any([cancellation.signal, shutdown])
  let heartbeat: Promise<void> | undefined
  let leaseIsValid = true
  const timer = setInterval(() => {
    if (heartbeat || signal.aborted) return
    heartbeat = renewBotRunLease(db, lease, config.BOT_LEASE_TTL_SECONDS)
      .then((state) => {
        if (!state) leaseIsValid = false
        if (!state || state.stopRequested) cancellation.abort()
      })
      .catch(() => {
        leaseIsValid = false
        options.onFailure(run)
        cancellation.abort()
      })
      .finally(() => {
        heartbeat = undefined
      })
  }, config.BOT_LEASE_HEARTBEAT_SECONDS * 1_000)
  const sink = createPgRunSink(db, run, lease, () => cancellation.abort())
  const interrupted = {
    status: 'failed',
    failureKind: 'execution_interrupted',
    failureMessage: '执行服务已关闭，可重新运行任务',
  } as const
  try {
    const input = await loadBotRunContext(db, run)
    if (!input) {
      await sink.finish(unavailable)
      return
    }
    const credentials = createPgCredentialStore({
      db,
      cipher: options.cipher,
      teamId: run.team_id,
      connectionId: input.connectionId,
    })
    const outcome = await options.execute({
      model: input.model,
      context: input.context,
      tools: webTools({ providerId: input.model.providerId, credentials }),
      limits: { maxTurns: config.BOT_RUN_MAX_TURNS, timeoutMs: config.BOT_RUN_TIMEOUT_SECONDS * 1_000 },
      signal,
      ports: {
        credentials,
        sink,
        memory: {
          search: async () => [],
          add: unavailableMemoryWrite,
          patch: unavailableMemoryWrite,
          remove: unavailableMemoryWrite,
        },
        api: { invoke: async () => ({ ok: false, code: 'BOT_API_FORBIDDEN' }) },
      },
    })
    if (leaseIsValid) await sink.finish(shutdown.aborted ? { ...outcome, ...interrupted } : outcome)
  } catch {
    options.onFailure(run)
    // 写入轮次失败也要清除定时刷新。不能以丢失事件的运行结果标成功。
    try {
      await sink.flush()
    } catch {
      cancellation.abort()
    }
    if (leaseIsValid) {
      await db.transaction((tx) =>
        finishBotRun(
          tx,
          lease,
          shutdown.aborted
            ? interrupted
            : {
                status: 'failed',
                failureKind: 'tool_error',
                failureMessage: '运行处理失败，可重新运行任务',
              },
        ),
      )
    }
  } finally {
    clearInterval(timer)
    await heartbeat
  }
}
