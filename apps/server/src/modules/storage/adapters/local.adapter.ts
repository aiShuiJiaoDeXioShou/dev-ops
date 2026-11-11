import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve, sep } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Readable } from 'node:stream'

/** 储存桶探测结论。 */
export type StorageProbeResult = 'read_write' | 'read_only' | 'unreachable' | 'auth_failed'

/** 探测结果与可读原因。 */
export interface StorageProbeOutcome {
  result: StorageProbeResult
  message: string
}

/** 写入结果：对象键、大小与服务端计算的 SHA-256。 */
export interface StorageWriteResult {
  sizeBytes: number
  sha256: string
}

/**
 * 储存桶适配器接口。
 * @remarks 业务侧只依赖该接口；本地桶与 S3 兼容桶的实现互不影响，新增桶类型不修改附件功能。
 */
export interface StorageAdapter {
  /**
   * 流式写入对象并计算校验值。
   * @param key 桶内对象键；由平台生成，不含用户文件名。
   * @param source 文件流。
   * @param sizeBytes 预期字节数，用于提前拒绝超限。
   * @throws 大小不一致或写入失败时抛出错误。
   */
  put(key: string, source: Readable, sizeBytes: number): Promise<StorageWriteResult>
  /**
   * 读取对象流。
   * @param key 桶内对象键。
   * @returns 可读流；对象不存在时抛错。
   */
  get(key: string): Promise<Readable>
  /**
   * 删除对象；对象不存在视为成功。
   * @param key 桶内对象键。
   */
  remove(key: string): Promise<void>
  /** 探测可读写状态与失败原因。 */
  probe(): Promise<StorageProbeOutcome>
}

/** 本地适配器配置。 */
export interface LocalStorageAdapterOptions {
  rootDir: string
}

function resolveInsideRoot(rootDir: string, key: string): string {
  if (
    !key ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error('对象键不合法')
  }
  const root = resolve(rootDir)
  const target = resolve(join(root, key))
  if (target !== root && !target.startsWith(root + sep)) throw new Error('对象键越界')
  return target
}

/**
 * 创建本地目录储存桶适配器。
 * @param options 根目录；目录需可写并与部署数据一起备份。
 * @returns 实现 StorageAdapter 的本地适配器。
 */
export function createLocalStorageAdapter(options: LocalStorageAdapterOptions): StorageAdapter {
  const rootDir = resolve(options.rootDir)
  return {
    async put(key, source, sizeBytes) {
      const target = resolveInsideRoot(rootDir, key)
      await mkdir(dirname(target), { recursive: true })
      const tempPath = `${target}.tmp-${randomUUID()}`
      const hash = createHash('sha256')
      let written = 0
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      try {
        await pipeline(source, meter, createWriteStream(tempPath))
        if (written !== sizeBytes) throw new Error('写入字节数与声明大小不一致')
        await rename(tempPath, target)
        return { sizeBytes: written, sha256: hash.digest('hex') }
      } catch (error) {
        await rm(tempPath, { force: true })
        throw error
      }
    },

    async get(key) {
      const target = resolveInsideRoot(rootDir, key)
      await stat(target)
      return createReadStream(target)
    },

    async remove(key) {
      const target = resolveInsideRoot(rootDir, key)
      try {
        await unlink(target)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    },

    async probe() {
      const probeKey = `.probe-${randomUUID()}`
      const target = resolveInsideRoot(rootDir, probeKey)
      try {
        await mkdir(rootDir, { recursive: true })
        await writeFile(target, 'ok')
        await unlink(target)
        return { result: 'read_write', message: '本地目录可读写' }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') {
          return { result: 'read_only', message: '本地目录不可写，请检查目录权限' }
        }
        return { result: 'unreachable', message: '本地目录不可用，请检查路径与磁盘状态' }
      }
    },
  }
}
