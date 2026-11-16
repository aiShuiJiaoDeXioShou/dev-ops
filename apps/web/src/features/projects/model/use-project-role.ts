import { useOutletContext } from 'react-router'
import { useSession, type TeamRole } from '@/features/identity/model/session'

/**
 * 读取当前项目所属团队中的成员角色，独立页面使用当前团队角色。
 * @returns 当前项目的团队角色；没有对应团队成员身份时只读。
 */
export function useProjectRole(): TeamRole {
  const teamId = useOutletContext<string | undefined>()
  const { role, teams } = useSession()
  return teamId ? (teams.find((team) => team.id === teamId)?.role ?? 'viewer') : role
}
