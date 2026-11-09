import { createHttpApp } from '../../src/bootstrap/create-http-app.js'
import type { MailSender } from '../../src/adapters/mail/mail.types.js'
import type { GitAdapter } from '../../src/adapters/git/git.types.js'
import type { GitAdapterFactory } from '../../src/modules/integrations/public.js'
import { createTestConfig } from './test-config.js'

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
