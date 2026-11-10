import { Command } from 'commander'
import { password } from '@inquirer/prompts'
import { resolveServerUrl, type GlobalOptions } from '../lib/config.ts'
import { readLocalConfig, writeLocalConfig, type LocalConfig } from '../lib/config-file.ts'
import { CliError } from '../lib/errors.ts'
import type { CliContext } from '../lib/context.ts'
import { maskToken, TOKEN_PREFIX } from '../lib/token.ts'
import { printSuccess } from '../lib/output.ts'

const CONFIG_KEYS = ['server', 'token'] as const

function assertKey(key: string): asserts key is (typeof CONFIG_KEYS)[number] {
  if (!CONFIG_KEYS.includes(key as (typeof CONFIG_KEYS)[number])) {
    throw new CliError('配置项必须是 server 或 token', 2, { code: 'INVALID_CONFIG_KEY' })
  }
}

async function readTokenValue(context: CliContext, globals: GlobalOptions): Promise<string> {
  const useStdin = globals.tokenStdin === true || !process.stdin.isTTY || !process.stdout.isTTY
  const value = useStdin
    ? await (context.readStdin ?? (async () => ''))()
    : await password({ message: '请输入 API Token（输入不回显）' })
  const token = value.trim()
  if (!token.startsWith(TOKEN_PREFIX)) throw new CliError('API Token 格式无效', 2, { code: 'TOKEN_INVALID' })
  return token
}

function serializeServer(url: URL): string {
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
  return `${url.origin}${path}`
}

function summary(config: LocalConfig): Record<string, unknown> {
  return {
    server: config.server ?? null,
    token: config.token ? maskToken(config.token) : null,
    tokenServer: config.tokenServer ?? null,
  }
}

/** 注册 `devops config` 命令组。 */
export function registerConfigCommands(program: Command, context: CliContext): void {
  const config = program.command('config').description('管理本地服务地址与 API Token')

  config
    .command('set')
    .argument('<key>', '配置项：server 或 token')
    .argument('[value]', 'server 地址；token 不使用该参数')
    .description('设置服务地址或保存 API Token')
    .action(async (key: string, value: string | undefined, _options: unknown, command: Command) => {
      assertKey(key)
      const globals = command.optsWithGlobals<GlobalOptions>()
      const current = await readLocalConfig()
      if (key === 'server') {
        if (!value) throw new CliError('config set server 需要提供地址', 2, { code: 'MISSING_VALUE' })
        const url = resolveServerUrl({ ...globals, server: value }, context.env, {})
        const nextServer = serializeServer(url)
        if (current.server !== nextServer) {
          delete current.token
          delete current.tokenServer
        }
        current.server = nextServer
        await writeLocalConfig(current)
        printSuccess({ json: globals.json === true, stdout: context.stdout }, { server: current.server }, '')
        return
      }
      const server = resolveServerUrl(globals, context.env, current)
      const token = await readTokenValue(context, globals)
      current.token = token
      current.tokenServer = server.origin
      current.server = current.server ?? serializeServer(server)
      await writeLocalConfig(current)
      printSuccess(
        { json: globals.json === true, stdout: context.stdout },
        { token: maskToken(token), tokenServer: current.tokenServer },
        '',
      )
    })

  config
    .command('get')
    .argument('[key]', '可选配置项：server 或 token')
    .description('查看本地配置（Token 掩码）')
    .action(async (...args: unknown[]) => {
      const command = args.at(-1) as Command
      const key = typeof args[0] === 'string' ? args[0] : undefined
      if (key !== undefined) assertKey(key)
      const globals = command.optsWithGlobals<GlobalOptions>()
      const current = await readLocalConfig()
      const all = summary(current)
      const data = key === undefined ? all : { [key]: all[key] }
      printSuccess({ json: globals.json === true, stdout: context.stdout }, data, '')
    })

  config
    .command('unset')
    .argument('<key>', '配置项：server 或 token')
    .description('删除本地配置项')
    .action(async (key: string, _options: unknown, command: Command) => {
      assertKey(key)
      const globals = command.optsWithGlobals<GlobalOptions>()
      const current = await readLocalConfig()
      if (key === 'server') {
        delete current.server
        delete current.token
        delete current.tokenServer
      } else {
        delete current.token
        delete current.tokenServer
      }
      await writeLocalConfig(current)
      printSuccess({ json: globals.json === true, stdout: context.stdout }, summary(current), '')
    })
}
