import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'

/** 本地流水线存储配置；根目录由部署配置提供。 */
export interface PipelineStorageOptions {
  rootDir: string
  maxLogChunkBytes: number
  maxArtifactBytes: number
}

/** 路径越界、大小超限或存储不可用时抛出；错误信息不含敏感内容。 */
export class PipelineStorageError extends Error {
  readonly code = 'PIPELINE_STORAGE_ERROR'

  constructor(message: string) {
    super(message)
    this.name = 'PipelineStorageError'
  }
}

/** 日志或产物写入结果；storageKey 为相对存储根目录的路径。 */
export interface StoredObject {
  storageKey: string
  sizeBytes: number
}

/** 产物流式写入结果；sha256 在写入过程中计算，避免二次读取大文件。 */
export interface StoredArtifact extends StoredObject {
  sha256: string
}

/** 产物下载流与大小；调用方负责结束流。 */
export interface ArtifactReadStream {
  stream: ReturnType<typeof createReadStream>
  sizeBytes: number
}

function isContained(rootDir: string, target: string): boolean {
  const root = resolve(rootDir)
  const resolved = resolve(target)
  return resolved === root || resolved.startsWith(`${root}${sep}`)
}

/**
 * 创建本地流水线存储。
 * @param options 根目录与日志/产物大小上限。
 * @returns 日志与产物的写入、读取、删除能力；所有路径都限制在根目录内。
 * @remarks 只保存内容文件，元数据由 pipeline 模块写入数据库；调用方负责权限校验。
 * 产物先写入同目录临时文件再原子改名，避免下载到写了一半的文件。
 */
export function createPipelineStorage(options: PipelineStorageOptions) {
  const rootDir = resolve(options.rootDir)

  function resolveKey(storageKey: string): string {
    if (!storageKey || storageKey.startsWith('/') || storageKey.includes('..')) {
      throw new PipelineStorageError('存储路径不合法')
    }
    const target = resolve(rootDir, storageKey)
    if (!isContained(rootDir, target)) throw new PipelineStorageError('存储路径越界')
    return target
  }

  function safeSegment(value: string, name: string): string {
    const safe = value.replace(/[^A-Za-z0-9._-]/g, '')
    if (safe !== value || safe.length === 0) throw new PipelineStorageError(`${name}不合法`)
    return safe
  }

  function runLogPath(runId: string, stepIndex: number, seq: number): string {
    const safeRunId = safeSegment(runId, '运行标识')
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || !Number.isInteger(seq) || seq < 0) {
      throw new PipelineStorageError('日志分片序号不合法')
    }
    return join(rootDir, 'runs', safeRunId, 'logs', String(stepIndex), `${seq}.log`)
  }

  function runArtifactDir(runId: string): string {
    return join(rootDir, 'runs', safeSegment(runId, '运行标识'), 'artifacts')
  }

  async function writeLogChunk(runId: string, stepIndex: number, seq: number, content: string): Promise<StoredObject> {
    const sizeBytes = Buffer.byteLength(content, 'utf8')
    if (sizeBytes > options.maxLogChunkBytes) throw new PipelineStorageError('日志分片超过大小上限')
    const target = runLogPath(runId, stepIndex, seq)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
    return { storageKey: relative(rootDir, target), sizeBytes }
  }

  async function readLogChunk(storageKey: string): Promise<string> {
    try {
      return await readFile(resolveKey(storageKey), 'utf8')
    } catch (error) {
      if (error instanceof PipelineStorageError) throw error
      throw new PipelineStorageError('日志分片读取失败')
    }
  }

  /**
   * 流式写入产物并计算 SHA-256；超过上限立即中止并清理临时文件。
   * @param runId 运行标识。
   * @param artifactId 产物标识，服务端生成。
   * @param source 原始 tar 流。
   * @param expectedSha256 Agent 声明的校验和；为空时不校验。
   * @returns 相对存储路径、字节数与实际 SHA-256。
   * @throws PipelineStorageError 超过大小上限、流读取失败或校验和不一致时抛出。
   */
  async function writeArtifactStream(
    runId: string,
    artifactId: string,
    source: Readable,
    expectedSha256: string,
  ): Promise<StoredArtifact> {
    const dir = runArtifactDir(runId)
    await mkdir(dir, { recursive: true })
    const safeArtifactId = safeSegment(artifactId, '产物标识')
    const target = join(dir, `${safeArtifactId}.tar`)
    const temp = join(dir, `.${safeArtifactId}-${randomUUID()}.tmp`)
    const hash = createHash('sha256')
    let sizeBytes = 0
    let overflow = false
    const output = createWriteStream(temp, { flags: 'wx' })
    try {
      // 超限后继续消费并丢弃剩余请求体，避免直接 destroy 导致连接中断、客户端收不到业务错误。
      for await (const raw of source) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw))
        if (overflow) continue
        if (sizeBytes + chunk.byteLength > options.maxArtifactBytes) {
          overflow = true
          continue
        }
        sizeBytes += chunk.byteLength
        hash.update(chunk)
        if (!output.write(chunk)) await once(output, 'drain')
      }
      await new Promise<void>((resolvePromise, rejectPromise) => {
        output.once('error', rejectPromise)
        output.end(() => resolvePromise())
      })
    } catch (error) {
      await rm(temp, { force: true })
      if (error instanceof PipelineStorageError) throw error
      throw new PipelineStorageError('产物写入失败')
    }
    if (overflow) {
      await rm(temp, { force: true })
      throw new PipelineStorageError('产物超过大小上限')
    }
    if (sizeBytes > options.maxArtifactBytes) {
      await rm(temp, { force: true })
      throw new PipelineStorageError('产物超过大小上限')
    }
    const sha256 = hash.digest('hex')
    if (expectedSha256 && sha256 !== expectedSha256) {
      await rm(temp, { force: true })
      throw new PipelineStorageError('产物校验和不一致')
    }
    await rename(temp, target)
    return { storageKey: relative(rootDir, target), sizeBytes, sha256 }
  }

  /** 打开产物只读流；不存在或越界时抛出存储错误。 */
  async function openArtifactStream(storageKey: string): Promise<ArtifactReadStream> {
    const target = resolveKey(storageKey)
    let sizeBytes: number
    try {
      const info = await stat(target)
      if (!info.isFile()) throw new PipelineStorageError('产物文件不存在')
      sizeBytes = info.size
    } catch (error) {
      if (error instanceof PipelineStorageError) throw error
      throw new PipelineStorageError('产物文件读取失败')
    }
    return { stream: createReadStream(target), sizeBytes }
  }

  async function readArtifact(storageKey: string): Promise<Buffer> {
    try {
      return await readFile(resolveKey(storageKey))
    } catch (error) {
      if (error instanceof PipelineStorageError) throw error
      throw new PipelineStorageError('产物读取失败')
    }
  }

  async function removeArtifact(storageKey: string): Promise<void> {
    try {
      await rm(resolveKey(storageKey), { force: true })
    } catch (error) {
      if (error instanceof PipelineStorageError) throw error
      throw new PipelineStorageError('产物删除失败')
    }
  }

  async function removeRun(runId: string): Promise<void> {
    const target = join(rootDir, 'runs', safeSegment(runId, '运行标识'))
    if (!isContained(rootDir, target)) throw new PipelineStorageError('存储路径越界')
    await rm(target, { recursive: true, force: true })
  }

  return {
    rootDir,
    writeLogChunk,
    readLogChunk,
    writeArtifactStream,
    openArtifactStream,
    readArtifact,
    removeArtifact,
    removeRun,
  }
}

export type PipelineStorage = ReturnType<typeof createPipelineStorage>
