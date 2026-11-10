import { findTeamMemberStatuses, findUserSummariesByIds, type IdentityExecutor } from './identity.repository.ts'

const UNKNOWN_USER_NAME = '未知用户'

/** 用户展示引用，仅包含对外展示需要的标识与姓名。 */
export interface UserRef {
  userId: string
  name: string
}

/**
 * 按标识批量加载用户展示引用，统一处理姓名缺失时的兜底文案。
 * @param executor 数据库连接或事务。
 * @param userIds 用户标识集合，重复项会由底层查询去重。
 * @returns 以用户标识为键的展示引用 Map。
 */
export async function loadUserRefs(executor: IdentityExecutor, userIds: string[]): Promise<Map<string, UserRef>> {
  const summaries = await findUserSummariesByIds(executor, userIds)
  return new Map(
    summaries.map((summary) => [summary.id, { userId: summary.id, name: summary.name ?? UNKNOWN_USER_NAME }]),
  )
}

/**
 * 从批量加载结果中读取单个用户的展示引用。
 * @param userId 用户标识；为空表示无负责人。
 * @param refs 用户展示引用 Map。
 * @returns 用户引用；无 userId 时返回 null，用户不存在时使用未知用户兜底。
 */
export function userRefOf(userId: string | null, refs: Map<string, UserRef>): UserRef | null {
  if (userId === null) return null
  return refs.get(userId) ?? { userId, name: UNKNOWN_USER_NAME }
}

/**
 * 从批量加载结果中读取用户名，缺失时使用未知用户兜底。
 * @param userId 用户标识。
 * @param refs 用户展示引用 Map。
 * @returns 展示用姓名。
 */
export function userNameOf(userId: string, refs: Map<string, UserRef>): string {
  return refs.get(userId)?.name ?? UNKNOWN_USER_NAME
}

/** 负责人展示状态：正常、已停用或不在团队/用户不存在。 */
export type OwnerStatus = 'active' | 'disabled' | 'missing'

/** 带可用性标记的负责人引用。 */
export interface OwnerRef extends UserRef {
  status: OwnerStatus
  available: boolean
}

/**
 * 批量加载负责人姓名与团队可用性，避免每个负责人单独查库。
 * @param executor 数据库连接或事务。
 * @param teamId 负责人所属团队。
 * @param userIds 用户标识集合。
 * @returns 用户标识到负责人引用的 Map。
 */
export async function loadOwnerRefs(
  executor: IdentityExecutor,
  teamId: string,
  userIds: string[],
): Promise<Map<string, OwnerRef>> {
  const [refs, statuses] = await Promise.all([
    loadUserRefs(executor, userIds),
    findTeamMemberStatuses(executor, teamId, userIds),
  ])
  return new Map(
    [...new Set(userIds)].map((userId) => {
      const ref = refs.get(userId)
      const memberStatus = statuses.get(userId)
      const status: OwnerStatus = memberStatus ?? 'missing'
      return [
        userId,
        {
          userId,
          name: ref?.name ?? UNKNOWN_USER_NAME,
          status,
          available: status === 'active',
        },
      ]
    }),
  )
}

/**
 * 读取单个负责人可用性引用；无用户时返回 null，缺失用户使用 missing。
 */
export function ownerRefOf(userId: string | null, refs: Map<string, OwnerRef>): OwnerRef | null {
  if (userId === null) return null
  return refs.get(userId) ?? { userId, name: UNKNOWN_USER_NAME, status: 'missing', available: false }
}
