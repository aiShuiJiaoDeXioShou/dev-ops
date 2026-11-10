import type { Command } from 'commander'
import { fetchMe, type MeResponse } from '../lib/auth.ts'
import { resolveServerUrl, resolveTimeout, type GlobalOptions } from '../lib/config.ts'
import { readLocalConfig } from '../lib/config-file.ts'
import { createHttpClient } from '../lib/http.ts'
import { printSuccess } from '../lib/output.ts'
import { resolveToken } from '../lib/token.ts'
import type { CliContext } from '../lib/context.ts'

function formatMe(me: MeResponse): string {
  const teams = me.teams.length === 0 ? '（无）' : me.teams.map((team) => `${team.name}（${team.role}）`).join('、')
  return `账号: ${me.user.email}\n姓名: ${me.user.name}\n团队: ${teams}\n令牌: 有效\n`
}

/** 注册健康检查、就绪检查与身份命令。 */
export function registerSystemCommands(program: Command, context: CliContext): void {
  program
    .command('health')
    .description('检查后端进程是否存活，不需要 API Token')
    .action(async (_options: unknown, command: Command) => {
      const globals = command.optsWithGlobals<GlobalOptions>()
      const server = resolveServerUrl(globals, context.env, await readLocalConfig())
      const client = createHttpClient(server, resolveTimeout(globals.timeout))
      const result = await client.health()
      printSuccess(
        { json: globals.json === true, stdout: context.stdout },
        result.data,
        result.requestId,
        (data) => `${(data as { status: string }).status === 'ok' ? '后端运行正常' : '后端状态异常'}\n`,
      )
    })

  program
    .command('ready')
    .description('检查数据库就绪状态，不需要 API Token')
    .action(async (_options: unknown, command: Command) => {
      const globals = command.optsWithGlobals<GlobalOptions>()
      const server = resolveServerUrl(globals, context.env, await readLocalConfig())
      const client = createHttpClient(server, resolveTimeout(globals.timeout))
      const result = await client.ready()
      printSuccess({ json: globals.json === true, stdout: context.stdout }, result.data, result.requestId, (data) => {
        const status = data as { status?: string; database?: string }
        return `后端运行正常，数据库${status.database === 'ok' ? '可用' : '不可用'}\n`
      })
    })

  program
    .command('whoami')
    .description('验证 API Token 并显示账号、服务与团队')
    .action(async (_options: unknown, command: Command) => {
      const globals = command.optsWithGlobals<GlobalOptions>()
      const config = await readLocalConfig()
      const server = resolveServerUrl(globals, context.env, config)
      const token = await resolveToken(
        globals,
        context.env,
        config,
        context.readStdin ?? (async () => ''),
        server.origin,
      )
      const result = await fetchMe(server, resolveTimeout(globals.timeout), token)
      printSuccess({ json: globals.json === true, stdout: context.stdout }, result.data, result.requestId, (data) =>
        formatMe(data as MeResponse),
      )
    })
}
