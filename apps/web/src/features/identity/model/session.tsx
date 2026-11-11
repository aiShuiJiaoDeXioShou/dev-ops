import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { myTeamsQueryOptions, sessionQueryOptions } from '../api/queries'
import type { AuthUser } from '../api/auth-client'

export type TeamRole = 'admin' | 'developer' | 'viewer'
export interface TeamSummary {
  id: string
  name: string
  iconText?: string | null
  description?: string | null
  version?: number
  role: TeamRole
  status: string
}
interface SessionContextValue {
  user: AuthUser
  teams: TeamSummary[]
  currentTeam: TeamSummary | null
  role: TeamRole
  setCurrentTeam: (teamId: string) => void
  /** 团队列表是否已解析，页面应等就绪后再渲染，避免空状态闪现。 */
  isReady: boolean
  /** 当前用户是否为平台管理员；用于隐藏平台级入口，服务端仍独立校验。 */
  isPlatformAdmin: boolean
}
const SessionContext = createContext<SessionContextValue | null>(null)

/**
 * 在已认证布局内提供用户、团队与当前团队角色。
 * @param props.initialUser 已完成认证的用户；children 为受保护页面。
 * @returns 会话上下文；首次加载团队时展示加载状态。
 */
export function SessionProvider({ initialUser, children }: { initialUser: AuthUser; children: ReactNode }) {
  const session = useQuery(sessionQueryOptions)
  const teamsQuery = useQuery(myTeamsQueryOptions)
  const user = session.data?.user ?? initialUser
  const teamsPayload = teamsQuery.data?.data
  const teams = useMemo<TeamSummary[]>(() => (teamsPayload?.teams ?? []) as TeamSummary[], [teamsPayload])
  const isPlatformAdmin = teamsPayload?.isPlatformAdmin ?? false
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(() =>
    localStorage.getItem('dev-ops.current-team'),
  )
  useEffect(() => {
    if (teams.length === 0) return
    const valid = teams.some((team) => team.id === selectedTeamId)
    if (!valid) {
      const next = teams[0]?.id ?? null
      setSelectedTeamId(next)
      if (next) localStorage.setItem('dev-ops.current-team', next)
    }
  }, [teams, selectedTeamId])
  const currentTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0] ?? null
  const setCurrentTeam = (teamId: string) => {
    setSelectedTeamId(teamId)
    localStorage.setItem('dev-ops.current-team', teamId)
  }
  return (
    <SessionContext.Provider
      value={{
        user,
        teams,
        currentTeam,
        role: currentTeam?.role ?? 'viewer',
        isPlatformAdmin,
        setCurrentTeam,
        isReady: !teamsQuery.isPending,
      }}
    >
      {children}
    </SessionContext.Provider>
  )
}

/** 读取当前会话与团队；必须在 SessionProvider 内使用。 */
export function useSession() {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession 必须在 SessionProvider 内使用')
  return context
}
