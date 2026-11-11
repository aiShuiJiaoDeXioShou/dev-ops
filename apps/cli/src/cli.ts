import { Command, CommanderError } from 'commander'
import { registerConfigCommands } from './commands/config.ts'
import { registerDeliveryCommands } from './commands/delivery.ts'
import { registerSystemCommands } from './commands/system.ts'
import { registerProjectCommands } from './commands/project.ts'
import { registerTeamCommands } from './commands/team.ts'
import { registerGitCommands } from './commands/git.ts'
import { registerCodeCommands } from './commands/code.ts'
import { registerRequirementCommands } from './commands/requirement.ts'
import { registerBugCommands } from './commands/bug.ts'
import { registerChangeCommands } from './commands/change.ts'
import { registerToolCommands } from './commands/tool.ts'
import type { CliContext } from './lib/context.ts'
import { CliError, reportError } from './lib/errors.ts'

export type { CliContext } from './lib/context.ts'

function createProgram(context: CliContext): Command {
  const program = new Command()
  program
    .name('devops')
    .description('DevOps 项目开发平台命令行工具')
    .version(context.version, '-v, --version', '显示版本')
    .option('--server <url>', '服务基础地址，优先于 DEV_OPS_SERVER 与本地配置')
    .option('--timeout <ms>', '请求超时毫秒数，默认 5000，范围 1-300000')
    .option('--json', '成功时输出平台 JSON 信封，失败时 stderr 输出错误 JSON')
    .option('--team <teamId>', '团队上下文，优先于 DEV_OPS_TEAM 与本地配置')
    .option('--yes', '非交互环境确认危险操作')
    .option('--token-stdin', '从标准输入读取 API Token')
    .option('--idempotency-key <uuid>', '覆盖写请求幂等键')
    .option('--page <n>', '列表页码')
    .option('--page-size <n>', '列表页大小，最大 100')
    .option('--all', '逐页读取全部列表')
    .exitOverride()
    .configureOutput({
      writeOut: (message) => context.stdout(message),
      writeErr: () => undefined,
    })

  registerConfigCommands(program, context)
  registerSystemCommands(program, context)
  registerProjectCommands(program, context)
  registerTeamCommands(program, context)
  registerGitCommands(program, context)
  registerCodeCommands(program, context)
  registerRequirementCommands(program, context)
  registerBugCommands(program, context)
  registerDeliveryCommands(program, context)
  registerChangeCommands(program, context)
  registerToolCommands(program, context)
  return program
}

/**
 * 解析并执行 CLI 命令。
 * @param args 不含 Node 路径和入口文件的参数。
 * @param context 版本、环境与输出通道。
 * @returns 退出码：0 成功，1 请求/运行失败，2 参数错误。
 * @remarks 帮助与版本不访问网络；命令内部不直接调用 process.exit()。
 */
export async function runCli(args: string[], context: CliContext): Promise<number> {
  const program = createProgram(context)
  if (args.length === 0) {
    program.outputHelp()
    return 0
  }
  try {
    await program.parseAsync(args, { from: 'user' })
    return 0
  } catch (error) {
    if (error instanceof CommanderError) {
      if (['commander.helpDisplayed', 'commander.version', 'commander.help'].includes(error.code)) return 0
      const message =
        error.code === 'commander.unknownCommand'
          ? '未知命令或多余参数，请运行 devops --help'
          : error.message.replace(/^error:\s*/i, '').trim() || '参数无法识别，请运行 devops --help'
      return reportError(new CliError(message, 2, { code: 'INVALID_ARGUMENTS' }), {
        json: false,
        stderr: context.stderr,
      })
    }
    return reportError(error, { json: args.includes('--json'), stderr: context.stderr })
  }
}
