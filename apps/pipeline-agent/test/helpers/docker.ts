import assert from 'node:assert/strict'

/** Docker 可达时返回 true；测试环境不可用时调用方应显式跳过并标记未验证。 */
export async function isDockerAvailable(): Promise<boolean> {
  const Docker = (await import('dockerode')).default
  try {
    const client = new Docker()
    await client.ping()
    return true
  } catch {
    return false
  }
}

/** 断言 Docker 环境为测试可用；不可用时抛出带说明的错误，避免伪造通过。 */
export async function requireDocker(): Promise<void> {
  assert.ok(await isDockerAvailable(), 'Docker 不可用：请启动 Docker 后运行该集成测试')
}

/** 真实 Docker 集成测试使用的镜像；可用 AGENT_TEST_IMAGE 覆盖，优先使用本机已有镜像。 */
export const TEST_IMAGE = process.env.AGENT_TEST_IMAGE?.trim() || 'node:24-bookworm-slim'

/** 真实 Docker 集成测试的跳过原因；Docker 可用时为 false。 */
export async function dockerSkipReason(): Promise<false | string> {
  if (await isDockerAvailable()) return false
  return 'Docker 不可用：跳过真实 Docker 集成测试（未验证项需在交付说明中标注）'
}
