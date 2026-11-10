import { input } from '@inquirer/prompts'
import { Command, CommanderError } from 'commander'
import { z } from 'zod'
import { chat } from './bot.ts'
import { loadConfig } from './config.ts'
import { BotError, errorMessage } from './errors.ts'
import { createRuntime } from './runtime.ts'
import { BotStore } from './storage/store.ts'

/**
 * 解析 CLI 并执行本地记忆命令或模型对话；帮助不打开数据库。
 * @param args 不含 Node 与脚本路径的参数。
 * @param environment 入口提供的环境配置。
 * @returns 成功为 0，运行失败为 1，参数错误为 2；不直接退出进程。
 */
export async function runCli(args: string[], environment: NodeJS.ProcessEnv): Promise<number> {
  const program = new Command()
    .name('bot')
    .description('基于 pi、DeepSeek 与 SQLite 的个人 Bot')
    .version('0.0.0')
    .exitOverride()
    .showHelpAfterError()
  function withStore<T>(operation: (store: BotStore, config: ReturnType<typeof loadConfig>) => T): T {
    const config = loadConfig(environment)
    const store = new BotStore(config.databasePath)
    try {
      return operation(store, config)
    } finally {
      store.close()
    }
  }
  program
    .command('chat [prompt]')
    .description('发送消息；省略消息进入交互模式，输入 /exit 退出')
    .option('--session <name>', '会话名称', 'main')
    .option('--json', '单轮输出 JSON')
    .action(async (value: unknown, options: unknown) => {
      const prompt = z.string().optional().parse(value)
      const flags = z.object({ session: z.string().trim().min(1).max(80), json: z.boolean().optional() }).parse(options)
      if (flags.json && prompt === undefined) throw new BotError('ARGUMENT_INVALID', '--json 必须提供单轮消息')
      const config = loadConfig(environment)
      const store = new BotStore(config.databasePath)
      const controller = new AbortController()
      const cancel = () => controller.abort()
      process.once('SIGINT', cancel)
      try {
        const runtime = createRuntime(config)
        if (prompt !== undefined) {
          const text = await chat(store, runtime, flags.session, prompt, controller.signal)
          console.log(flags.json ? JSON.stringify({ session: flags.session, text }) : text)
          return
        }
        while (!controller.signal.aborted) {
          const prompt = await input({ message: '你：' }, { signal: controller.signal })
          if (prompt.trim() === '/exit') break
          if (!prompt.trim()) continue
          console.log(await chat(store, runtime, flags.session, prompt, controller.signal))
        }
      } finally {
        process.removeListener('SIGINT', cancel)
        store.close()
      }
    })
  const memory = program.command('memory').description('查看、保存和遗忘长期记忆，不需要模型在线')
  memory
    .command('list')
    .description('列出当前 Bot 的记忆')
    .option('--json', '输出 JSON')
    .action((options: unknown) => {
      const flags = z.object({ json: z.boolean().optional() }).parse(options)
      const memories = withStore((store) => store.memories())
      console.log(
        flags.json
          ? JSON.stringify(memories)
          : memories.map((item) => `${item.id}\t${item.essential ? '[常驻] ' : ''}${item.content}`).join('\n') ||
              '暂无长期记忆',
      )
    })
  memory
    .command('remember <content>')
    .description('手工保存记忆')
    .option('--essential', '每轮注入上下文')
    .action((value: unknown, options: unknown) => {
      const content = z.string().parse(value)
      const flags = z.object({ essential: z.boolean().optional() }).parse(options)
      withStore((store) =>
        store.editMemories((workspace) => {
          workspace.remember(content, flags.essential ?? false, null)
        }),
      )
      console.log('记忆已保存')
    })
  memory
    .command('forget <id>')
    .description('按标识遗忘记忆，后续对话不再载入旧上下文')
    .action((value: unknown) => {
      const id = z.string().parse(value)
      withStore((store) => store.editMemories((workspace) => workspace.forget(id)))
      console.log('记忆已遗忘')
    })
  try {
    await program.parseAsync(args.length ? args : ['--help'], { from: 'user' })
    return 0
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode === 0 ? 0 : 2
    if (
      error instanceof z.ZodError ||
      (error instanceof BotError && ['ARGUMENT_INVALID', 'SESSION_INVALID', 'PROMPT_INVALID'].includes(error.code))
    ) {
      console.error('命令参数不合法，请运行 --help 查看用法')
      return 2
    }
    if (error instanceof Error && ['AbortPromptError', 'ExitPromptError'].includes(error.name)) return 0
    console.error(errorMessage(error))
    return 1
  }
}
