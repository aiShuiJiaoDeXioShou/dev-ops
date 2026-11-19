import {
  localTools,
  memoryTools,
  openApiTools,
  compactBotSession,
  runBotSession,
  webTools,
  type ApiInvoker,
  type PlatformApiOperation,
  type RunOutcome,
  type CompactBotSessionOptions,
} from '@dev-ops/devops-bot'
import { resolve } from 'node:path'
import type { Database } from '../../../platform/database/client.ts'
import type { AppConfig } from '../../../platform/config/env.ts'
import type { SecretCipher } from '../../configuration/configuration.crypto.ts'
import {
  finishBotRun,
  isConversationBotRun,
  releaseInterruptedBotRun,
  renewBotRunLease,
  type BotRunLease,
  type BotRunRecord,
  type ConversationBotRunRecord,
} from '../bots.run-queue.repository.ts'
import type { BotCallLog } from './api-invoker.ts'
import { loadBotRunContext } from './context.ts'
import { createPgCredentialStore } from './credential-store.ts'
import { createCurrentContextTool } from './current-context-tool.ts'
import { readBotMcpServers } from './mcp-configuration.ts'
import { fetchBotMcp } from './mcp-fetch.ts'
import { createPgMemoryStore } from './memory-store.ts'
import { fetchBotPublicPage } from './public-page.ts'
import { createSkillViewTool } from './skill-tool.ts'
import { createPgRunInputQueue } from './run-input-queue.ts'
import { createPgSessionStore, hasSavedBotInput } from './session-store.ts'
import { createPgRunSink } from './run-sink.ts'
import { auditBotWebTools } from './web-tool-audit.ts'
import { createTaskResultTool } from './task-tools.ts'

export type BotRunner = typeof runBotSession
export type BotCompactor = typeof compactBotSession

type RuntimeOptions = {
  config: AppConfig
  db: Database
  cipher: SecretCipher | null
  execute: BotRunner
  compact?: BotCompactor
  onFailure: (run: BotRunRecord) => void
  logCall?: (event: BotCallLog) => void
  platformApi?: (
    lease: BotRunLease,
    run: ConversationBotRunRecord,
  ) => { catalog: readonly PlatformApiOperation[]; invoker: ApiInvoker }
}

const unavailable: RunOutcome = {
  status: 'failed',
  failureKind: 'model_unavailable',
  failureMessage: 'Bot 的模型连接、会话或触发人已不可用',
  turns: 0,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
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
  if (!isConversationBotRun(run)) {
    await db.transaction((tx) => finishBotRun(tx, lease, unavailable))
    return
  }
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
  try {
    const input = await loadBotRunContext(db, run, config.BOT_ROOM_SYNC_LIMIT)
    if (!input) {
      await sink.finish(unavailable)
      return
    }
    if (input.hasUnavailableSkillReference) {
      await sink.finish({
        ...unavailable,
        status: 'failed',
        failureKind: 'tool_error',
        failureMessage: '引用的技能已停用或版本不可用',
      })
      return
    }
    const credentials = createPgCredentialStore({
      db,
      cipher: options.cipher,
      teamId: run.team_id,
      connectionId: input.connectionId,
    })
    const api = options.platformApi?.(lease, run)
    const memory = createPgMemoryStore(db, run, lease)
    const directory = resolve(config.BOT_WORKSPACE_DIR, run.team_id, run.bot_id)
    const tools = (await localTools({ directory, access: input.accessMode })).map((tool) => ({
      ...tool,
      /**
       * 执行本地工具前重查租约，防止已经切换权限的旧运行继续启动工具。
       * @param args 模型生成的工具参数。
       * @param toolSignal 运行取消信号。
       * @returns 本地执行结果；租约失效或已要求停止时返回失败。
       */
      async execute(args: unknown, toolSignal: AbortSignal) {
        const state = await renewBotRunLease(db, lease, config.BOT_LEASE_TTL_SECONDS)
        if (!state || state.stopRequested || toolSignal.aborted) {
          cancellation.abort()
          return { text: '运行已停止，请在新权限下重新发送消息', isError: true }
        }
        return tool.execute(args, toolSignal)
      },
    }))
    const settings: CompactBotSessionOptions = {
      model: input.model,
      workspace: { directory, access: input.accessMode },
      skills: input.skills,
      mcp: { servers: await readBotMcpServers(db, options.cipher, run.team_id, run.bot_id), fetch: fetchBotMcp },
      context: {
        ...input.context,
        layers: [
          ...input.context.layers,
          {
            title: '本地工作目录',
            body: `工作目录为 ${directory}。当前访问模式为 ${input.accessMode === 'full' ? '完全访问' : '沙盒，仅可访问工作目录中的文件'}。使用 read、write、edit、bash、grep、find、ls 或 powershell 处理本地文件。`,
          },
        ],
      },
      tools: [
        createCurrentContextTool(db, lease),
        ...tools,
        ...memoryTools(memory),
        createSkillViewTool(db, run, lease, input.skillVersions),
        ...auditBotWebTools(
          db,
          run,
          lease,
          webTools({
            providerId: input.model.providerId,
            credentials,
            fetchPublicPage: fetchBotPublicPage,
          }),
          options.logCall,
        ),
        ...(run.task_id ? [createTaskResultTool(db, lease)] : []),
        ...(api ? openApiTools(api.catalog, api.invoker) : []),
      ],
      limits: { timeoutMs: config.BOT_RUN_TIMEOUT_SECONDS * 1_000 },
      ...(run.kind === 'compact' ? {} : { queue: createPgRunInputQueue(db, run, lease) }),
      signal,
      ports: {
        credentials,
        sink,
        memory,
        session: createPgSessionStore(db, run, lease, input.roomCursor),
        api: api?.invoker ?? { invoke: async () => ({ ok: false, code: 'BOT_API_FORBIDDEN' }) },
      },
    }
    const resumed = run.resume_count > 0
    const outcome = input.input
      ? await options.execute({
          ...settings,
          input: resumed && (await hasSavedBotInput(db, run)) ? { kind: 'resume' } : { ...input.input, resumed },
        })
      : await (options.compact ?? compactBotSession)(settings)
    if (!leaseIsValid) return
    if (shutdown.aborted) await releaseInterruptedBotRun(db, lease, config.BOT_RESUME_LIMIT)
    else await sink.finish(outcome)
  } catch {
    options.onFailure(run)
    // 写入轮次失败也要清除定时刷新。不能以丢失事件的运行结果标成功。
    try {
      await sink.flush()
    } catch {
      cancellation.abort()
    }
    if (!leaseIsValid) return
    if (shutdown.aborted) {
      await releaseInterruptedBotRun(db, lease, config.BOT_RESUME_LIMIT)
    } else {
      await db.transaction((tx) =>
        finishBotRun(tx, lease, {
          status: 'failed',
          failureKind: 'tool_error',
          failureMessage: '运行处理失败，可重新运行任务',
        }),
      )
    }
  } finally {
    clearInterval(timer)
    await heartbeat
  }
}
