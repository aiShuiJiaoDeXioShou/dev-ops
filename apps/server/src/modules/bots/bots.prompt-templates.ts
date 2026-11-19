import { and, asc, eq, gt, ilike, or } from 'drizzle-orm'
import { Type } from 'typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { Database } from '../../platform/database/client.ts'
import { isUniqueViolation } from '../../platform/database/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { apiResponseSchema, success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { botPromptTemplate } from './bots.platform.tables.ts'

const uuid = Type.String({ pattern: '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' })
const fields = {
  name: Type.String({ minLength: 1, maxLength: 40, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' }),
  description: Type.String({ minLength: 1, maxLength: 200 }),
  body: Type.String({ minLength: 1, maxLength: 16000 }),
}
const body = Type.Object(fields, { additionalProperties: false })
const view = Type.Object({
  id: uuid,
  teamId: uuid,
  name: Type.String(),
  description: Type.String(),
  body: Type.String(),
  updatedAt: Type.String(),
})
const viewResponse = apiResponseSchema(view)
const teamParams = Type.Object({ teamId: uuid })
const templateParams = Type.Object({ templateId: uuid })
const idResponse = apiResponseSchema(Type.Object({ id: uuid }))
const listQuery = Type.Object({ query: Type.Optional(Type.String({ maxLength: 80 })), cursor: Type.Optional(uuid) })
const listResponse = apiResponseSchema(
  Type.Object({ items: Type.Array(view), nextCursor: Type.Union([uuid, Type.Null()]) }),
)
const TEMPLATE_LIMIT = 30

function templateView(row: typeof botPromptTemplate.$inferSelect) {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    description: row.description,
    body: row.body,
    updatedAt: row.updated_at.toISOString(),
  }
}

function notFound(): never {
  throw new ApiError(ERROR_CODES.NOT_FOUND, '提示模板不存在或不可见')
}

function handleDuplicate(error: unknown): never {
  if (isUniqueViolation(error)) throw new ApiError(ERROR_CODES.BOT_PROMPT_TEMPLATE_CONFLICT, '团队已存在同名提示模板')
  throw error
}

/**
 * 在当前会话所属的团队内读取指定的提示模板。
 * @param db 发送消息的写事务或数据库。
 * @param teamId 会话所属团队。
 * @param id 用户选择的模板。
 * @returns 同团队模板；缺失或跨团队时拒绝。
 */
export async function requireBotPromptTemplate(db: Pick<Database, 'select'>, teamId: string, id: string) {
  const [row] = await db
    .select({
      id: botPromptTemplate.id,
      name: botPromptTemplate.name,
      body: botPromptTemplate.body,
    })
    .from(botPromptTemplate)
    .where(and(eq(botPromptTemplate.team_id, teamId), eq(botPromptTemplate.id, id)))
  return row ?? notFound()
}

/**
 * 注册团队提示模板的读取和写操作，使用平台成员角色授权。
 * @param app Fastify 应用。
 * @param options 数据库依赖。
 * @returns 注册成功后完成。
 */
export const botPromptTemplateRoutes: FastifyPluginAsyncTypebox<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/teams/:teamId/bot-prompt-templates',
    {
      schema: {
        summary: '列出团队 Bot 提示模板',
        params: teamParams,
        querystring: listQuery,
        response: { 200: listResponse },
      },
    },
    async (request) => {
      const actor = await requireActor(request)
      await requireTeamMember(db, actor.id, request.params.teamId)
      const query = request.query.query?.trim().replace(/[\\%_]/gu, '\\$&')
      const term = `%${query ?? ''}%`
      const rows = await db
        .select()
        .from(botPromptTemplate)
        .where(
          and(
            eq(botPromptTemplate.team_id, request.params.teamId),
            query ? or(ilike(botPromptTemplate.name, term), ilike(botPromptTemplate.description, term)) : undefined,
            request.query.cursor ? gt(botPromptTemplate.id, request.query.cursor) : undefined,
          ),
        )
        .orderBy(asc(botPromptTemplate.id))
        .limit(TEMPLATE_LIMIT + 1)
      const items = rows.slice(0, TEMPLATE_LIMIT).map(templateView)
      return success(
        { items, nextCursor: rows.length > TEMPLATE_LIMIT ? (items.at(-1)?.id ?? null) : null },
        request.id,
      )
    },
  )
  app.post(
    '/teams/:teamId/bot-prompt-templates',
    {
      schema: { summary: '新建团队 Bot 提示模板', params: teamParams, body, response: { 200: viewResponse } },
    },
    async (request) => {
      const actor = await requireActor(request)
      const teamId = request.params.teamId
      await requireTeamMember(db, actor.id, teamId, ['admin', 'developer'])
      const [row] = await db
        .insert(botPromptTemplate)
        .values({
          ...request.body,
          team_id: teamId,
          created_by: actor.id,
          updated_by: actor.id,
        })
        .returning()
        .catch(handleDuplicate)
      if (!row) throw new Error('未能保存提示模板')
      return success(templateView(row), request.id)
    },
  )

  async function requireWritable(actor: SessionUser, id: string) {
    const [row] = await db
      .select({ teamId: botPromptTemplate.team_id })
      .from(botPromptTemplate)
      .where(eq(botPromptTemplate.id, id))
    if (!row) notFound()
    await requireTeamMember(db, actor.id, row.teamId, ['admin', 'developer'])
    return and(eq(botPromptTemplate.id, id), eq(botPromptTemplate.team_id, row.teamId))
  }
  app.post(
    '/bot-prompt-templates/:templateId/update',
    {
      schema: { summary: '更新 Bot 提示模板', params: templateParams, body, response: { 200: viewResponse } },
    },
    async (request) => {
      const actor = await requireActor(request)
      const scope = await requireWritable(actor, request.params.templateId)
      const [row] = await db
        .update(botPromptTemplate)
        .set({
          ...request.body,
          updated_by: actor.id,
          updated_at: new Date(),
        })
        .where(scope)
        .returning()
        .catch(handleDuplicate)
      return success(row ? templateView(row) : notFound(), request.id)
    },
  )
  app.post(
    '/bot-prompt-templates/:templateId/remove',
    {
      schema: { summary: '移除 Bot 提示模板', params: templateParams, response: { 200: idResponse } },
    },
    async (request) => {
      const scope = await requireWritable(await requireActor(request), request.params.templateId)
      const [row] = await db.delete(botPromptTemplate).where(scope).returning({ id: botPromptTemplate.id })
      return success(row ?? notFound(), request.id)
    },
  )
}
