import assert from 'node:assert/strict'
import { runCli } from '../../../apps/cli/dist/cli.js'

/**
 * 用已构建的 CLI 经真实 HTTP 执行业务命令并验证输出信封。
 * @param config 当前测试应用地址、个人 Token 与可选团队。
 * @param args 传给 Commander 的业务参数。
 * @param body 需要通过 --file - 传入的可选 JSON。
 * @returns 平台成功数据。
 */
export async function runDevops(config, args, body) {
  let stdout = ''
  let stderr = ''
  const code = await runCli([...args, '--json'], {
    version: '0.8.0',
    env: { DEV_OPS_SERVER: config.server, DEV_OPS_TOKEN: config.token, DEV_OPS_TEAM: config.team },
    stdout: (message) => {
      stdout += message
    },
    stderr: (message) => {
      stderr += message
    },
    readStdin: async () => JSON.stringify(body),
  })
  assert.equal(code, 0, `CLI ${args.slice(0, 2).join(' ')} 失败：${stderr}`)
  assert.equal(stderr, '')
  const result = JSON.parse(stdout)
  assert.equal(result.success, true)
  return result.data
}
