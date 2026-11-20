import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { link, mkdtemp, open, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { CliError } from './errors.ts'

type Download = { body: ReadableStream<Uint8Array>; sha256: string; requestId: string; timeout: AbortSignal }

/**
 * 流式写入临时文件并核对摘要，校验成功后才以原子方式发布到目标路径。
 * @param output 新文件路径，不覆盖已有文件。
 * @param request 打开受鉴权的下载流。
 * @returns 文件路径、字节数、摘要和请求标识。
 * @throws 读写、校验或超时失败时抛出 CLI 错误，并清理临时数据。
 */
export async function downloadToFile(output: string, request: () => Promise<Download>) {
  const directory = await mkdtemp(join(dirname(output), '.devops-download-')).catch(() => {
    throw new CliError('无法在目标目录创建临时文件', 2, { code: 'OUTPUT_UNWRITABLE' })
  })
  try {
    const response = await request()
    const temporary = join(directory, 'payload')
    const hash = createHash('sha256')
    let sizeBytes = 0
    try {
      await pipeline(
        response.body,
        async function* (chunks) {
          for await (const chunk of chunks) {
            hash.update(chunk)
            sizeBytes += chunk.byteLength
            yield chunk
          }
        },
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
        { signal: response.timeout },
      )
    } catch {
      const code = response.timeout.aborted ? 'TIMEOUT' : 'DOWNLOAD_FAILED'
      throw new CliError('下载中断，目标文件未写入', 1, { code, requestId: response.requestId })
    }
    if (hash.digest('hex') !== response.sha256) {
      throw new CliError('下载文件 SHA-256 校验失败', 1, { code: 'CHECKSUM_MISMATCH', requestId: response.requestId })
    }
    try {
      await link(temporary, output)
    } catch {
      throw new CliError('无法写入目标文件，请确认路径有效且文件不存在', 2, { code: 'OUTPUT_UNWRITABLE' })
    }
    return { data: { path: output, sizeBytes, sha256: response.sha256 }, requestId: response.requestId }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

/**
 * 预留权限为 0600 的文件，再请求只能读取一次的节点令牌。
 * @param output 新文件路径，不覆盖已有文件。
 * @param request 返回秘密值及可公开的独立业务结果。
 * @returns 公开结果和请求标识；秘密值只写入目标文件。
 * @throws 目标不可写或请求失败时清除预留文件；写入失败时提示重新轮换。
 */
export async function saveNodeToken<T>(
  output: string,
  request: () => Promise<{ secret: string; data: T; requestId: string }>,
): Promise<{ data: T; requestId: string }> {
  const file = await open(output, 'wx', 0o600).catch(() => {
    throw new CliError('无法创建令牌文件，请确认路径有效且文件不存在', 2, { code: 'OUTPUT_UNWRITABLE' })
  })
  let saved = false
  try {
    const { secret, data, requestId } = await request()
    try {
      await file.writeFile(`${secret}\n`)
      await file.sync()
    } catch {
      throw new CliError('节点令牌已签发但保存失败，请重新轮换', 1, { code: 'TOKEN_SAVE_FAILED', requestId })
    }
    saved = true
    return { data, requestId }
  } finally {
    try {
      await file.close()
    } finally {
      if (!saved) await rm(output, { force: true })
    }
  }
}
