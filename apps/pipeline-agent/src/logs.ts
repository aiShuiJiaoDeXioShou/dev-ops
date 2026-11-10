import type { AgentLogChunk } from '@dev-ops/pipeline-protocol'

import { AGENT_ERROR_CODES, isAgentErrorCode, readErrorNumberRecord } from './errors.ts'
import type { AgentLogger } from './logger.ts'
import type { SecretMasker } from './masking.ts'

/** 日志上传函数；由租约作用域的 Agent 客户端提供，重试由 HTTP 客户端负责。 */
export type LogChunkUploader = (
  chunks: readonly AgentLogChunk[],
) => Promise<{ acceptedThrough: Record<string, number> }>

export interface LogCollectorOptions {
  masker: SecretMasker
  uploadLogs: LogChunkUploader
  logger: AgentLogger
  /** 单个分片最大字节数；必须不超过协议 256KB 上限。 */
  chunkMaxBytes: number
  /** 单批最多分片数，协议上限 20。 */
  maxBatchChunks?: number
  /** 单批总量上限，协议上限 256KB。 */
  maxBatchBytes?: number
  /** 达到该缓冲量后后台触发上传，默认 16KB；步骤结束时强制 flush。 */
  flushThresholdBytes?: number
}

/** 日志收集器；按步骤维护单调递增的 seq，上传前脱敏并按协议分片。 */
export interface LogCollector {
  /** 追加某步骤的输出文本；内容会先脱敏，超过平台限制后忽略后续内容。 */
  append(stepIndex: number, text: string): void
  /** 强制上传指定步骤（或全部步骤）的缓冲内容，并等待已排队上传完成。 */
  flush(stepIndex?: number): Promise<void>
  /** 指定步骤日志是否被截断（平台限制或不可恢复的序号冲突）。 */
  isTruncated(stepIndex: number): boolean
}

interface StepLogState {
  nextSeq: number
  buffer: string
  bufferBytes: number
  truncated: boolean
  /** 串行上传链，保证同一步骤的 seq 按顺序到达平台。 */
  queue: Promise<void>
}

const DEFAULT_MAX_BATCH_CHUNKS = 20
// 协议允许单次总量 256KB，但日志正文进入 JSON 后换行等字符会转义膨胀；
// 平台请求体上限通常为 512KB，这里保守取 128KB，避免转义后触发 HTTP 层拒绝。
const DEFAULT_MAX_BATCH_BYTES = 128 * 1_024
const DEFAULT_FLUSH_THRESHOLD_BYTES = 16 * 1_024

/** 按 UTF-8 字节数截取文本前缀，不切断多字节字符。 */
function takeUtf8Prefix(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let bytes = 0
  let end = 0
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8')
    if (bytes + charBytes > maxBytes) break
    bytes += charBytes
    end += char.length
  }
  return text.slice(0, end)
}

/**
 * 创建按步骤分片的日志收集器。
 * @param options 脱敏器、上传函数、日志器与分片/批量上限。
 * @returns 追加、强制上传与截断状态查询能力。
 * @remarks
 * - 上传前对每段内容做一次脱敏，平台再脱敏一次，形成两层保护。
 * - 同一步骤的 seq 从 0 严格递增，重复上传由平台按 (run, step, seq) 幂等处理。
 * - 上传失败时不让运行卡住：日志是尽力而为的数据，失败后丢弃当前批次并告警；
 *   平台返回日志超限或无法恢复的序号冲突时标记截断并停止该步骤上传。
 */
export function createLogCollector(options: LogCollectorOptions): LogCollector {
  const maxBatchChunks = options.maxBatchChunks ?? DEFAULT_MAX_BATCH_CHUNKS
  const maxBatchBytes = options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES
  const flushThresholdBytes = options.flushThresholdBytes ?? DEFAULT_FLUSH_THRESHOLD_BYTES
  const states = new Map<number, StepLogState>()

  function stateOf(stepIndex: number): StepLogState {
    const existing = states.get(stepIndex)
    if (existing) return existing
    const created: StepLogState = { nextSeq: 0, buffer: '', bufferBytes: 0, truncated: false, queue: Promise.resolve() }
    states.set(stepIndex, created)
    return created
  }

  function truncate(state: StepLogState, stepIndex: number, reason: string): void {
    state.truncated = true
    state.buffer = ''
    state.bufferBytes = 0
    options.logger.warn(`步骤 ${stepIndex} 日志停止上传：${reason}`)
  }

  /** 从缓冲中切出一批分片；调用方保证串行执行。 */
  function takeBatch(stepIndex: number, state: StepLogState): AgentLogChunk[] {
    const chunks: AgentLogChunk[] = []
    let batchBytes = 0
    while (state.buffer.length > 0 && chunks.length < maxBatchChunks && batchBytes < maxBatchBytes) {
      const remaining = maxBatchBytes - batchBytes
      const chunkText = takeUtf8Prefix(state.buffer, Math.min(options.chunkMaxBytes, remaining))
      if (chunkText.length === 0) break
      const chunkBytes = Buffer.byteLength(chunkText, 'utf8')
      chunks.push({ stepIndex, seq: state.nextSeq, content: chunkText })
      state.nextSeq += 1
      state.buffer = state.buffer.slice(chunkText.length)
      state.bufferBytes -= chunkBytes
      batchBytes += chunkBytes
    }
    if (state.bufferBytes < 0) state.bufferBytes = 0
    return chunks
  }

  /** 处理上传结果；返回 false 表示该步骤后续不再上传。 */
  function applyUploadResult(state: StepLogState, stepIndex: number, accepted: Record<string, number>): boolean {
    const acceptedMax = accepted[String(stepIndex)]
    if (acceptedMax !== undefined && acceptedMax + 1 > state.nextSeq) {
      // 平台已接受更新的序号（例如重复上传或乱序重试），以平台记录为准继续。
      state.nextSeq = acceptedMax + 1
    }
    return !state.truncated
  }

  async function uploadBatch(state: StepLogState, stepIndex: number, chunks: AgentLogChunk[]): Promise<boolean> {
    try {
      const response = await options.uploadLogs(chunks)
      return applyUploadResult(state, stepIndex, response.acceptedThrough)
    } catch (error) {
      if (isAgentErrorCode(error, AGENT_ERROR_CODES.logLimitExceeded)) {
        truncate(state, stepIndex, '平台日志大小超限')
        return false
      }
      if (isAgentErrorCode(error, AGENT_ERROR_CODES.logSeqConflict)) {
        const accepted = readErrorNumberRecord(error, 'acceptedThrough')
        if (accepted) {
          // 从平台确认的序号继续，不覆盖已写入内容；当前批次可能部分成功，直接丢弃重发不幂等。
          state.nextSeq = Math.max(state.nextSeq, (accepted[String(stepIndex)] ?? -1) + 1)
          options.logger.warn(`步骤 ${stepIndex} 日志序号冲突，从 ${state.nextSeq} 继续上传`)
          return true
        }
        truncate(state, stepIndex, '日志序号冲突且平台未返回已接受序号')
        return false
      }
      options.logger.warn(`步骤 ${stepIndex} 日志上传失败，丢弃 ${chunks.length} 个分片：${describeUploadError(error)}`)
      return true
    }
  }

  async function drain(stepIndex: number, state: StepLogState, force: boolean): Promise<void> {
    while (state.buffer.length > 0 && !state.truncated) {
      if (!force && state.bufferBytes < flushThresholdBytes) return
      const chunks = takeBatch(stepIndex, state)
      if (chunks.length === 0) return
      const keepUploading = await uploadBatch(state, stepIndex, chunks)
      if (!keepUploading) return
    }
  }

  function enqueueDrain(stepIndex: number, state: StepLogState, force: boolean): Promise<void> {
    state.queue = state.queue.then(
      () => drain(stepIndex, state, force),
      () => drain(stepIndex, state, force),
    )
    return state.queue
  }

  return {
    append(stepIndex: number, text: string): void {
      if (text.length === 0) return
      const state = stateOf(stepIndex)
      if (state.truncated) return
      const masked = options.masker.maskText(text)
      if (masked.length === 0) return
      state.buffer += masked
      state.bufferBytes += Buffer.byteLength(masked, 'utf8')
      if (state.bufferBytes >= flushThresholdBytes) void enqueueDrain(stepIndex, state, false)
    },

    async flush(stepIndex?: number): Promise<void> {
      if (stepIndex !== undefined) {
        const state = stateOf(stepIndex)
        await enqueueDrain(stepIndex, state, true)
        return
      }
      const pending: Promise<void>[] = []
      for (const [index, state] of states) pending.push(enqueueDrain(index, state, true))
      await Promise.all(pending)
    },

    isTruncated(stepIndex: number): boolean {
      return stateOf(stepIndex).truncated
    },
  }
}

function describeUploadError(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
