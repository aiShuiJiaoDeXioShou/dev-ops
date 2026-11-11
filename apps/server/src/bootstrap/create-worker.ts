import { createDatabase } from '../platform/database/client.ts'
import type { AppConfig } from '../platform/config/env.ts'
import { createPipelineScheduler, type PipelineSchedulerLogger } from '../modules/pipeline/pipeline.scheduler.ts'
import { createStorageService } from '../modules/storage/storage.service.ts'
import { createSecretCipher } from '../modules/configuration/configuration.crypto.ts'
import { createAttachmentCleanup } from '../modules/attachments/attachments.cleanup.ts'

export type { PipelineSchedulerLogger } from '../modules/pipeline/pipeline.scheduler.ts'

/** 调度周期间隔（毫秒）；小团队规模下 2 秒足够，避免空转压力。 */
const SCHEDULE_INTERVAL_MS = 2_000

/** 附件清理周期间隔（毫秒）；临时附件 24 小时保留期下 10 分钟粒度足够。 */
const ATTACHMENT_CLEANUP_INTERVAL_MS = 10 * 60 * 1000

/**
 * 组装流水线调度 Worker 的进程依赖。
 * @param config 已校验配置。
 * @param onDatabaseIdleError 空闲连接异常回调。
 * @param log 结构化日志输出函数，由入口注入。
 * @returns 启动、单周期执行与关闭函数；进程入口负责信号处理。
 * @remarks 调度周期内异常只记录日志，不让 Worker 进程退出；数据库连接异常通过回调上报。
 */
export function createWorker(
  config: AppConfig,
  onDatabaseIdleError: (code: string | undefined) => void,
  log: PipelineSchedulerLogger,
) {
  const database = createDatabase(config, onDatabaseIdleError)
  const scheduler = createPipelineScheduler({
    db: database.db,
    config: {
      leaseTtlSeconds: config.PIPELINE_LEASE_TTL_SECONDS,
      heartbeatTimeoutSeconds: config.PIPELINE_HEARTBEAT_TIMEOUT_SECONDS,
    },
    log,
  })
  const secretCipher = config.GIT_CREDENTIAL_ENCRYPTION_KEY
    ? createSecretCipher(config.GIT_CREDENTIAL_ENCRYPTION_KEY)
    : null
  const attachmentCleanup = createAttachmentCleanup({
    db: database.db,
    storage: createStorageService({
      db: database.db,
      cipher: secretCipher,
      config: { localDir: config.ATTACHMENT_STORAGE_DIR, probeTimeoutMs: config.STORAGE_PROBE_TIMEOUT_MS },
    }),
    policy: { tempRetentionHours: config.ATTACHMENT_TEMP_TTL_HOURS },
    log: (message, context) => log('warn', message, context),
  })
  let timer: NodeJS.Timeout | null = null
  let cleanupTimer: NodeJS.Timeout | null = null
  let cycleRunning = false
  let cleanupRunning = false
  let closing = false

  async function runCycleOnce(): Promise<void> {
    if (cycleRunning || closing) return
    cycleRunning = true
    try {
      await scheduler.runCycle()
    } catch (error) {
      log('error', '流水线调度周期失败', {
        error: error instanceof Error ? error.message : '未知错误',
      })
    } finally {
      cycleRunning = false
    }
  }

  async function runAttachmentCleanupOnce(): Promise<void> {
    if (cleanupRunning || closing) return
    cleanupRunning = true
    try {
      const result = await attachmentCleanup.runOnce()
      log('info', '附件清理周期完成', { ...result })
    } catch (error) {
      log('error', '附件清理周期失败', {
        error: error instanceof Error ? error.message : '未知错误',
      })
    } finally {
      cleanupRunning = false
    }
  }

  return {
    /**
     * 启动 Worker：验证数据库后开始周期调度。
     * @returns 首个调度周期启动后完成；数据库不可用时拒绝。
     */
    async start(): Promise<void> {
      await database.check()
      await runCycleOnce()
      await runAttachmentCleanupOnce()
      timer = setInterval(() => {
        void runCycleOnce()
      }, SCHEDULE_INTERVAL_MS)
      cleanupTimer = setInterval(() => {
        void runAttachmentCleanupOnce()
      }, ATTACHMENT_CLEANUP_INTERVAL_MS)
      log('info', 'pipeline worker 已启动', {
        intervalMs: SCHEDULE_INTERVAL_MS,
        attachmentCleanupIntervalMs: ATTACHMENT_CLEANUP_INTERVAL_MS,
      })
    },
    /** 主动执行一次调度周期；测试与运维排查使用。 */
    runCycleOnce,
    /** 主动执行一次附件清理；测试与运维排查使用。 */
    runAttachmentCleanupOnce,
    /**
     * 关闭 Worker：停止调度并关闭数据库连接。
     * @returns 连接关闭后完成。
     */
    async close(): Promise<void> {
      closing = true
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      if (cleanupTimer) {
        clearInterval(cleanupTimer)
        cleanupTimer = null
      }
      await database.close()
    },
  }
}
