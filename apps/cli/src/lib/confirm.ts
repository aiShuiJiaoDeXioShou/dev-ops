import { confirm } from '@inquirer/prompts'
import { CliError } from './errors.ts'

/**
 * 危险操作统一确认：--yes 直接放行；JSON 模式或非交互终端拒绝；TTY 下二次确认。
 * @param options 全局确认参数与操作说明。
 * @returns 确认通过后完成；拒绝或取消时抛出带退出码的 CLI 错误。
 * @throws 非交互/JSON 模式未给 --yes 时退出码 2；用户取消时退出码 1。
 */
export async function confirmDangerous(options: { yes: boolean; json?: boolean; message: string }): Promise<void> {
  if (options.yes) return
  if (options.json === true || process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    throw new CliError('非交互环境执行危险操作必须显式传入 --yes', 2, { code: 'CONFIRMATION_REQUIRED' })
  }
  const accepted = await confirm({ message: options.message, default: false })
  if (!accepted) throw new CliError('操作已取消', 1, { code: 'CONFIRMATION_CANCELLED' })
}
