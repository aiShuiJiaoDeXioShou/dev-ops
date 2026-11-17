import { randomUUID } from 'node:crypto'
import { createDatabase } from '../platform/database/client.ts'
import type { AppConfig } from '../platform/config/env.ts'
import { claimBotRun } from '../modules/bots/bots.run-queue.repository.ts'
import { executeClaimedBotRun, type BotRunner } from '../modules/bots/runtime/execute-run.ts'
import { createSecretCipher } from '../modules/configuration/configuration.crypto.ts'
import {
  heartbeatBotModelCatalog,
  publishBotModelCatalog,
  type BotModelCatalogEntry,
} from '../modules/bots/bots.catalog.ts'
import { runPendingBotLogin, type BotProviderLogin } from '../modules/bots/runtime/login-runner.ts'

type Log = (level: 'info' | 'error', message: string, context?: Record<string, unknown>) => void
const POLL_INTERVAL_MS = 1_000
const CATALOG_HEARTBEAT_INTERVAL_MS = 30_000

/**
 * 组装 Bot 执行服务的轮询、并发和关闭生命周期。
 * @param config 已校验的进程配置。
 * @param execute 共享库运行函数，测试可注入库的 faux 实现。
 * @param log 结构化日志函数，传入运行标识而不传入模型内容和异常原文。
 * @param options 执行服务在启动时报告的模型目录和订阅登录入口。
 * @returns 启动、单批领取和关闭函数；调用方负责在终止时关闭服务。
 */
export function createBotWorker(
  config: AppConfig,
  execute: BotRunner,
  log: Log,
  options: { catalog?: readonly BotModelCatalogEntry[]; login?: BotProviderLogin } = {},
) {
  const database = createDatabase(config, (code) => log('error', 'Bot 数据库空闲连接异常', { code }))
  const db = database.db
  const owner = randomUUID()
  const cipher = config.GIT_CREDENTIAL_ENCRYPTION_KEY ? createSecretCipher(config.GIT_CREDENTIAL_ENCRYPTION_KEY) : null
  const shutdown = new AbortController()
  const active = new Set<Promise<void>>()
  const limits = {
    global: config.BOT_GLOBAL_CONCURRENCY,
    perTeam: config.BOT_TEAM_CONCURRENCY,
    ttlSeconds: config.BOT_LEASE_TTL_SECONDS,
  }
  const onFailure = (run: { id: string; bot_id: string; team_id: string; conversation_id: string }) =>
    log('error', 'Bot 执行失败', {
      runId: run.id,
      botId: run.bot_id,
      teamId: run.team_id,
      conversationId: run.conversation_id,
    })
  let timer: NodeJS.Timeout | undefined
  let catalogTimer: NodeJS.Timeout | undefined
  let catalogHeartbeat: Promise<void> | undefined
  let loginJob: Promise<void> | undefined
  let polling: Promise<void> | undefined
  let closing: Promise<void> | undefined

  async function claimAvailable() {
    while (!shutdown.signal.aborted && active.size < limits.global) {
      const run = await claimBotRun(db, owner, limits)
      if (!run) return
      const running = executeClaimedBotRun({ config, db, cipher, execute, onFailure }, run, shutdown.signal)
        .catch(() => onFailure(run))
        .finally(() => {
          active.delete(running)
        })
      active.add(running)
    }
  }

  async function pollOnce() {
    polling ??= claimAvailable()
      .catch(() => log('error', 'Bot 队列领取失败', { workerId: owner }))
      .finally(() => {
        polling = undefined
      })
    await polling
  }

  function pollLogin() {
    if (loginJob || shutdown.signal.aborted || !options.login || !cipher) return
    loginJob = runPendingBotLogin(db, owner, options.login, cipher, shutdown.signal)
      .then(() => undefined)
      .catch(() => log('error', 'Bot 订阅登录领取或持久化失败', { workerId: owner }))
      .finally(() => {
        loginJob = undefined
      })
  }

  function reportOnline() {
    if (catalogHeartbeat || shutdown.signal.aborted) return
    catalogHeartbeat = heartbeatBotModelCatalog(db)
      .catch(() => log('error', 'Bot 模型目录心跳失败', { workerId: owner }))
      .finally(() => {
        catalogHeartbeat = undefined
      })
  }

  return {
    /** 验证连接并开启轮询。数据库不可用时拒绝启动。 */
    async start() {
      await database.check()
      if (shutdown.signal.aborted || timer) return
      if (options.catalog) {
        await publishBotModelCatalog(db, options.catalog)
        catalogTimer = setInterval(reportOnline, CATALOG_HEARTBEAT_INTERVAL_MS)
      }
      timer = setInterval(() => {
        void pollOnce()
        pollLogin()
      }, POLL_INTERVAL_MS)
      pollLogin()
      await pollOnce()
      log('info', 'Bot 执行服务已启动', { workerId: owner, ...limits })
    },
    /** 立即领取当前可执行的运行，主要用于测试或本地排查。 */
    pollOnce,
    /** 停止领取，取消活跃模型调用并关闭连接池；重复调用等待同一次关闭。 */
    async close() {
      closing ??= (async () => {
        shutdown.abort()
        if (timer) clearInterval(timer)
        if (catalogTimer) clearInterval(catalogTimer)
        await polling
        await Promise.all([...active, loginJob, catalogHeartbeat])
        await database.close()
      })()
      await closing
    },
  }
}
