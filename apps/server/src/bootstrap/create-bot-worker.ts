import { randomUUID } from 'node:crypto'
import { createDatabase } from '../platform/database/client.ts'
import type { AppConfig } from '../platform/config/env.ts'
import {
  claimBotRun,
  type BotRunLease,
  type BotRunRecord,
  type ConversationBotRunRecord,
} from '../modules/bots/bots.run-queue.repository.ts'
import { executeClaimedBotRun, type BotCompactor, type BotRunner } from '../modules/bots/runtime/execute-run.ts'
import { createSecretCipher } from '../modules/configuration/configuration.crypto.ts'
import {
  heartbeatBotModelCatalog,
  publishBotModelCatalog,
  type BotModelCatalogEntry,
} from '../modules/bots/bots.catalog.ts'
import { enqueueBotMemoryJobs } from '../modules/bots/bots.memory-jobs.ts'
import { runPendingBotLogin, type BotProviderLogin } from '../modules/bots/runtime/login-runner.ts'
import { catalogBotApis } from '../modules/bots/bots.api-catalog.ts'
import { createBotApiInvoker, type BotCallLog } from '../modules/bots/runtime/api-invoker.ts'
import { createBotDelegation } from '../modules/identity/identity.bot-delegation.ts'
import { createHttpApp } from './create-http-app.ts'

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
  options: { catalog?: readonly BotModelCatalogEntry[]; login?: BotProviderLogin; compact?: BotCompactor } = {},
) {
  const database = createDatabase(config, (code) => log('error', 'Bot 数据库空闲连接异常', { code }))
  const db = database.db
  const delegation = createBotDelegation()
  const apiApp = createHttpApp({ ...config, DOCS_ENABLED: true }, { botDelegation: delegation })
  let catalog: ReturnType<typeof catalogBotApis> = []
  const logCall = (event: BotCallLog) => log('info', 'Bot 工具调用已记录', event)
  const platformApi = (lease: BotRunLease, run: ConversationBotRunRecord) => ({
    catalog,
    invoker: createBotApiInvoker({
      db,
      app: apiApp,
      delegation,
      catalog,
      lease,
      teamId: run.team_id,
      conversationId: run.conversation_id,
      botId: run.bot_id,
      logCall,
    }),
  })
  const owner = randomUUID()
  const cipher = config.GIT_CREDENTIAL_ENCRYPTION_KEY ? createSecretCipher(config.GIT_CREDENTIAL_ENCRYPTION_KEY) : null
  const shutdown = new AbortController()
  const active = new Set<Promise<void>>()
  const limits = {
    global: config.BOT_GLOBAL_CONCURRENCY,
    perTeam: config.BOT_TEAM_CONCURRENCY,
    ttlSeconds: config.BOT_LEASE_TTL_SECONDS,
  }
  const onFailure = (run: BotRunRecord) =>
    log('error', 'Bot 执行失败', {
      runId: run.id,
      botId: run.bot_id,
      teamId: run.team_id,
      conversationId: run.conversation_id,
    })
  let timer: NodeJS.Timeout | undefined
  let catalogTimer: NodeJS.Timeout | undefined
  let memoryTimer: NodeJS.Timeout | undefined
  let memoryJob: Promise<void> | undefined
  let catalogHeartbeat: Promise<void> | undefined
  let loginJob: Promise<void> | undefined
  let polling: Promise<void> | undefined
  let closing: Promise<void> | undefined

  async function claimAvailable() {
    while (!shutdown.signal.aborted && active.size < limits.global) {
      const run = await claimBotRun(db, owner, limits)
      if (!run) return
      log('info', 'Bot 运行已领取', {
        runId: run.id,
        teamId: run.team_id,
        botId: run.bot_id,
        conversationId: run.conversation_id,
      })
      const running = executeClaimedBotRun(
        { config, db, cipher, execute, compact: options.compact, onFailure, platformApi, logCall },
        run,
        shutdown.signal,
      )
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

  function scheduleMemories() {
    if (memoryJob || shutdown.signal.aborted) return
    memoryJob = enqueueBotMemoryJobs(db)
      .then(() => undefined)
      .catch(() => log('error', '未能安排 Bot 记忆整理', {}))
      .finally(() => {
        memoryJob = undefined
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
      await apiApp.ready()
      catalog = catalogBotApis(apiApp.swagger())
      if (options.catalog) {
        await publishBotModelCatalog(db, options.catalog)
        catalogTimer = setInterval(reportOnline, CATALOG_HEARTBEAT_INTERVAL_MS)
      }
      timer = setInterval(() => {
        void pollOnce()
        pollLogin()
      }, POLL_INTERVAL_MS)
      memoryTimer = setInterval(scheduleMemories, config.BOT_MEMORY_CONSOLIDATION_INTERVAL_MINUTES * 60_000)
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
        if (memoryTimer) clearInterval(memoryTimer)
        await polling
        await Promise.all([...active, loginJob, catalogHeartbeat, memoryJob])
        await Promise.all([database.close(), apiApp.close()])
      })()
      await closing
    },
  }
}
