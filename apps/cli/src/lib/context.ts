/** CLI 执行上下文；便于测试替换输入输出。 */
export interface CliContext {
  version: string
  env: NodeJS.ProcessEnv
  stdout: (message: string) => void
  stderr: (message: string) => void
  readStdin?: () => Promise<string>
  /** 本地 Git 操作的工作目录；省略时使用进程当前目录，测试可指向临时仓库。 */
  cwd?: string
}
