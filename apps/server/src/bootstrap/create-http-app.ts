import Fastify from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { loadConfig, type AppConfig } from '../platform/config/env.js'
import { healthRoutes } from '../modules/health/health.routes.js'
import { registerErrorHandlers } from '../platform/http/errors.js'
import { createDatabase, type Database } from '../platform/database/client.js'

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
  }
}

/**
 * 组装 HTTP 应用和数据库连接池，不监听端口或自动执行迁移。
 * @param config 已校验的配置，默认从进程环境加载。
 * @returns 可监听端口或使用 inject 测试的 Fastify 实例，db 提供 Drizzle 查询入口。
 * @remarks 数据库按需连接；调用 app.close() 会关闭连接池，数据库故障不影响存活接口。
 * @throws 配置校验失败时抛出错误。
 */
export function createHttpApp(config: AppConfig = loadConfig()) {
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

  const database = createDatabase(config, (code) => {
    app.log.error({ code }, '数据库空闲连接异常')
  })
  app.decorate('db', database.db)
  app.addHook('onClose', async () => { await database.close() })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })

  registerErrorHandlers(app)

  if (config.DOCS_ENABLED) {
    app.register(swagger, {
      openapi: {
        info: { title: 'Dev Ops API', version: '0.0.0' },
      },
    })
    app.register(swaggerUi, { routePrefix: '/docs' })
  }

  app.register(healthRoutes, { prefix: '/api/v1', checkDatabase: database.check })

  return app
}
