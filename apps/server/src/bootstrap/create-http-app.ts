import Fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { loadConfig, type AppConfig } from '../platform/config/env.ts'
import { healthRoutes } from '../modules/health/health.routes.ts'
import { registerErrorHandlers } from '../platform/http/errors.ts'
import type { Database } from '../platform/database/client.ts'
import { createServices } from './create-services.ts'
import type { IdentityAuth } from '../modules/identity/identity.auth.ts'
import { identityAuthRoutes } from '../modules/identity/identity.routes.ts'
import { identityTeamRoutes } from '../modules/identity/identity.team.routes.ts'
import { identityTokenRoutes } from '../modules/identity/identity.tokens.routes.ts'
import { projectRoutes } from '../modules/projects/projects.routes.ts'
import { projectDashboardRoutes } from '../modules/projects/projects.dashboard.routes.ts'
import { requirementRoutes } from '../modules/requirements/requirements.routes.ts'
import { bugRoutes } from '../modules/bugs/bugs.routes.ts'
import type { MailSender } from '../adapters/mail/mail.types.ts'
import type { GitAdapter } from '../adapters/git/git.types.ts'
import { codeRoutes } from '../modules/code/code.routes.ts'
import { deliveryRoutes } from '../modules/delivery/delivery.routes.ts'
import { configurationRoutes } from '../modules/configuration/configuration.routes.ts'
import { knowledgeRoutes } from '../modules/knowledge/knowledge.routes.ts'
import { integrationsRoutes } from '../modules/integrations/integrations.routes.ts'
import type { GitAdapterFactory } from '../modules/integrations/integrations.service.ts'
import { createIdempotencyHooks } from '../platform/http/idempotency-hooks.ts'
import { resolveActor } from '../modules/identity/identity.actor.ts'

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
    auth: IdentityAuth
    tokenService: import('../modules/identity/identity.tokens.ts').TokenService
  }
}

/**
 * 组装 HTTP 应用和数据库连接池，不监听端口或自动执行迁移。
 * @param config 已校验的配置，默认从进程环境加载。
 * @returns 可监听端口或使用 inject 测试的 Fastify 实例，db 提供 Drizzle 查询入口。
 * @remarks 数据库按需连接；调用 app.close() 会关闭连接池，数据库故障不影响存活接口。
 * @throws 配置校验失败时抛出错误。
 */
export function createHttpApp(
  config: AppConfig = loadConfig(),
  options: {
    mailer?: MailSender
    gitAdapterResolver?: (connectionId: string) => Promise<GitAdapter>
    activeConnectionIds?: (teamId: string) => Promise<string[]>
    gitAdapterFactory?: (connection: Parameters<GitAdapterFactory>[0]) => Promise<GitAdapter>
  } = {},
) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    requestIdHeader: false,
    bodyLimit: 1024 * 1024,
    requestTimeout: 30_000,
    // 拒绝未知输入字段，避免静默删除后造成客户端误解。
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<TypeBoxTypeProvider>()

  const services = createServices(
    config,
    (code) => {
      app.log.error({ code }, '数据库空闲连接异常')
    },
    options,
  )
  app.decorate('db', services.database.db)
  app.decorate('auth', services.auth)
  app.decorate('tokenService', services.tokens)
  app.addHook('onClose', async () => {
    await services.close()
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })

  const idempotency = createIdempotencyHooks({
    db: services.database.db,
    getUserId: async (headers) => (await resolveActor(services.auth, services.tokens, headers))?.user.id ?? null,
  })
  app.addHook('preHandler', idempotency.preHandler)
  app.addHook('onSend', idempotency.onSend)

  registerErrorHandlers(app)

  if (config.DOCS_ENABLED) {
    app.register(swagger, {
      openapi: {
        info: { title: 'Dev Ops API', version: '0.0.0' },
      },
    })
    app.register(swaggerUi, { routePrefix: '/docs' })
  }

  app.register(healthRoutes, { prefix: '/api/v1', checkDatabase: services.database.check })
  app.register(identityAuthRoutes, { prefix: '/api/v1', auth: services.auth, origin: config.APP_ORIGIN })
  app.register(identityTeamRoutes, { prefix: '/api/v1', auth: services.auth, service: services.identity })
  app.register(identityTokenRoutes, { prefix: '/api/v1', tokenService: services.tokens, service: services.identity })
  app.register(projectRoutes, { prefix: '/api/v1', auth: services.auth, service: services.projects })
  app.register(projectDashboardRoutes, { prefix: '/api/v1', service: services.projectDashboard })
  app.register(requirementRoutes, { prefix: '/api/v1', auth: services.auth, service: services.requirements })
  app.register(bugRoutes, { prefix: '/api/v1', auth: services.auth, service: services.bugs })
  app.register(codeRoutes, { prefix: '/api/v1', auth: services.auth, service: services.code })
  app.register(deliveryRoutes, { prefix: '/api/v1', service: services.delivery })
  if (services.configuration) {
    app.register(configurationRoutes, { prefix: '/api/v1', service: services.configuration })
  }
  app.register(knowledgeRoutes, { prefix: '/api/v1', auth: services.auth, service: services.knowledge })
  app.register(integrationsRoutes, {
    prefix: '/api/v1',
    auth: services.auth,
    service: services.integrations,
    webOrigin: config.APP_ORIGIN,
  })

  return app
}
