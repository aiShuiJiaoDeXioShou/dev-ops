import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, Box, Folder, LayoutGrid, LogOut, Menu, Shield, Users, X as XIcon } from 'lucide-react'
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
  const { user, teams, currentTeam, role, setCurrentTeam, isReady, isPlatformAdmin } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const location = useLocation()
  useEffect(() => {
    // 页面标题用于浏览器多标签、历史记录与读屏识别；无法匹配时回退到产品名。
    const titles: Array<[string, string]> = [
      ['/projects/', '项目工作区'],
      ['/projects', '项目'],
      ['/operations/changes', '变更与发布'],
      ['/capabilities/templates', 'AGENTS.md 模板'],
      ['/capabilities/skills', '团队 Skills'],
      ['/capabilities', '能力'],
      ['/vault', '凭据库'],
      ['/settings/pipeline-nodes', '执行节点'],
      ['/settings/storage-buckets', '储存桶'],
      ['/settings/team', '团队管理'],
      ['/settings/profile', '个人页面'],
      ['/system/status', '系统状态'],
    ]
    const matched = titles.find(([path]) => location.pathname === path || location.pathname.startsWith(path + '/'))
    document.title = matched ? `${matched[1]} · DevOps` : 'DevOps 项目开发平台'
  }, [location.pathname])
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    // 打开抽屉后把焦点移入第一个可操作项，并把 Tab 限制在抽屉内；Esc/关闭时归还触发按钮。
    const focusables = sidebarRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    focusables?.[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
        return
      }
      if (event.key !== 'Tab' || !focusables || focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
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
  const navIcons = { folder: Folder, activity: Activity, capabilities: LayoutGrid, shield: Shield } as const
  const primaryNavItems = [
    { to: '/projects', label: '项目', icon: 'folder' as const },
    { to: '/operations/changes', label: '运维', icon: 'activity' as const },
    { to: '/capabilities', label: '能力', icon: 'capabilities' as const },
    ...(role !== 'viewer' ? [{ to: '/vault', label: '凭据库', icon: 'shield' as const }] : []),
  ]
  return (
    <div className={cn('shell', menuOpen && 'menu-open')}>
      {menuOpen ? <div className="nav-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" /> : null}
      <aside
        ref={sidebarRef}
        className="sidebar"
        {...(menuOpen ? { role: 'dialog', 'aria-modal': true, 'aria-label': '工作区导航' } : {})}
      >
        {menuOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="sidebar-close"
            aria-label="关闭导航"
            onClick={() => {
              setMenuOpen(false)
              menuButtonRef.current?.focus()
            }}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        <Link className="brand" to="/projects" aria-label="项目列表">
          <img src="/prototype/brand.svg" width={29} height={29} alt="" />
          DevOps
        </Link>
        <div className="nav-label">工作台</div>
        <nav className="nav" aria-label="主导航">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => cn('nav-btn', isActive && 'active')}
            >
              {(() => {
                const Icon = navIcons[item.icon]
                return <Icon className="size-4.5" aria-hidden="true" />
              })()}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="nav-label">管理与设置</div>
          {isPlatformAdmin && (
            <NavLink
              to="/settings/storage-buckets"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => cn('nav-btn', isActive && 'active')}
            >
              <Box className="size-4.5" aria-hidden="true" />
              储存桶
            </NavLink>
          )}
          {(!currentTeam || role === 'admin') && (
            <NavLink
              to="/settings/team"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => cn('nav-btn', isActive && 'active')}
            >
              <Users className="size-4.5" aria-hidden="true" />
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
          <Button type="button" variant="ghost" className="nav-btn logout-btn" onClick={() => setLogoutOpen(true)}>
            <LogOut className="size-4.5" aria-hidden="true" />
            退出登录
          </Button>
          {teams.length > 1 && (
            <div className="team-switcher" aria-label="切换团队">
              {teams.map((team) => (
                <Button
                  key={team.id}
                  type="button"
                  variant="ghost"
                  className={cn('team-token', team.id === currentTeam?.id && 'active')}
                  title={team.name}
                  aria-label={`切换到${team.name}`}
                  aria-pressed={team.id === currentTeam?.id}
                  onClick={() => setCurrentTeam(team.id)}
                >
                  <span>{team.name.slice(0, 1)}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      </aside>
      <div className="surface">
        <main className="main">
          <Button
            ref={menuButtonRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            className="icon-btn mobile-menu"
            aria-label="打开导航"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>
          {isReady ? <Outlet /> : <DelayedPageSkeleton />}
          <div id="workspace-detail-host" />
        </main>
      </div>
      <Dialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <DialogContent className="dialog-w-sm">
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
