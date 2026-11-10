import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { lstat, mkdir, readdir, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { pack } from 'tar-stream'
import type { Pack } from 'tar-stream'

import type { AgentLogger } from './logger.ts'

/** 产物准备与打包失败分类；由执行器映射成步骤失败原因。 */
export type ArtifactErrorCode =
  | 'ARTIFACT_PATH_INVALID'
  | 'ARTIFACT_PATH_NOT_FOUND'
  | 'ARTIFACT_NAME_INVALID'
  | 'ARTIFACT_LIMIT_EXCEEDED'
  | 'ARTIFACT_PACK_FAILED'

/** 产物错误；message 面向用户且不含敏感信息。 */
export class ArtifactError extends Error {
  readonly code: ArtifactErrorCode

  constructor(code: ArtifactErrorCode, message: string) {
    super(message)
    this.name = 'ArtifactError'
    this.code = code
  }
}

/** 打包完成的本地 tar 文件；上传成功后由调用方删除。 */
export interface PackedArtifact {
  filePath: string
  sizeBytes: number
  /** 64 位小写十六进制 SHA-256。 */
  sha256: string
}

export interface PackArtifactInput {
  /** 仓库检出目录；产物路径相对它解析且不得逃逸。 */
  workspaceDir: string
  /** workflow 声明的产物相对路径（文件或目录）。 */
  artifactPath: string
  /** 打包临时目录；必须位于运行工作区内以便统一清理。 */
  tempDir: string
  /** 产物大小上限，单位字节。 */
  maxBytes: number
  logger: AgentLogger
}

interface CollectedEntry {
  type: 'directory' | 'file'
  /** tar 内相对路径，使用 `/` 分隔。 */
  name: string
  absolutePath: string
  sizeBytes: number
}

type TarEntrySink = ReturnType<Pack['entry']>
type TarEntryHeader = Parameters<Pack['entry']>[0]

/** 产物名规则与 workflow-yaml.md 保持一致。 */
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9._-]{1,80}$/

/**
 * 校验产物名。
 * @param name workflow 中 `with.name` 的取值。
 * @throws ArtifactError 名称不合法时抛出。
 */
export function validateArtifactName(name: string): void {
  if (!ARTIFACT_NAME_PATTERN.test(name)) {
    throw new ArtifactError('ARTIFACT_NAME_INVALID', `产物名不合法：${name}（只允许字母、数字、点、下划线与短横线）`)
  }
}

function isContained(rootDir: string, target: string): boolean {
  const root = resolve(rootDir)
  const resolved = resolve(target)
  return resolved === root || resolved.startsWith(`${root}${sep}`)
}

/**
 * 把 workflow 的产物路径解析到工作区内的绝对路径。
 * @param workspaceDir 仓库检出目录。
 * @param artifactPath workflow 声明的相对路径。
 * @returns 工作区内的绝对路径。
 * @throws ArtifactError 绝对路径、包含 `..` 逃逸或解析到工作区外时抛出。
 */
export function resolveArtifactPath(workspaceDir: string, artifactPath: string): string {
  if (artifactPath.length === 0) throw new ArtifactError('ARTIFACT_PATH_INVALID', '产物路径不能为空')
  if (isAbsolute(artifactPath)) throw new ArtifactError('ARTIFACT_PATH_INVALID', '产物路径必须是工作区相对路径')
  if (artifactPath.includes('\0')) throw new ArtifactError('ARTIFACT_PATH_INVALID', '产物路径包含非法字符')
  const target = resolve(workspaceDir, artifactPath)
  if (!isContained(workspaceDir, target)) {
    throw new ArtifactError('ARTIFACT_PATH_INVALID', '产物路径不能逃逸工作区')
  }
  return target
}

/** 递归收集打包条目；符号链接与特殊文件跳过，避免把工作区外内容打进产物。 */
async function collectEntries(input: {
  absolutePath: string
  entryName: string
  logger: AgentLogger
  entries: CollectedEntry[]
}): Promise<void> {
  const info = await lstat(input.absolutePath)
  if (info.isDirectory()) {
    if (input.entryName.length > 0) {
      input.entries.push({
        type: 'directory',
        name: `${input.entryName}/`,
        absolutePath: input.absolutePath,
        sizeBytes: 0,
      })
    }
    const children = await readdir(input.absolutePath, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name))
    for (const child of children) {
      const childName = input.entryName.length === 0 ? child.name : `${input.entryName}/${child.name}`
      await collectEntries({
        absolutePath: join(input.absolutePath, child.name),
        entryName: childName,
        logger: input.logger,
        entries: input.entries,
      })
    }
    return
  }
  if (info.isFile()) {
    input.entries.push({ type: 'file', name: input.entryName, absolutePath: input.absolutePath, sizeBytes: info.size })
    return
  }
  input.logger.warn(`产物打包跳过不支持的文件类型：${input.entryName}`)
}

/** 把单个文件流式写入 tar 条目，使用 tar entry 的 drain 事件处理背压。 */
async function writeFileEntry(packStream: Pack, header: TarEntryHeader, filePath: string): Promise<void> {
  let resolveDone: () => void = () => undefined
  let rejectDone: (error: Error) => void = () => undefined
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve
    rejectDone = reject
  })
  let sink: TarEntrySink
  try {
    sink = packStream.entry(header, (error) => {
      if (error) rejectDone(error)
      else resolveDone()
    })
  } catch (error) {
    throw new ArtifactError('ARTIFACT_PACK_FAILED', `创建 tar 条目失败：${describeCause(error)}`)
  }
  const bridge = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      if (sink.write(chunk)) callback()
      else sink.once('drain', () => callback())
    },
    final(callback): void {
      sink.end(undefined)
      callback()
    },
  })
  let removePackListener: () => void = () => undefined
  // pack 流被销毁（例如产物超限）时立即失败，避免等待永远不会触发的 drain/完成回调。
  const packFailure = new Promise<never>((_resolve, reject) => {
    const onPackError = (error: Error): void => reject(error)
    packStream.once('error', onPackError)
    removePackListener = () => packStream.off('error', onPackError)
  })
  void packFailure.catch(() => undefined)
  try {
    await Promise.race([pipeline(createReadStream(filePath), bridge), packFailure])
    await Promise.race([done, packFailure])
  } catch (error) {
    sink.destroy(error instanceof Error ? error : undefined)
    throw new ArtifactError('ARTIFACT_PACK_FAILED', `写入 tar 条目失败：${describeCause(error)}`)
  } finally {
    removePackListener()
  }
}

function describeCause(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}

/**
 * 把文件或目录打包成 tar 文件并计算 SHA-256 与大小。
 * @param input 工作区、产物路径、临时目录、大小上限与日志器。
 * @returns 本地 tar 文件路径、字节数与 SHA-256；调用方负责上传后删除文件。
 * @throws ArtifactError 路径不合法/不存在、超过大小上限或打包失败时抛出。
 * @remarks
 * - tar 内容按产物路径为根组织（目录内容位于归档根，文件以 basename 作为条目名）。
 * - 符号链接与设备文件会被跳过并记录告警，避免产物逃逸工作区。
 * - 打包前按文件总大小预检上限，流式写入时再次兜底；超过即删除临时文件。
 */
export async function packArtifact(input: PackArtifactInput): Promise<PackedArtifact> {
  const rootPath = resolveArtifactPath(input.workspaceDir, input.artifactPath)
  let rootInfo
  try {
    rootInfo = await lstat(rootPath)
  } catch {
    throw new ArtifactError('ARTIFACT_PATH_NOT_FOUND', `产物路径不存在：${input.artifactPath}`)
  }
  const entries: CollectedEntry[] = []
  if (rootInfo.isDirectory()) {
    await collectEntries({ absolutePath: rootPath, entryName: '', logger: input.logger, entries })
  } else if (rootInfo.isFile()) {
    entries.push({ type: 'file', name: basename(rootPath), absolutePath: rootPath, sizeBytes: rootInfo.size })
  } else {
    throw new ArtifactError('ARTIFACT_PATH_INVALID', '产物路径必须是普通文件或目录')
  }

  const totalContentBytes = entries.reduce((total, entry) => total + entry.sizeBytes, 0)
  if (totalContentBytes > input.maxBytes) {
    throw new ArtifactError('ARTIFACT_LIMIT_EXCEEDED', `产物超过大小上限 ${input.maxBytes} 字节`)
  }

  await mkdir(input.tempDir, { recursive: true })
  const filePath = join(input.tempDir, `artifact-${randomUUID()}.tar`)
  const packStream = pack()
  const hash = createHash('sha256')
  let sizeBytes = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback): void {
      sizeBytes += chunk.byteLength
      if (sizeBytes > input.maxBytes) {
        callback(new ArtifactError('ARTIFACT_LIMIT_EXCEEDED', `产物超过大小上限 ${input.maxBytes} 字节`))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  // 必须先启动消费者，再写入 tar 条目：否则条目写入会在 pack 高水位后等待背压而死锁。
  const writePromise = pipeline(Readable.from(packStream), limiter, createWriteStream(filePath))
  try {
    for (const entry of entries) {
      const header: TarEntryHeader =
        entry.type === 'directory'
          ? { name: entry.name, type: 'directory' }
          : { name: entry.name, size: entry.sizeBytes, type: 'file' }
      if (entry.type === 'directory') {
        packStream.entry(header)
        continue
      }
      await writeFileEntry(packStream, header, entry.absolutePath)
    }
    packStream.finalize()
    await writePromise
  } catch (error) {
    packStream.destroy()
    await writePromise.catch(() => undefined)
    await rm(filePath, { force: true })
    if (error instanceof ArtifactError) throw error
    throw new ArtifactError('ARTIFACT_PACK_FAILED', `产物打包失败：${describeCause(error)}`)
  }
  return { filePath, sizeBytes, sha256: hash.digest('hex') }
}

/**
 * 删除打包产生的本地 tar 文件。
 * @param artifact 打包结果；为空表示没有文件需要清理。
 * @remarks 删除失败不抛错，由调用方决定是否把清理失败上报；文件位于运行工作区内会随工作区删除。
 */
export async function removePackedArtifact(artifact: PackedArtifact | undefined): Promise<void> {
  if (!artifact) return
  await rm(artifact.filePath, { force: true })
}
