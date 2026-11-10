/** CLI 执行上下文；便于测试替换输入输出。 */
export interface CliContext {
  version: string
  env: NodeJS.ProcessEnv
  stdout: (message: string) => void
  stderr: (message: string) => void
  readStdin?: () => Promise<string>
}
