import { constants } from 'node:fs'
import { link, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { Type } from 'typebox'
import { z } from 'zod'
import type { BotConfig } from '../config.ts'
import { BotError } from '../errors.ts'
import { defineTool, MAX_FILE_BYTES } from './common.ts'

const pathInput = z.string().trim().min(1).max(4096)
const readInput = z.object({
  path: pathInput,
  offset: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(1000).default(200),
})
const writeInput = z.object({ path: pathInput, content: z.string(), overwrite: z.boolean().default(false) })

async function readText(path: string, signal: AbortSignal): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new BotError('FILE_TYPE_INVALID', '只能读取普通 UTF-8 文本文件')
    if (info.size > MAX_FILE_BYTES) throw new BotError('FILE_TOO_LARGE', '文件超过 1 MiB，请使用 Bash 按需提取内容')
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
    let size = 0
    while (size < buffer.length) {
      signal.throwIfAborted()
      const chunk = await file.read(buffer, size, buffer.length - size, size)
      if (!chunk.bytesRead) break
      size += chunk.bytesRead
    }
    if (size > MAX_FILE_BYTES) throw new BotError('FILE_TOO_LARGE', '文件超过 1 MiB，请使用 Bash 按需提取内容')
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size))
      if (text.includes('\0')) throw new BotError('FILE_TYPE_INVALID', '只能读取普通 UTF-8 文本文件')
      return text
    } catch {
      throw new BotError('FILE_TYPE_INVALID', '只能读取普通 UTF-8 文本文件')
    }
  } finally {
    await file.close()
  }
}

async function writeText(path: string, content: string, overwrite: boolean, signal: AbortSignal): Promise<void> {
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new BotError('FILE_TOO_LARGE', '单次写入不能超过 1 MiB')
  signal.throwIfAborted()
  await mkdir(dirname(path), { recursive: true })
  let mode = 0o600
  if (overwrite) {
    try {
      mode = (await stat(path)).mode & 0o777
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
  }
  const temporary = join(dirname(path), `.bot-${randomUUID()}.tmp`)
  const file = await open(temporary, 'wx', mode)
  try {
    try {
      await file.writeFile(content, { encoding: 'utf8', signal })
    } finally {
      await file.close()
    }
    signal.throwIfAborted()
    // 同目录提交避免读到半个文件；硬链接为首次创建提供不可覆盖的原子语义。
    if (overwrite) await rename(temporary, path)
    else await link(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

/**
 * 创建文本文件读取与原子写入工具，绝对路径直接使用，相对路径从工作目录解析。
 * @param config 已校验的工作目录、超时和输出配置。
 * @returns 两个 pi 工具；写入立即生效，不随会话事务回滚，也不提供目录沙箱。
 */
export function fileTools(config: BotConfig) {
  return [
    defineTool(config, {
      name: 'read_file',
      description: '读取 UTF-8 文件，返回带行号的文本。offset 从 1 开始，limit 默认 200、最多 1000。文件最多 1 MiB。',
      parameters: Type.Object({
        path: Type.String(),
        offset: Type.Optional(Type.Integer({ minimum: 1 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
      }),
      async run(input, signal) {
        const args = readInput.parse(input)
        const path = resolve(config.workspacePath, args.path)
        const text = await readText(path, signal)
        const lines = text ? text.split(/\r?\n/u) : []
        if (args.offset > Math.max(lines.length, 1)) throw new BotError('FILE_RANGE_INVALID', 'offset 超出文件总行数')
        const selected = lines.slice(args.offset - 1, args.offset - 1 + args.limit)
        const end = args.offset - 1 + selected.length
        return {
          text: `文件：${path}\n总行数：${lines.length}；本次至第 ${end} 行${end < lines.length ? `；下次 offset=${end + 1}` : ''}\n${selected.map((line, index) => `${args.offset + index}: ${line}`).join('\n')}`,
        }
      },
    }),
    defineTool(config, {
      name: 'write_file',
      description:
        '写入 UTF-8 文件，自动创建父目录。覆盖已有文件前先读取，并提供 overwrite=true。单次最多 1 MiB，立即生效。',
      parameters: Type.Object({
        path: Type.String(),
        content: Type.String(),
        overwrite: Type.Optional(Type.Boolean()),
      }),
      async run(input, signal) {
        const args = writeInput.parse(input)
        const path = resolve(config.workspacePath, args.path)
        await writeText(path, args.content, args.overwrite, signal)
        return { text: `已写入：${path}（${Buffer.byteLength(args.content)} 字节）` }
      },
    }),
  ]
}
