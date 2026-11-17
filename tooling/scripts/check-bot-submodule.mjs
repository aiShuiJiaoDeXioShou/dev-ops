import { existsSync } from 'node:fs'

if (!existsSync(new URL('../../packages/devops-bot/package.json', import.meta.url))) {
  console.error('devops-bot 子模块尚未初始化或提交太旧：请先运行 git submodule update --init')
  process.exitCode = 1
}
