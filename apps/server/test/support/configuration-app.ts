import { randomBytes } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { createConfigurationService } from '../../src/modules/configuration/configuration.service.ts'
import { createSecretCipher } from '../../src/modules/configuration/configuration.crypto.ts'
import { configurationRoutes } from '../../src/modules/configuration/configuration.routes.ts'
import { createTestConfig } from './test-config.ts'

/**
 * 用测试密钥注册凭据与环境变量路由。
 *
 * 测试配置不设置 GIT_CREDENTIAL_ENCRYPTION_KEY，bootstrap 因此不会创建配置服务、
 * 也不会注册该插件；这里显式注册，既覆盖真实 HTTP 路径，又不会与后续
 * `if (services.configuration)` 的正式注册重复。
 * @param app 已创建但未 ready 的 Fastify 实例。
 * @param encryptionKey 32 字节 base64 测试密钥。
 * @returns 无返回值；路由注册到 `/api/v1` 前缀。
 */
export function registerConfigurationRoutes(app: FastifyInstance, encryptionKey: string): void {
  app.register(configurationRoutes, {
    prefix: '/api/v1',
    service: createConfigurationService({ db: app.db, cipher: createSecretCipher(encryptionKey) }),
  })
}

/**
 * 创建用于 HTTP 契约测试的应用，并注册凭据与环境变量路由。
 * @param overrides 测试配置覆盖项。
 * @param options 与 createHttpApp 相同的可选依赖覆盖项。
 * @returns 可通过 inject 调用的 Fastify 实例；调用方负责 close。
 * @remarks 不连接真实数据库，只用于未登录与 schema 校验路径。
 */
export function createConfigurationTestApp(
  overrides: NodeJS.ProcessEnv = {},
  options: NonNullable<Parameters<typeof createHttpApp>[1]> = {},
) {
  const encryptionKey = randomBytes(32).toString('base64')
  const app = createHttpApp(createTestConfig(overrides), options)
  registerConfigurationRoutes(app, encryptionKey)
  return app
}
