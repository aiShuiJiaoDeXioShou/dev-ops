import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import {
  MASKED_TEXT_MAX_LENGTH,
  isSensitiveFieldName,
  maskErrorMessage,
  maskInputValue,
  maskSensitiveText,
} from '../src/modules/pipeline/pipeline.mask.ts'
import { createPipelineStorage, PipelineStorageError } from '../src/modules/pipeline/pipeline.storage.ts'

test('安全不变量：日志脱敏遮罩凭据形态与已知密钥，输入字段名脱敏', () => {
  const masked = maskSensitiveText(
    [
      'Authorization: Bearer abcdefghijklmnop',
      'password=hunter2',
      'postgresql://user:dbpass@127.0.0.1:5432/app',
      `token=ghp_${'a'.repeat(30)}`,
      `devops_pat_${'b'.repeat(24)}`,
    ].join('\n'),
  )
  assert.equal(masked.includes('abcdefghijklmnop'), false)
  assert.equal(masked.includes('hunter2'), false)
  assert.equal(masked.includes('dbpass'), false)
  assert.equal(masked.includes(`ghp_${'a'.repeat(30)}`), false)
  assert.equal(masked.includes(`devops_pat_${'b'.repeat(24)}`), false)
  assert.ok(masked.includes('***'))

  const knownSecret = 'runtime-secret-value'
  const maskedKnown = maskSensitiveText(`value is ${knownSecret} end`, [knownSecret])
  assert.equal(maskedKnown.includes(knownSecret), false, '已知运行时密钥必须被替换')
  assert.equal(maskedKnown, 'value is *** end')

  assert.equal(isSensitiveFieldName('NPM_TOKEN'), true)
  assert.equal(isSensitiveFieldName('api-key'), true)
  assert.equal(isSensitiveFieldName('target'), false)
  assert.equal(maskInputValue('DB_PASSWORD', 'plain-text'), '***')
  assert.equal(maskInputValue('target', `ghp_${'c'.repeat(30)}`).includes('ghp_'), false)
})

test('安全不变量：超长敏感文本截断，空错误信息返回 null', () => {
  const longText = 'x'.repeat(MASKED_TEXT_MAX_LENGTH + 100)
  const masked = maskSensitiveText(longText)
  assert.ok(masked.length <= MASKED_TEXT_MAX_LENGTH + '…[已截断]'.length)
  assert.ok(masked.endsWith('…[已截断]'))
  assert.equal(maskErrorMessage('   '), null)
  assert.equal(maskErrorMessage(undefined), null)
  assert.equal(maskErrorMessage(`password=${'p'.repeat(20)}`)?.includes('pppp'), false)
})

test('安全不变量：流水线本地存储拒绝路径穿越与非法运行标识', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'pipeline-security-storage-'))
  try {
    const storage = createPipelineStorage({ rootDir, maxLogChunkBytes: 64, maxArtifactBytes: 128 })
    await assert.rejects(() => storage.readLogChunk('../etc/passwd'), PipelineStorageError)
    await assert.rejects(() => storage.readLogChunk('/etc/passwd'), PipelineStorageError)
    await assert.rejects(() => storage.readLogChunk('runs/../../outside.log'), PipelineStorageError)
    await assert.rejects(() => storage.writeLogChunk('../run', 0, 0, 'x'), PipelineStorageError)
    await assert.rejects(() => storage.writeLogChunk('run-1', 0, 0, 'x'.repeat(65)), PipelineStorageError)
    const expectedSha = createHash('sha256').update('x').digest('hex')
    await assert.rejects(
      () => storage.writeArtifactStream('run-1', '../artifact', Readable.from([Buffer.from('x')]), expectedSha),
      PipelineStorageError,
    )
    const written = await storage.writeLogChunk('run-1', 0, 0, 'hello')
    assert.equal(await storage.readLogChunk(written.storageKey), 'hello')
    await storage.removeRun('run-1')
    await assert.rejects(() => storage.readLogChunk(written.storageKey), PipelineStorageError)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
