import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { AgentLogChunk } from '@dev-ops/pipeline-protocol'

import { AGENT_ERROR_CODES, AgentApiError } from '../src/errors.ts'
import { createAgentLogger } from '../src/logger.ts'
import { createSecretMasker } from '../src/masking.ts'
import { createLogCollector } from '../src/logs.ts'
import type { LogChunkUploader } from '../src/logs.ts'

function createLoggerCapture(): { logger: ReturnType<typeof createAgentLogger>; lines: string[] } {
  const lines: string[] = []
  const masker = createSecretMasker()
  return { logger: createAgentLogger({ masker, write: (line) => lines.push(line) }), lines }
}

interface RecordedBatch {
  chunks: AgentLogChunk[]
  bytes: number
}

function createCollector(options: {
  chunkMaxBytes?: number
  flushThresholdBytes?: number
  uploads: RecordedBatch[]
  failOnce?: unknown
}): ReturnType<typeof createLogCollector> {
  const masker = createSecretMasker(['super-secret-value', 'git-password'])
  const { logger } = createLoggerCapture()
  let firstCall = true
  const uploadLogs: LogChunkUploader = async (chunks) => {
    if (options.failOnce !== undefined && firstCall) {
      firstCall = false
      throw options.failOnce
    }
    const recorded = [...chunks]
    options.uploads.push({
      chunks: recorded,
      bytes: recorded.reduce((total, chunk) => total + Buffer.byteLength(chunk.content, 'utf8'), 0),
    })
    const acceptedThrough: Record<string, number> = {}
    for (const chunk of recorded) {
      const current = acceptedThrough[String(chunk.stepIndex)]
      acceptedThrough[String(chunk.stepIndex)] = current === undefined ? chunk.seq : Math.max(current, chunk.seq)
    }
    return { acceptedThrough }
  }
  return createLogCollector({
    masker,
    uploadLogs,
    logger,
    chunkMaxBytes: options.chunkMaxBytes ?? 64,
    maxBatchChunks: 20,
    maxBatchBytes: 256 * 1_024,
    flushThresholdBytes: options.flushThresholdBytes ?? 16 * 1_024,
  })
}

test('分片不超过字节上限且不切断多字节字符', async () => {
  const uploads: RecordedBatch[] = []
  const collector = createCollector({ chunkMaxBytes: 10, uploads })
  const text = '中文日志内容'.repeat(10)
  collector.append(0, text)
  await collector.flush(0)
  const chunks = uploads.flatMap((batch) => batch.chunks)
  assert.ok(chunks.length > 1, '应拆成多个分片')
  for (const chunk of chunks) {
    assert.ok(Buffer.byteLength(chunk.content, 'utf8') <= 10, '单分片不得超过字节上限')
    assert.ok(!chunk.content.includes('\uFFFD'), '分片不得出现替换字符')
  }
  assert.equal(chunks.map((chunk) => chunk.content).join(''), text)
})

test('单批不超过 20 个分片与 256KB，seq 严格递增且不重复', async () => {
  const uploads: RecordedBatch[] = []
  const collector = createCollector({ chunkMaxBytes: 32 * 1_024, uploads })
  const text = 'a'.repeat(600 * 1_024)
  collector.append(2, text)
  await collector.flush(2)
  assert.ok(uploads.length >= 2, '应拆成多批上传')
  let expectedSeq = 0
  for (const batch of uploads) {
    assert.ok(batch.chunks.length <= 20, '单批分片数不得超过协议上限')
    assert.ok(batch.bytes <= 256 * 1_024, '单批总量不得超过 256KB')
    for (const chunk of batch.chunks) {
      assert.equal(chunk.stepIndex, 2)
      assert.equal(chunk.seq, expectedSeq, 'seq 必须从 0 严格递增')
      expectedSeq += 1
    }
  }
  assert.equal(
    uploads
      .flatMap((batch) => batch.chunks)
      .map((chunk) => chunk.content)
      .join(''),
    text,
  )
})

test('上传前脱敏令牌、密码与运行时密钥', async () => {
  const uploads: RecordedBatch[] = []
  const collector = createCollector({ chunkMaxBytes: 1_024, uploads })
  collector.append(
    1,
    'token=super-secret-value password=git-password Authorization: Bearer abcdefghijklmnop\nredis://user:pass@cache:6379\n',
  )
  await collector.flush(1)
  const content = uploads
    .flatMap((batch) => batch.chunks)
    .map((chunk) => chunk.content)
    .join('')
  assert.ok(!content.includes('super-secret-value'), '运行时密钥必须脱敏')
  assert.ok(!content.includes('git-password'), 'Git 凭据必须脱敏')
  assert.ok(!content.includes('abcdefghijklmnop'), 'Bearer 令牌必须脱敏')
  assert.ok(!content.includes('user:pass@'), 'URL 内嵌凭据必须脱敏')
  assert.ok(content.includes('***'), '应保留脱敏占位')
})

test('平台日志超限时标记截断并停止后续上传', async () => {
  const uploads: RecordedBatch[] = []
  const collector = createCollector({
    chunkMaxBytes: 32,
    uploads,
    failOnce: new AgentApiError(AGENT_ERROR_CODES.logLimitExceeded, '日志超限'),
  })
  collector.append(0, 'first'.repeat(20))
  await collector.flush(0)
  assert.equal(collector.isTruncated(0), true)
  collector.append(0, 'ignored-after-truncate\n')
  await collector.flush(0)
  assert.equal(uploads.length, 0, '超限后不应继续上传')
})

test('序号冲突时按平台返回的 acceptedThrough 继续', async () => {
  const uploads: RecordedBatch[] = []
  const collector = createCollector({
    chunkMaxBytes: 32,
    uploads,
    failOnce: new AgentApiError(AGENT_ERROR_CODES.logSeqConflict, '序号冲突', undefined, {
      acceptedThrough: { '0': 4 },
    }),
  })
  collector.append(0, 'first'.repeat(20))
  await collector.flush(0)
  assert.equal(collector.isTruncated(0), false)
  collector.append(0, 'second-batch-content\n')
  await collector.flush(0)
  const resumed = uploads.flatMap((batch) => batch.chunks)
  assert.ok(resumed.length > 0, '冲突后应继续上传')
  assert.equal(resumed[0]?.seq, 5, '应从平台确认的序号之后继续')
})

test('上传失败不让执行卡住，丢弃批次并告警', async () => {
  const uploads: RecordedBatch[] = []
  const collector = createCollector({ chunkMaxBytes: 32, uploads, failOnce: new Error('网络中断') })
  collector.append(0, 'data'.repeat(20))
  await collector.flush(0)
  assert.equal(collector.isTruncated(0), false)
  collector.append(0, 'later\n')
  await collector.flush(0)
  assert.equal(uploads.length, 1, '失败批次丢弃，后续内容继续上传')
  assert.equal(collector.isTruncated(0), false)
})
