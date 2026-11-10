import { chmod, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import envPaths from 'env-paths'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'

/** CLI 本地配置；Token 与 server 绑定同一 origin。 */
export interface LocalConfig {
  server?: string
  token?: string
  tokenServer?: string
}

const LocalConfigSchema = z
  .object({
    server: z.string().optional(),
    token: z.string().optional(),
    tokenServer: z.string().optional(),
  })
  .strict()

/** 本地配置读取/校验失败；错误信息可直接展示。 */
export class ConfigFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigFileError'
  }
}

/** 返回本地配置文件路径；遵循 XDG/平台配置目录。 */
export function configFilePath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME?.trim()
  const configDirectory =
    xdgConfigHome && xdgConfigHome.length > 0
      ? join(xdgConfigHome, 'devops')
      : envPaths('devops', { suffix: '' }).config
  return join(configDirectory, 'config.json')
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

/**
 * 读取本地配置；文件不存在返回空对象。
 * @returns 已校验配置。
 * @throws JSON 或字段不合法时抛出 ConfigFileError，不泄露文件内容。
 */
export async function readLocalConfig(): Promise<LocalConfig> {
  let text: string
  try {
    text = await readFile(configFilePath(), 'utf8')
  } catch (error) {
    if (isMissingFile(error)) return {}
    throw new ConfigFileError('无法读取本地配置，请检查文件权限')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ConfigFileError('本地配置不是合法 JSON，请运行 devops config set 重新配置')
  }
  const result = LocalConfigSchema.safeParse(parsed)
  if (!result.success) throw new ConfigFileError('本地配置字段不合法，请运行 devops config set 重新配置')
  return result.data
}

/**
 * 原子写入本地配置，并收紧目录/文件权限。
 * @param config 要保存的配置。
 * @returns 写入完成。
 * @throws 目录创建或写入失败时抛出，不包含文件内容。
 */
export async function writeLocalConfig(config: LocalConfig): Promise<void> {
  const file = configFilePath()
  const directory = dirname(file)
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await chmod(directory, 0o700)
    await writeFileAtomic(file, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await chmod(file, 0o600)
  } catch {
    throw new ConfigFileError('无法保存本地配置，请检查配置目录权限')
  }
}

/** 清空本地配置；用于测试或显式重置。 */
export async function clearLocalConfig(): Promise<void> {
  await writeLocalConfig({})
}
