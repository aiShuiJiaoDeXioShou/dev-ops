import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { cn } from '@/shared/lib/utils'
import { signOut, useSession } from '@/features/identity/public'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'

const ROLE_LABELS = { admin: '管理员', developer: '开发者', viewer: '浏览者' } as const

/** 渲染工作区外壳：侧栏、团队切换、用户与导航。 */
export function AppLayout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, teams, currentTeam, role, setCurrentTeam, isReady } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      menuButtonRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])
  const logout = async () => {
    setLogoutOpen(false)
    await signOut().catch(() => undefined)
    queryClient.clear()
    navigate('/login', { replace: true })
  }
  const primaryNavItems = [
    { to: '/projects', label: '项目', icon: 'folder' as const },
    { to: '/system/status', label: '运维', accessibleLabel: '系统状态', icon: 'activity' as const },
    { to: '/capabilities', label: '能力', icon: 'capabilities' as const },
    ...(role !== 'viewer' ? [{ to: '/vault', label: '凭据库', icon: 'shield' as const }] : []),
  ]
  return (
    <div className={cn('shell', menuOpen && 'menu-open')}>
      <aside
        className="sidebar"
        {...(menuOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': '工作区导航' } : {})}
      >
        <Link className="brand" to="/projects" aria-label="项目列表">
          <img src="/prototype/brand.svg" width={29} height={29} alt="" />
          DevOps
        </Link>
        <nav className="nav" aria-label="主导航">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={item.accessibleLabel}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => cn('nav-btn', isActive && 'active')}
            >
              <PrototypeIcon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-bottom">
          {(!currentTeam || role === 'admin') && (
            <NavLink
              to="/settings/team"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => cn('nav-btn', isActive && 'active')}
            >
              <PrototypeIcon name="users" />
              团队管理
            </NavLink>
          )}
          <Link
            className="user"
            to="/settings/profile"
            aria-label={`打开${user.name}的个人页面`}
            onClick={() => setMenuOpen(false)}
          >
            <span className="avatar-slot">
              <span className="avatar">{user.name.slice(0, 1)}</span>
            </span>
            <span className="user-copy">
              <span className="user-name">{user.name}</span>
              <span className="user-team">
                <span className={cn('dot', currentTeam && 'green')} />
                {currentTeam?.name ?? '未加入团队'}
              </span>
            </span>
            <span className="badge">{ROLE_LABELS[role]}</span>
          </Link>
          <button type="button" className="nav-btn logout-btn" onClick={() => setLogoutOpen(true)}>
            <PrototypeIcon name="logout" />
            退出登录
          </button>
          {teams.length > 1 && (
            <div className="team-switcher" aria-label="切换团队">
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  className={cn('team-token', team.id === currentTeam?.id && 'active')}
                  title={team.name}
                  aria-label={`切换到${team.name}`}
                  aria-pressed={team.id === currentTeam?.id}
                  onClick={() => setCurrentTeam(team.id)}
                >
                  <span>{team.name.slice(0, 1)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>
      <div className="surface">
        <main className="main">
          <button
            ref={menuButtonRef}
            type="button"
            className="icon-btn mobile-menu"
            aria-label="打开导航"
            onClick={() => setMenuOpen(true)}
          >
            <PrototypeIcon name="menu" />
          </button>
          {isReady ? <Outlet /> : <DelayedPageSkeleton />}
          <div id="workspace-detail-host" />
        </main>
      </div>
      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader className="items-center gap-3 pr-0 text-center">
            <DialogTitle className="text-xl">退出登录</DialogTitle>
            <DialogDescription className="max-w-sm text-sm leading-6">
              退出后需要重新登录，才能继续访问当前团队的项目、需求与 Bug。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3 pt-2 sm:justify-center">
            <Button type="button" variant="outline" className="h-10 min-w-28 px-5" onClick={() => setLogoutOpen(false)}>
              取消
            </Button>
            <Button type="button" className="h-10 min-w-28 px-5" onClick={() => void logout()}>
              确认退出
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
