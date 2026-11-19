import { and, eq } from 'drizzle-orm'
import { Type } from 'typebox'
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { apiResponseSchema, success } from '../../platform/http/response.ts'
import { requireActor } from '../identity/identity.actor.ts'
import { requireTeamMember } from '../identity/identity.session.ts'
import { teamBotContext } from './bots.platform.tables.ts'

const MAX_CONTEXT_BYTES = 16_384
const params = Type.Object({
  teamId: Type.String({ pattern: '^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' }),
})
const body = Type.Object(
  { content: Type.String(), version: Type.Integer({ minimum: 0 }) },
  { additionalProperties: false },
)
const response = apiResponseSchema(
  Type.Object({
    ...body.properties,
    updatedBy: Type.Union([Type.String(), Type.Null()]),
    updatedAt: Type.Union([Type.String(), Type.Null()]),
  }),
)

/**
 * 读取团队上下文。尚未配置时以空正文及版本零响应。
 * @param db 平台或执行进程数据库。
 * @param teamId 已经校验归属的团队。
 * @returns 团队上下文、版本与更新信息。
 */
export async function readTeamBotContext(db: Pick<Database, 'select'>, teamId: string) {
  const [row] = await db
    .select({
      content: teamBotContext.content,
      version: teamBotContext.version,
      actor: teamBotContext.updated_by,
      time: teamBotContext.updated_at,
    })
    .from(teamBotContext)
    .where(eq(teamBotContext.team_id, teamId))
  return {
    content: row?.content ?? '',
    version: row?.version ?? 0,
    updatedBy: row?.actor ?? null,
    updatedAt: row?.time.toISOString() ?? null,
  }
}

/**
 * 注册团队上下文读取与更新。写请求通过版本字段检查并发修改。
 * @param app Fastify 应用。
 * @param options 数据库依赖。
 * @returns 注册完成；只有管理员能够更新正文。
 */
export const teamBotContextRoutes: FastifyPluginAsyncTypebox<{ db: Database }> = async (app, { db }) => {
  app.get(
    '/teams/:teamId/bot-context',
    {
      schema: { summary: '读取团队 Bot 共享上下文', params, response: { 200: response } },
    },
    async (request) => {
      const { teamId } = request.params
      await requireTeamMember(db, (await requireActor(request)).id, teamId)
      return success(await readTeamBotContext(db, teamId), request.id)
    },
  )
  app.post(
    '/teams/:teamId/bot-context',
    {
      schema: { summary: '保存团队 Bot 共享上下文', params, body, response: { 200: response } },
    },
    async (request) => {
      const { teamId } = request.params
      const actor = await requireActor(request)
      const { content, version } = request.body
      if (Buffer.byteLength(content, 'utf8') > MAX_CONTEXT_BYTES)
        throw new ApiError(ERROR_CODES.BOT_CONTEXT_TOO_LARGE, '团队上下文最多 16 KB')
      const data = await db.transaction(async (tx) => {
        await requireTeamMember(tx, actor.id, teamId, ['admin'])
        const changes = { content, version: version + 1, updated_by: actor.id, updated_at: new Date() }
        const [saved] =
          version === 0
            ? await tx
                .insert(teamBotContext)
                .values({ team_id: teamId, ...changes })
                .onConflictDoNothing({ target: teamBotContext.team_id })
                .returning()
            : await tx
                .update(teamBotContext)
                .set(changes)
                .where(and(eq(teamBotContext.team_id, teamId), eq(teamBotContext.version, version)))
                .returning()
        if (!saved) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '团队上下文已被更新，请刷新后重试')
        return {
          content: saved.content,
          version: saved.version,
          updatedBy: saved.updated_by,
          updatedAt: saved.updated_at.toISOString(),
        }
      })
      return success(data, request.id)
    },
  )
}
