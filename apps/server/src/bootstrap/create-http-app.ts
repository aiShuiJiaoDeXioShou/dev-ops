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
import { projectLifecycleRoutes } from '../modules/projects/projects.lifecycle.routes.ts'
import { projectRoutes } from '../modules/projects/projects.routes.ts'
import { projectDashboardRoutes } from '../modules/projects/projects.dashboard.routes.ts'
import { requirementRoutes } from '../modules/requirements/requirements.routes.ts'
import { bugRoutes } from '../modules/bugs/bugs.routes.ts'
import { attachmentRoutes } from '../modules/attachments/attachments.routes.ts'
import { storageRoutes } from '../modules/storage/storage.routes.ts'
import type { MailSender } from '../adapters/mail/mail.types.ts'
import type { GitAdapter } from '../adapters/git/git.types.ts'
import { codeRoutes } from '../modules/code/code.routes.ts'
import { deliveryRoutes } from '../modules/delivery/delivery.routes.ts'
import { pipelineRoutes } from '../modules/pipeline/pipeline.routes.ts'
import { toolsRoutes } from '../modules/tools/tools.routes.ts'
import { pipelineAgentRoutes } from '../modules/pipeline/pipeline.agent.routes.ts'
import { configurationRoutes } from '../modules/configuration/configuration.routes.ts'
import { knowledgeRoutes } from '../modules/knowledge/knowledge.routes.ts'
import { integrationsRoutes } from '../modules/integrations/integrations.routes.ts'
import { gitHubAccountRoutes } from '../modules/integrations/integrations.github-account.routes.ts'
import type { GitAdapterFactory } from '../modules/integrations/integrations.service.ts'
import { createIdempotencyHooks } from '../platform/http/idempotency-hooks.ts'
import { resolveActor } from '../modules/identity/identity.actor.ts'
import { botMemoryRoutes } from '../modules/bots/bots.memory.routes.ts'
import { createBotMemoryService } from '../modules/bots/bots.memory.service.ts'
import { botsRoutes } from '../modules/bots/bots.routes.ts'
import { botConnectionsRoutes } from '../modules/bots/bots.connections.routes.ts'
import { botMcpServerRoutes } from '../modules/bots/bots.mcp-servers.routes.ts'
import { teamBotContextRoutes } from '../modules/bots/bots.team-context.ts'
import { botUsageRoutes } from '../modules/bots/bots.usage.routes.ts'
import { botPromptTemplateRoutes } from '../modules/bots/bots.prompt-templates.ts'
import { botRelayRoutes } from '../modules/collaboration/bot-relay.routes.ts'
import { botConversationsRoutes } from '../modules/collaboration/bot-conversations.routes.ts'
import { createBotConversationsService } from '../modules/collaboration/bot-conversations.service.ts'
import { createBotGroupsService } from '../modules/collaboration/bot-groups.service.ts'
import { workTagRoutes } from '../modules/collaboration/work-tags.routes.ts'
import { createWorkTagsService } from '../modules/collaboration/work-tags.service.ts'
import { botTaskRoutes } from '../modules/tasks/bot-tasks.routes.ts'
import { createBotTasksService } from '../modules/tasks/bot-tasks.service.ts'
import { createBotConnectionsService } from '../modules/bots/bots.connections.service.ts'
import { createBotLoginService } from '../modules/bots/bots.login.service.ts'
import { createSecretCipher } from '../modules/configuration/configuration.crypto.ts'
import { createBotsService } from '../modules/bots/bots.service.ts'
import type { BotDelegation } from '../modules/identity/identity.bot-delegation.ts'
import type { PipelineCredentialProvider } from '../modules/pipeline/pipeline.credentials.ts'

declare module 'fastify' {
  interface FastifyInstance {
    db: Database
    auth: IdentityAuth
    tokenService: import('../modules/identity/identity.tokens.ts').TokenService
    botDelegation: BotDelegation | null
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
    githubUserFetcher?: typeof fetch
    /** 流水线 Git 凭据签发提供者；集成测试可注入替身，避免依赖本机 Git 登录态。 */
    pipelineCredentials?: PipelineCredentialProvider
    botDelegation?: BotDelegation
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
    {
      ...options,
      log: (message, context) => app.log.warn(context ?? {}, message),
    },
  )
  app.decorate('db', services.database.db)
  app.decorate('auth', services.auth)
  app.decorate('tokenService', services.tokens)
  app.decorate('botDelegation', options.botDelegation ?? null)
  app.addHook('onClose', async () => {
    await services.close()
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
  })

  // 产物上传按原始 tar 流处理：保留请求流交给路由边写盘边计算校验和，避免大文件进入内存缓冲。
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload)
  })

  const idempotency = createIdempotencyHooks({
    db: services.database.db,
    getUserId: async (headers) =>
      (await resolveActor(services.auth, services.tokens, headers, options.botDelegation))?.user.id ?? null,
  })
  app.addHook('preHandler', idempotency.preHandler)
  app.addHook('onSend', idempotency.onSend)

  registerErrorHandlers(app)

  if (config.DOCS_ENABLED) {
    app.register(swagger, {
      openapi: {
        info: { title: 'Dev Ops API', version: '0.0.0' },
      },
      // Agent 协议端点只服务自托管执行节点，使用独立协议包与 README 文档；
      // 不进入对外 OpenAPI 与生成客户端，避免内部令牌协议出现在 Web/CLI 类型中。
      hiddenTag: 'devops-internal',
    })
    app.register(swaggerUi, { routePrefix: '/docs' })
  }

  app.register(botMemoryRoutes, { prefix: '/api/v1', service: createBotMemoryService(services.database.db) })
  app.register(botsRoutes, { prefix: '/api/v1', service: createBotsService(services.database.db) })
  const botCipher = config.GIT_CREDENTIAL_ENCRYPTION_KEY
    ? createSecretCipher(config.GIT_CREDENTIAL_ENCRYPTION_KEY)
    : null
  app.register(botConnectionsRoutes, {
    prefix: '/api/v1',
    connections: createBotConnectionsService(services.database.db, botCipher),
    login: createBotLoginService(services.database.db, botCipher),
  })
  app.register(botMcpServerRoutes, {
    prefix: '/api/v1',
    db: services.database.db,
    cipher: botCipher,
  })
  app.register(teamBotContextRoutes, { prefix: '/api/v1', db: services.database.db })
  app.register(botUsageRoutes, { prefix: '/api/v1', db: services.database.db })
  app.register(botPromptTemplateRoutes, { prefix: '/api/v1', db: services.database.db })
  const relayLimits = { hop: config.BOT_RELAY_HOP_LIMIT, reply: config.BOT_RELAY_REPLY_LIMIT }
  app.register(botRelayRoutes, { prefix: '/api/v1', db: services.database.db, limits: relayLimits })
  app.register(botConversationsRoutes, {
    prefix: '/api/v1',
    service: createBotConversationsService(services.database.db, relayLimits),
    groups: createBotGroupsService(services.database.db),
  })
  app.register(workTagRoutes, { prefix: '/api/v1', service: createWorkTagsService(services.database.db) })
  app.register(botTaskRoutes, { prefix: '/api/v1', service: createBotTasksService(services.database.db) })
  app.register(healthRoutes, { prefix: '/api/v1', checkDatabase: services.database.check })
  app.register(identityAuthRoutes, { prefix: '/api/v1', auth: services.auth, origin: config.APP_ORIGIN })
  app.register(identityTeamRoutes, { prefix: '/api/v1', auth: services.auth, service: services.identity })
  app.register(identityTokenRoutes, { prefix: '/api/v1', tokenService: services.tokens, service: services.identity })
  app.register(projectLifecycleRoutes, { prefix: '/api/v1', service: services.projectLifecycle })
  app.register(projectRoutes, { prefix: '/api/v1', auth: services.auth, service: services.projects })
  app.register(projectDashboardRoutes, { prefix: '/api/v1', service: services.projectDashboard })
  app.register(requirementRoutes, { prefix: '/api/v1', auth: services.auth, service: services.requirements })
  app.register(bugRoutes, { prefix: '/api/v1', auth: services.auth, service: services.bugs })
  app.register(attachmentRoutes, {
    prefix: '/api/v1',
    auth: services.auth,
    service: services.attachments,
    maxFileBytes: config.ATTACHMENT_MAX_BYTES,
  })
  app.register(storageRoutes, {
    prefix: '/api/v1',
    service: services.storageManagement,
  })
  app.register(codeRoutes, { prefix: '/api/v1', auth: services.auth, service: services.code })
  app.register(deliveryRoutes, { prefix: '/api/v1', service: services.delivery })
  app.register(pipelineRoutes, {
    prefix: '/api/v1',
    service: services.pipeline,
    nodes: services.pipelineNodes,
  })
  app.register(toolsRoutes, {
    prefix: '/api/v1',
    db: services.database.db,
    codeChanges: services.codeChanges,
    remoteWrite: services.remoteWrite,
  })
  app.register(pipelineAgentRoutes, {
    prefix: '/api/v1',
    nodes: services.pipelineNodes,
    agent: services.pipelineAgent,
    maxArtifactBytes: config.PIPELINE_ARTIFACT_MAX_BYTES,
    maxLogChunkBytes: config.PIPELINE_LOG_CHUNK_MAX_BYTES,
  })
  if (services.configuration) {
    app.register(configurationRoutes, { prefix: '/api/v1', service: services.configuration })
  }
  app.register(knowledgeRoutes, { prefix: '/api/v1', service: services.knowledge })
  app.register(integrationsRoutes, {
    prefix: '/api/v1',
    auth: services.auth,
    service: services.integrations,
    githubAccount: services.githubAccount,
    webOrigin: config.APP_ORIGIN,
  })
  app.register(gitHubAccountRoutes, {
    prefix: '/api/v1',
    auth: services.auth,
    service: services.githubAccount,
  })

  // 启动时校验内置本地储存桶存在且满足不变量；缺失补建，被误改则阻止启动。
  app.addHook('onReady', async () => {
    try {
      const outcome = await services.storage.ensureBuiltinBucket()
      if (outcome === 'created') app.log.warn('已补建内置本地储存桶，请确认 ATTACHMENT_STORAGE_DIR 与备份策略')
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      // 内置桶存在但被误改属于部署错误，必须阻止启动；表不存在说明迁移未执行，交由就绪检查暴露。
      if (message.includes('内置本地储存桶')) throw error
      app.log.warn({ err: error }, '数据库尚未迁移，跳过内置储存桶校验')
    }
  })

  return app
}
