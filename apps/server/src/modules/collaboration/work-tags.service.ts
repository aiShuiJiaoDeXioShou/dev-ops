import { and, asc, eq, gt, ilike, or, sql } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { isUniqueViolation } from '../../platform/database/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { requireTeamMember, type SessionUser, type TeamRole } from '../identity/identity.session.ts'
import { botTask } from '../tasks/bot-tasks.tables.ts'
import { lockWritableBotConversation } from './bot-conversations.access.ts'
import { workTag, workTagLink } from './bot-conversations.tables.ts'
import { ensureWorkTag, normalizeWorkTag, workTagView } from './work-tags.repository.ts'
import type { WorkTagLinkInput } from './work-tags.schema.ts'

const EDIT_ROLES: TeamRole[] = ['admin', 'developer']
const PAGE_SIZE = 50
type ReadDb = Pick<Database, 'select'>

function missingTag(): never {
  throw new ApiError(ERROR_CODES.NOT_FOUND, '标签不存在或不可见')
}

async function tagById(db: ReadDb, id: string) {
  const [tag] = await db.select().from(workTag).where(eq(workTag.id, id))
  if (!tag) missingTag()
  return tag
}

async function targetRoom(db: ReadDb, input: WorkTagLinkInput, teamId: string) {
  if (input.targetKind === 'conversation') return input.targetId
  const [target] = await db
    .select({ id: botTask.conversation_id })
    .from(botTask)
    .where(and(eq(botTask.id, input.targetId), eq(botTask.team_id, teamId)))
  if (!target) throw new ApiError(ERROR_CODES.NOT_FOUND, '任务不存在或不可见')
  return target.id
}

/**
 * 组装团队工作标签管理和会话授权下的关联修改。
 * @param db 平台数据库。
 * @returns 只读列表与保留业务资源的增删改操作。
 */
export function createWorkTagsService(db: Database) {
  return {
    /** 分页读取团队标签，按规范化名称排序并支持文本搜索。 */
    async list(actor: SessionUser, teamId: string, filters: { query?: string; cursor?: string }) {
      await requireTeamMember(db, actor.id, teamId)
      const previous = filters.cursor ? await tagById(db, filters.cursor) : undefined
      if (previous && previous.team_id !== teamId) missingTag()
      const query = filters.query
        ?.trim()
        .normalize('NFKC')
        .replace(/[\\%_]/gu, '\\$&')
      const rows = await db
        .select()
        .from(workTag)
        .where(
          and(
            eq(workTag.team_id, teamId),
            query ? ilike(workTag.normalized_name, `%${query}%`) : undefined,
            previous
              ? or(
                  gt(workTag.normalized_name, previous.normalized_name),
                  and(eq(workTag.normalized_name, previous.normalized_name), gt(workTag.id, previous.id)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(workTag.normalized_name), asc(workTag.id))
        .limit(PAGE_SIZE + 1)
      const items = rows.slice(0, PAGE_SIZE).map(workTagView)
      return { items, nextCursor: rows.length > PAGE_SIZE ? (items.at(-1)?.id ?? null) : null }
    },
    /** 创建团队标签；规范化名称相同则返回已有标签。 */
    async create(actor: SessionUser, teamId: string, name: string) {
      return db.transaction(async (tx) => {
        await requireTeamMember(tx, actor.id, teamId, EDIT_ROLES)
        return workTagView(await ensureWorkTag(tx, teamId, name))
      })
    },
    /** 修改名称，已有的会话和任务关联保留。 */
    async rename(actor: SessionUser, id: string, name: string) {
      const tag = await tagById(db, id)
      await requireTeamMember(db, actor.id, tag.team_id, EDIT_ROLES)
      try {
        const [updated] = await db
          .update(workTag)
          .set({ ...normalizeWorkTag(name), updated_at: sql`clock_timestamp()` })
          .where(and(eq(workTag.id, id), eq(workTag.team_id, tag.team_id)))
          .returning()
        if (!updated) missingTag()
        return workTagView(updated)
      } catch (error) {
        if (isUniqueViolation(error)) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '团队内已存在同名标签')
        throw error
      }
    },
    /** 删除团队标签及关联，不写会话和任务记录。 */
    async remove(actor: SessionUser, id: string) {
      return db.transaction(async (tx) => {
        const tag = await tagById(tx, id)
        await requireTeamMember(tx, actor.id, tag.team_id, EDIT_ROLES)
        const [locked] = await tx
          .select({ id: workTag.id })
          .from(workTag)
          .where(and(eq(workTag.id, id), eq(workTag.team_id, tag.team_id)))
          .for('update')
        if (!locked) missingTag()
        await tx.delete(workTagLink).where(and(eq(workTagLink.tag_id, id), eq(workTagLink.team_id, tag.team_id)))
        await tx.delete(workTag).where(and(eq(workTag.id, id), eq(workTag.team_id, tag.team_id)))
        return { id }
      })
    },
    /** 在当前会话的写权限范围内增加或移除标签关联。 */
    async link(actor: SessionUser, id: string, input: WorkTagLinkInput, shouldLink: boolean) {
      return db.transaction(async (tx) => {
        const tag = await tagById(tx, id)
        const room = await lockWritableBotConversation(tx, actor, await targetRoom(tx, input, tag.team_id))
        if (room.team_id !== tag.team_id) missingTag()
        const [locked] = await tx
          .select({ id: workTag.id })
          .from(workTag)
          .where(and(eq(workTag.id, id), eq(workTag.team_id, room.team_id)))
          .for('key share')
        if (!locked) missingTag()
        if (shouldLink) {
          await tx
            .insert(workTagLink)
            .values({
              team_id: room.team_id,
              tag_id: id,
              target_kind: input.targetKind,
              target_id: input.targetId,
              linked_by_kind: 'user',
              linked_by_id: actor.id,
            })
            .onConflictDoNothing({ target: [workTagLink.tag_id, workTagLink.target_kind, workTagLink.target_id] })
        } else {
          await tx
            .delete(workTagLink)
            .where(
              and(
                eq(workTagLink.team_id, room.team_id),
                eq(workTagLink.tag_id, id),
                eq(workTagLink.target_kind, input.targetKind),
                eq(workTagLink.target_id, input.targetId),
              ),
            )
        }
        return { id }
      })
    },
  }
}

export type WorkTagsService = ReturnType<typeof createWorkTagsService>
