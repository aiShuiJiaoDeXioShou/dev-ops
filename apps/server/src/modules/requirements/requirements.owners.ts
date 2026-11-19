import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '../../platform/database/client.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { findActiveTeamMemberIds } from '../identity/identity.repository.ts'
import { requirementOwner } from './requirements.tables.ts'

type TransactionDatabase = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * 查询需求的全部研发和测试负责人。
 * @param db 数据库连接。
 * @param requirementId 单个需求标识或分页中的需求标识集合。
 * @returns 有稳定顺序的负责人关联；旧需求没有关联时由调用者回退到单负责人字段。
 */
export async function findRequirementOwners(db: Database, requirementId: string | string[]) {
  const ids = typeof requirementId === 'string' ? [requirementId] : requirementId
  if (ids.length === 0) return []
  return db
    .select({
      requirementId: requirementOwner.requirement_id,
      userId: requirementOwner.user_id,
      role: requirementOwner.role,
    })
    .from(requirementOwner)
    .where(inArray(requirementOwner.requirement_id, ids))
    .orderBy(requirementOwner.created_at, requirementOwner.id)
}

/**
 * 在已锁定需求的事务中替换一类负责人，并校验团队归属。
 * @param tx 当前事务。
 * @param requirementId 需求标识。
 * @param teamId 需求所属团队。
 * @param role 研发或测试角色。
 * @param userIds 去重前的成员标识，空数组清空该类负责人。
 * @returns 写入完成；无效或跨团队成员抛出业务错误，调用者事务整体回滚。
 */
export async function replaceRequirementOwners(
  tx: TransactionDatabase,
  requirementId: string,
  teamId: string,
  role: 'development' | 'test',
  userIds: string[],
) {
  const unique = [...new Set(userIds)]
  if (unique.length > 20) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '同类负责人不能超过 20 人')
  const active = await findActiveTeamMemberIds(tx, teamId, unique)
  if (unique.some((id) => !active.has(id))) {
    throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '负责人不是正常团队成员')
  }
  await tx
    .delete(requirementOwner)
    .where(and(eq(requirementOwner.requirement_id, requirementId), eq(requirementOwner.role, role)))
  if (unique.length)
    await tx.insert(requirementOwner).values(
      unique.map((userId) => ({
        id: randomUUID(),
        team_id: teamId,
        requirement_id: requirementId,
        user_id: userId,
        role,
      })),
    )
}
