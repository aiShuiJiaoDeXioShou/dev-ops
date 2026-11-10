import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { createPipelineStorage, PipelineStorageError } from '../../src/modules/pipeline/pipeline.storage.ts'

test('日志分片写入、读取并拒绝越界路径', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'pipeline-storage-'))
  try {
    const storage = createPipelineStorage({ rootDir, maxLogChunkBytes: 1024, maxArtifactBytes: 2048 })
    const stored = await storage.writeLogChunk('run-1', 0, 0, 'hello\n')
    assert.equal(stored.sizeBytes, 6)
    assert.equal(await storage.readLogChunk(stored.storageKey), 'hello\n')
    await assert.rejects(() => storage.readLogChunk('../outside.log'), PipelineStorageError)
    await assert.rejects(() => storage.writeLogChunk('../run', 0, 0, 'x'), PipelineStorageError)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('日志与产物大小上限生效，产物流式写入计算 SHA-256', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'pipeline-storage-'))
  try {
    const storage = createPipelineStorage({ rootDir, maxLogChunkBytes: 2, maxArtifactBytes: 2 })
    await assert.rejects(() => storage.writeLogChunk('run-1', 0, 0, 'too long'), PipelineStorageError)
    await assert.rejects(
      () => storage.writeArtifactStream('run-1', 'artifact-1', Readable.from([Buffer.from('too long')]), ''),
      PipelineStorageError,
    )
    const content = Buffer.from('ok')
    const sha256 = createHash('sha256').update(content).digest('hex')
    const artifact = await storage.writeArtifactStream('run-1', 'artifact-1', Readable.from([content]), sha256)
    assert.equal(artifact.sizeBytes, 2)
    assert.equal(artifact.sha256, sha256)
    assert.deepEqual(await storage.readArtifact(artifact.storageKey), content)
    const opened = await storage.openArtifactStream(artifact.storageKey)
    assert.equal(opened.sizeBytes, 2)
    const chunks: Buffer[] = []
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk))
    assert.deepEqual(Buffer.concat(chunks), content)
    await storage.removeRun('run-1')
    await assert.rejects(() => storage.readArtifact(artifact.storageKey), PipelineStorageError)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})

test('产物校验和不一致时拒绝写入且不留下文件', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'pipeline-storage-'))
  try {
    const storage = createPipelineStorage({ rootDir, maxLogChunkBytes: 1024, maxArtifactBytes: 2048 })
    const content = Buffer.from('payload')
    await assert.rejects(
      () => storage.writeArtifactStream('run-2', 'artifact-2', Readable.from([content]), 'f'.repeat(64)),
      PipelineStorageError,
    )
    await assert.rejects(() => storage.openArtifactStream('runs/run-2/artifacts/artifact-2.tar'), PipelineStorageError)
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
