import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { Type, type Static } from 'typebox'
import { Check } from 'typebox/value'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { Database } from '../../platform/database/client.ts'
import { isUniqueViolation } from '../../platform/database/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { apiResponseSchema, success } from '../../platform/http/response.ts'
import type { SecretCipher } from '../configuration/configuration.crypto.ts'
import { credential } from '../configuration/configuration.tables.ts'
import { requireActor } from '../identity/identity.actor.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { botMcpServer } from './bots.platform.tables.ts'
import { bot } from './bots.tables.ts'
import { tryBotMcpConnection } from './runtime/mcp-configuration.ts'
import { parseBotMcpUrl } from './runtime/mcp-fetch.ts'

const uuid = Type.String({ format: 'uuid' })
const status = Type.Union([Type.Literal('enabled'), Type.Literal('disabled')])
const exposure = Type.Union([Type.Literal('direct'), Type.Literal('deferred')])
const botIds = Type.Array(uuid, { maxItems: 100, uniqueItems: true })
const body = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 40, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }),
    url: Type.String({ minLength: 1, maxLength: 2048 }),
    credentialId: Type.Optional(Type.Union([uuid, Type.Null()])),
    exposure,
    botIds,
  },
  { additionalProperties: false },
)
const row = Type.Object({
  name: Type.String(),
  status,
  id: Type.Optional(uuid),
  url: Type.Optional(Type.String()),
  credentialId: Type.Optional(Type.Union([uuid, Type.Null()])),
  exposure: Type.Optional(exposure),
  botIds: Type.Optional(botIds),
})
const teamParams = Type.Object({ teamId: uuid })
const serverParams = Type.Object({ serverId: uuid })
const list = apiResponseSchema(
  Type.Object({
    items: Type.Array(row),
    nextCursor: Type.Union([uuid, Type.Null()]),
    canManage: Type.Boolean(),
  }),
)
const result = apiResponseSchema(row)
const check = apiResponseSchema(
  Type.Object({
    isConnected: Type.Boolean(),
    toolCount: Type.Integer({ minimum: 0 }),
    failureMessage: Type.Optional(Type.String()),
  }),
)
const MCP_LIST_LIMIT = 30

function invalid(message: string): never {
  throw new ApiError(ERROR_CODES.BOT_MCP_SERVER_INVALID, message)
}

function missing(): never {
  throw new ApiError(ERROR_CODES.NOT_FOUND, 'MCP 服务不存在或不可见')
}

function duplicate(error: unknown): never {
  if (isUniqueViolation(error)) invalid('团队已存在同名 MCP 服务')
  throw error
}

function view(server: typeof botMcpServer.$inferSelect, admin = true): Static<typeof row> {
  if (!Check(status, server.status)) throw new Error('数据库中的 MCP 服务状态不合法')
  const common = { name: server.name, status: server.status }
  if (!admin) return common
  if (!Check(exposure, server.exposure) || !Check(botIds, server.bot_ids))
    throw new Error('数据库中的 MCP 服务配置不合法')
  return {
    ...common,
    id: server.id,
    url: server.url,
    credentialId: server.credential_id,
    exposure: server.exposure,
    botIds: server.bot_ids,
  }
}

async function validatedInput(tx: Pick<Database, 'select'>, teamId: string, input: Static<typeof body>) {
  let url: URL
  try {
    url = parseBotMcpUrl(input.url.trim())
  } catch {
    invalid('请输入公网 HTTPS MCP 服务地址')
  }
  const ids = input.botIds
  const rows = ids.length
    ? await tx
        .select({ id: bot.id })
        .from(bot)
        .where(and(eq(bot.team_id, teamId), inArray(bot.id, ids)))
        .for('key share')
    : []
  if (rows.length !== ids.length) invalid('授予的 Bot 不属于当前团队')
  if (input.credentialId) {
    const [entry] = await tx
      .select({ id: credential.id })
      .from(credential)
      .where(
        and(
          eq(credential.team_id, teamId),
          eq(credential.id, input.credentialId),
          eq(credential.status, 'active'),
          eq(credential.kind, 'api_key'),
          or(isNull(credential.expires_at), gt(credential.expires_at, sql`clock_timestamp()`)),
        ),
      )
      .for('key share')
    if (!entry) invalid('凭据必须是本团队有效的 API 密钥')
  }
  return {
    name: input.name,
    url: url.href,
    credential_id: input.credentialId ?? null,
    exposure: input.exposure,
    bot_ids: ids,
  }
}

/**
 * 注册远程 MCP 配置接口。只有管理员可查看和修改服务地址、凭据引用或授权范围。
 * @param app HTTP 应用。
 * @param options 数据库与可选的团队凭据解密器。
 * @returns 注册完成；业务错误通过统一响应信封返回。
 */
export const botMcpServerRoutes: FastifyPluginAsyncTypebox<{ db: Database; cipher: SecretCipher | null }> = async (
  app,
  { db, cipher },
) => {
  app.get(
    '/teams/:teamId/bot-mcp-servers',
    {
      schema: {
        summary: '读取团队远程 MCP 服务',
        params: teamParams,
        querystring: Type.Object({ cursor: Type.Optional(uuid) }),
        response: { 200: list },
      },
    },
    async (request) => {
      const { teamId } = request.params
      const membership = await requireTeamMember(db, (await requireActor(request)).id, teamId)
      const canManage = membership.role === 'admin'
      const rows = await db
        .select()
        .from(botMcpServer)
        .where(
          and(
            eq(botMcpServer.team_id, teamId),
            request.query.cursor ? gt(botMcpServer.id, request.query.cursor) : undefined,
          ),
        )
        .orderBy(asc(botMcpServer.id))
        .limit(MCP_LIST_LIMIT + 1)
      const items = rows.slice(0, MCP_LIST_LIMIT).map((entry) => view(entry, canManage))
      return success(
        { items, canManage, nextCursor: rows.length > MCP_LIST_LIMIT ? (rows[MCP_LIST_LIMIT - 1]?.id ?? null) : null },
        request.id,
      )
    },
  )
  app.post(
    '/teams/:teamId/bot-mcp-servers',
    {
      schema: { summary: '新增团队远程 MCP 服务', params: teamParams, body, response: { 200: result } },
    },
    async (request) => {
      const actor = await requireActor(request)
      const { teamId } = request.params
      const created = await db
        .transaction(async (tx) => {
          await requireTeamMember(tx, actor.id, teamId, ['admin'])
          const config = await validatedInput(tx, teamId, request.body)
          const [entry] = await tx
            .insert(botMcpServer)
            .values({
              ...config,
              team_id: teamId,
              created_by: actor.id,
              updated_by: actor.id,
            })
            .returning()
          if (!entry) throw new Error('未能创建 MCP 服务')
          return entry
        })
        .catch(duplicate)
      return success(view(created), request.id)
    },
  )

  async function authorized(database: Pick<Database, 'select'>, actor: SessionUser, id: string) {
    const [entry] = await database.select().from(botMcpServer).where(eq(botMcpServer.id, id))
    if (!entry) missing()
    await requireTeamMember(database, actor.id, entry.team_id, ['admin'])
    return entry
  }
  app.post(
    '/bot-mcp-servers/:serverId/update',
    {
      schema: { summary: '修改并授权远程 MCP 服务', params: serverParams, body, response: { 200: result } },
    },
    async (request) => {
      const actor = await requireActor(request)
      const updated = await db
        .transaction(async (tx) => {
          const entry = await authorized(tx, actor, request.params.serverId)
          const configuration = await validatedInput(tx, entry.team_id, request.body)
          const [saved] = await tx
            .update(botMcpServer)
            .set({
              ...configuration,
              updated_by: actor.id,
              updated_at: new Date(),
            })
            .where(and(eq(botMcpServer.id, entry.id), eq(botMcpServer.team_id, entry.team_id)))
            .returning()
          return saved ?? missing()
        })
        .catch(duplicate)
      return success(view(updated), request.id)
    },
  )
  for (const action of ['enable', 'disable', 'remove'] as const) {
    const summary = { enable: '启用', disable: '停用', remove: '移除' }[action]
    app.post(
      `/bot-mcp-servers/:serverId/${action}`,
      {
        schema: { summary: `${summary}远程 MCP 服务`, params: serverParams, response: { 200: result } },
      },
      async (request) => {
        const actor = await requireActor(request)
        const saved = await db.transaction(async (tx) => {
          const item = await authorized(tx, actor, request.params.serverId)
          const scope = and(eq(botMcpServer.id, item.id), eq(botMcpServer.team_id, item.team_id))
          const [updated] =
            action === 'remove'
              ? await tx.delete(botMcpServer).where(scope).returning()
              : await tx
                  .update(botMcpServer)
                  .set({
                    status: action === 'enable' ? 'enabled' : 'disabled',
                    updated_by: actor.id,
                    updated_at: new Date(),
                  })
                  .where(scope)
                  .returning()
          return updated ?? missing()
        })
        return success(view(saved), request.id)
      },
    )
  }
  app.post(
    '/bot-mcp-servers/:serverId/test',
    {
      schema: { summary: '测试 MCP 连接与工具发现', params: serverParams, response: { 200: check } },
    },
    async (request) => {
      const item = await authorized(db, await requireActor(request), request.params.serverId)
      return success(await tryBotMcpConnection(db, cipher, item.team_id, item), request.id)
    },
  )
}
