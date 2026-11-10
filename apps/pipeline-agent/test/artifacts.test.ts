import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { extract } from 'tar-stream'

import {
  ArtifactError,
  packArtifact,
  removePackedArtifact,
  resolveArtifactPath,
  validateArtifactName,
} from '../src/artifacts.ts'
import { createAgentLogger } from '../src/logger.ts'
import { createSecretMasker } from '../src/masking.ts'

interface ExtractedEntry {
  name: string
  type: string
  content: Buffer
}

async function extractTar(tar: Buffer): Promise<ExtractedEntry[]> {
  const entries: ExtractedEntry[] = []
  await new Promise<void>((resolve, reject) => {
    const parser = extract()
    parser.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: unknown) =>
        chunks.push(Buffer.from(chunk instanceof Uint8Array ? chunk : String(chunk))),
      )
      stream.on('error', reject)
      stream.on('end', () => {
        entries.push({ name: header.name, type: header.type, content: Buffer.concat(chunks) })
        next()
      })
      stream.resume()
    })
    parser.on('error', reject)
    parser.on('finish', resolve)
    parser.end(tar)
  })
  return entries
}

function createLoggerCapture(): { logger: ReturnType<typeof createAgentLogger>; lines: string[] } {
  const lines: string[] = []
  const logger = createAgentLogger({ masker: createSecretMasker(), write: (line) => lines.push(line) })
  return { logger, lines }
}

async function createWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'devops-agent-artifact-ws-'))
  const dist = join(dir, 'apps', 'web', 'dist')
  await mkdir(join(dist, 'assets'), { recursive: true })
  await mkdir(join(dist, 'empty-dir'), { recursive: true })
  await writeFile(join(dist, 'index.html'), '<html>build</html>\n')
  await writeFile(join(dist, 'assets', 'app.js'), 'console.log("ok")\n')
  return dir
}

test('产物路径拒绝绝对路径与工作区逃逸', () => {
  const workspace = '/tmp/workspace-root'
  assert.throws(
    () => resolveArtifactPath(workspace, '/etc/passwd'),
    (error: unknown) => error instanceof ArtifactError,
  )
  assert.throws(
    () => resolveArtifactPath(workspace, '../outside'),
    (error: unknown) => error instanceof ArtifactError,
  )
  assert.throws(
    () => resolveArtifactPath(workspace, 'a/../../outside'),
    (error: unknown) => error instanceof ArtifactError,
  )
  assert.equal(resolveArtifactPath(workspace, 'apps/web/dist'), '/tmp/workspace-root/apps/web/dist')
})

test('产物名规则与 workflow-yaml 契约一致', () => {
  assert.doesNotThrow(() => validateArtifactName('web-dist_v2.0'))
  assert.throws(
    () => validateArtifactName('包含中文'),
    (error: unknown) => error instanceof ArtifactError,
  )
  assert.throws(
    () => validateArtifactName('../escape'),
    (error: unknown) => error instanceof ArtifactError,
  )
  assert.throws(
    () => validateArtifactName(''),
    (error: unknown) => error instanceof ArtifactError,
  )
})

test('目录产物打包为 tar 并计算大小与 SHA-256', async () => {
  const workspace = await createWorkspace()
  const { logger } = createLoggerCapture()
  const tempDir = join(workspace, 'tmp')
  try {
    const packed = await packArtifact({
      workspaceDir: workspace,
      artifactPath: 'apps/web/dist',
      tempDir,
      maxBytes: 10 * 1_024 * 1_024,
      logger,
    })
    const tar = await readFile(packed.filePath)
    assert.equal(packed.sizeBytes, tar.byteLength)
    assert.equal(packed.sha256, createHash('sha256').update(tar).digest('hex'))
    const entries = await extractTar(tar)
    const files = new Map(entries.filter((entry) => entry.type === 'file').map((entry) => [entry.name, entry.content]))
    assert.equal(files.get('index.html')?.toString('utf8'), '<html>build</html>\n')
    assert.equal(files.get('assets/app.js')?.toString('utf8'), 'console.log("ok")\n')
    assert.ok(
      entries.some((entry) => entry.name === 'empty-dir/' && entry.type === 'directory'),
      '空目录应保留目录条目',
    )
    await removePackedArtifact(packed)
    assert.equal((await readdir(tempDir)).length, 0, '清理后临时目录应为空')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('产物路径不存在时显式失败且不生成空产物', async () => {
  const workspace = await createWorkspace()
  const { logger } = createLoggerCapture()
  try {
    await assert.rejects(
      () =>
        packArtifact({
          workspaceDir: workspace,
          artifactPath: 'apps/web/dist-missing',
          tempDir: join(workspace, 'tmp'),
          maxBytes: 1_024,
          logger,
        }),
      (error: unknown) => error instanceof ArtifactError && error.code === 'ARTIFACT_PATH_NOT_FOUND',
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('超过大小上限时失败并清理临时文件', async () => {
  const workspace = await createWorkspace()
  const { logger } = createLoggerCapture()
  const tempDir = join(workspace, 'tmp')
  try {
    await assert.rejects(
      () =>
        packArtifact({
          workspaceDir: workspace,
          artifactPath: 'apps/web/dist',
          tempDir,
          maxBytes: 10,
          logger,
        }),
      (error: unknown) => error instanceof ArtifactError && error.code === 'ARTIFACT_LIMIT_EXCEEDED',
    )
    const leftovers = await readdir(tempDir).catch(() => [])
    assert.equal(leftovers.length, 0, '失败后不应留下临时 tar')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('符号链接被跳过并记录告警，不打包工作区外内容', async () => {
  const workspace = await createWorkspace()
  const { logger, lines } = createLoggerCapture()
  const outside = await mkdtemp(join(tmpdir(), 'devops-agent-outside-'))
  try {
    await writeFile(join(outside, 'secret.txt'), 'outside-secret\n')
    const dist = join(workspace, 'apps', 'web', 'dist')
    await symlink(join(outside, 'secret.txt'), join(dist, 'link-to-secret'))
    const packed = await packArtifact({
      workspaceDir: workspace,
      artifactPath: 'apps/web/dist',
      tempDir: join(workspace, 'tmp'),
      maxBytes: 10 * 1_024 * 1_024,
      logger,
    })
    const entries = await extractTar(await readFile(packed.filePath))
    const names = entries.map((entry) => entry.name)
    assert.ok(!names.includes('link-to-secret'), '符号链接不得进入产物')
    assert.ok(
      entries.every((entry) => !entry.content.toString('utf8').includes('outside-secret')),
      '产物不得包含工作区外内容',
    )
    assert.ok(
      lines.some((line) => line.includes('跳过')),
      '跳过文件应记录告警',
    )
    await removePackedArtifact(packed)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('产物按 SHA-256 与长度流式上传，请求头符合协议', async () => {
  const { createAgentClient } = await import('../src/agent.ts')
  const { createPlatformHttp } = await import('../src/client.ts')
  const { createLease } = await import('./helpers/fixtures.ts')
  const { headerOf, okEnvelope, requestsTo, startMockPlatform } = await import('./helpers/platform-server.ts')
  const workspace = await createWorkspace()
  const { logger } = createLoggerCapture()
  const lease = createLease()
  const platform = await startMockPlatform((request) => {
    if (request.path === '/api/v1/agent/register') {
      return okEnvelope({
        nodeId: 'node-artifact',
        agentToken: 'agent-token-012345678901234567890123456789',
        protocolVersion: 1,
        heartbeatIntervalSeconds: 15,
        leaseTtlSeconds: 90,
      })
    }
    if (request.path === `/api/v1/agent/lease/${lease.leaseId}/artifacts`) {
      const sha256 = headerOf(request, 'x-content-sha256') ?? ''
      return okEnvelope({
        artifactId: 'artifact-uploaded',
        name: decodeURIComponent(headerOf(request, 'x-artifact-name') ?? ''),
        sizeBytes: request.body.byteLength,
        sha256,
      })
    }
    throw new Error(`未预期路径：${request.path}`)
  })
  try {
    const masker = createSecretMasker()
    const http = createPlatformHttp({ baseUrl: platform.url, timeoutMs: 2_000, sleep: async () => undefined })
    const client = createAgentClient({
      http,
      logger,
      masker,
      nodeName: 'test-node',
      capabilities: ['linux'],
      registrationToken: 'registration-token-0123456789abcdef',
      artifactUploadTimeoutMs: 5_000,
    })
    await client.ensureRegistered()
    const packed = await packArtifact({
      workspaceDir: workspace,
      artifactPath: 'apps/web/dist',
      tempDir: join(workspace, 'tmp'),
      maxBytes: 10 * 1_024 * 1_024,
      logger,
    })
    const tar = await readFile(packed.filePath)
    const result = await client.uploadArtifact(lease, {
      stepIndex: 2,
      name: 'web-dist',
      sha256: packed.sha256,
      sizeBytes: packed.sizeBytes,
      filePath: packed.filePath,
    })
    assert.equal(result.artifactId, 'artifact-uploaded')
    assert.equal(result.sha256, packed.sha256)
    const request = requestsTo(platform.requests, `/api/v1/agent/lease/${lease.leaseId}/artifacts`)[0]
    assert.ok(request, '应收到产物上传请求')
    assert.equal(headerOf(request, 'x-step-index'), '2')
    assert.equal(headerOf(request, 'x-artifact-name'), 'web-dist')
    assert.equal(headerOf(request, 'x-content-sha256'), packed.sha256)
    assert.equal(headerOf(request, 'content-length'), String(packed.sizeBytes))
    assert.deepEqual(request.body, tar)
    assert.equal(createHash('sha256').update(request.body).digest('hex'), packed.sha256)
  } finally {
    await platform.close()
    await rm(workspace, { recursive: true, force: true })
  }
})
