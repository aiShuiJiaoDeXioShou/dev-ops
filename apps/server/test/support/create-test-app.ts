import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import type { MailSender } from '../../src/adapters/mail/mail.types.ts'
import type { GitAdapter } from '../../src/adapters/git/git.types.ts'
import type { GitAdapterFactory } from '../../src/modules/integrations/integrations.service.ts'
import { createTestConfig } from './test-config.ts'

/**
 * 创建不监听端口的测试应用。
 * @param overrides 测试配置覆盖项。
 * @returns 可通过 inject 调用的 Fastify 实例；调用方负责 close。
 */
export function createTestApp(
  overrides: NodeJS.ProcessEnv = {},
  options: {
    mailer?: MailSender
    gitAdapterResolver?: (connectionId: string) => Promise<GitAdapter>
    activeConnectionIds?: (teamId: string) => Promise<string[]>
    gitAdapterFactory?: (connection: Parameters<GitAdapterFactory>[0]) => Promise<GitAdapter>
  } = {},
) {
  return createHttpApp(createTestConfig(overrides), options)
}
