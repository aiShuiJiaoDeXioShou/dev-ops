import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Folder, LayoutGrid, LogOut, Menu, PanelLeft, Settings2, Shield, Users, X as XIcon } from 'lucide-react'
import { isCollaborationPath } from '@/app/router/collaboration-path'
import { CollaborationPageSkeleton } from '@/pages/collaboration/conversation-loading'
import { cn } from '@/shared/lib/utils'
import { signOut } from '@/features/identity/api/auth-client'
import { useSession } from '@/features/identity/model/session'
import { UserAvatar } from '@/shared/ui/user-avatar'
import { CollaborationNavIcon } from '@/shared/ui/collaboration-nav-icon'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { Button } from '@/shared/ui/controls/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/controls/alert-dialog'
import './app-layout.css'

const ROLE_LABELS = { admin: '管理员', developer: '开发者', viewer: '浏览者' } as const

/**
 * 渲染支持收纳的工作区主导航、团队切换、用户入口和业务页面。
 * @returns 已认证工作区；随路由更新文档标题，退出登录后清理缓存并跳转登录页。
 */
export function AppLayout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, teams, currentTeam, role, setCurrentTeam, isReady, isPlatformAdmin } = useSession()
  const [menuOpen, setMenuOpen] = useState(false)
  const [navigationCollapsed, setNavigationCollapsed] = useState(false)
  const location = useLocation()
  useEffect(() => {
    // 页面标题用于浏览器多标签、历史记录与读屏识别；无法匹配时回退到产品名。
    const titles: Array<[string, string]> = [
      ['/collaboration', '协作'],
      ['/projects/', '项目工作区'],
      ['/projects', '项目'],
      ['/capabilities/skills', '团队 Skills'],
      ['/capabilities/bots', '智能体'],
      ['/capabilities/memory', '记忆'],
      ['/capabilities', '能力'],
      ['/vault', '凭据库'],
      ['/settings/pipeline-nodes', '执行节点'],
      ['/settings/team', '团队管理'],
      ['/settings/profile', '个人页面'],
      ['/system/status', '系统状态'],
    ]
    if (isPlatformAdmin) titles.push(['/platform', '平台管理'])
    const matched = titles.find(([path]) => location.pathname === path || location.pathname.startsWith(path + '/'))
    document.title = matched ? `${matched[1]} · DevOps` : 'DevOps 项目开发平台'
  }, [isPlatformAdmin, location.pathname])
  const menuButtonRef = useRef<HTMLElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const isCollaboration = isCollaborationPath(location.pathname)
  const isLoadingCollaboration = isCollaboration && !isReady
  const openNavigation = (opener: HTMLElement | null) => {
    menuButtonRef.current = opener
    setMenuOpen(true)
  }
  useEffect(() => {
    const sidebar = sidebarRef.current
    if (!menuOpen || !sidebar) return
    // 打开抽屉后把焦点移入第一个可操作项，并把 Tab 限制在抽屉内；Esc/关闭时归还触发按钮。
    const focusables = sidebar.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    focusables[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButtonRef.current?.focus()
        return
      }
      if (event.key !== 'Tab') return
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
    // 只处理导航内的按键，让通过 Portal 打开的确认弹窗独立管理焦点。
    sidebar.addEventListener('keydown', onKeyDown)
    return () => sidebar.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])
  const logout = async () => {
    await signOut().catch(() => undefined)
    queryClient.clear()
    navigate('/login', { replace: true })
  }
  const navIcons = {
    collaboration: CollaborationNavIcon,
    folder: Folder,
    capabilities: LayoutGrid,
    shield: Shield,
  } as const
  const primaryNavItems = [
    { to: '/collaboration', label: '协作', icon: 'collaboration' as const },
    { to: '/projects', label: '项目', icon: 'folder' as const },
    { to: '/capabilities', label: '能力', icon: 'capabilities' as const },
    ...(role !== 'viewer' ? [{ to: '/vault', label: '凭据库', icon: 'shield' as const }] : []),
  ]
  return (
    <div className={cn('shell workspace-shell', menuOpen && 'menu-open', navigationCollapsed && 'is-nav-collapsed')}>
      {menuOpen ? <div className="nav-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" /> : null}
      <aside
        ref={sidebarRef}
        id="workspace-navigation"
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
        <div className="workspace-sidebar-head">
          <Link className="brand" to="/collaboration" aria-label="协作首页">
            <img src="/prototype/brand.svg" width={29} height={29} alt="" />
            DevOps
          </Link>
          <Button
            unstyled
            type="button"
            className="workspace-sidebar-toggle"
            aria-label={navigationCollapsed ? '展开主导航' : '收起主导航'}
            title={navigationCollapsed ? '展开主导航' : '收起主导航'}
            aria-expanded={!navigationCollapsed}
            aria-controls="workspace-navigation"
            onClick={() => setNavigationCollapsed(!navigationCollapsed)}
          >
            <PanelLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </div>
        <div className="nav-label">工作台</div>
        <nav className="nav" aria-label="主导航">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              aria-label={item.label}
              title={item.label}
              data-page={item.icon === 'collaboration' ? 'collaboration' : undefined}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => cn('nav-btn', isActive && 'active')}
            >
              {(() => {
                const Icon = navIcons[item.icon]
                return <Icon className="size-4.5" aria-hidden="true" />
              })()}
              <span className="workspace-nav-label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="side-bottom">
          <div className="nav-label">管理与设置</div>
          {isPlatformAdmin && (
            <NavLink
              to="/platform"
              aria-label="平台管理"
              title="平台管理"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => cn('nav-btn', isActive && 'active')}
            >
              <Settings2 className="size-4.5" aria-hidden="true" />
              <span className="workspace-nav-label">平台管理</span>
            </NavLink>
          )}
          {(!currentTeam || role === 'admin') && (
            <NavLink
              to="/settings/team"
              aria-label="团队管理"
              title="团队管理"
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) => cn('nav-btn', isActive && 'active')}
            >
              <Users className="size-4.5" aria-hidden="true" />
              <span className="workspace-nav-label">团队管理</span>
            </NavLink>
          )}
          <Link
            className="user"
            title={user.name}
            to="/settings/profile"
            aria-label={`打开${user.name}的个人页面`}
            onClick={() => setMenuOpen(false)}
          >
            <span className="avatar-slot">
              <UserAvatar name={user.name} image={user.image} className="size-6 border bg-background text-xs" />
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
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="nav-btn logout-btn"
                aria-label="退出登录"
                title="退出登录"
              >
                <LogOut className="size-4.5" aria-hidden="true" />
                <span className="workspace-nav-label">退出登录</span>
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>退出登录</AlertDialogTitle>
                <AlertDialogDescription>退出后，你需要重新登录才能访问工作区。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => void logout()}>确认退出</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
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
          {!isLoadingCollaboration && (!isCollaboration || !currentTeam) && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="icon-btn mobile-menu"
              aria-label="打开导航"
              onClick={(event) => openNavigation(event.currentTarget)}
            >
              <Menu className="size-5" aria-hidden="true" />
            </Button>
          )}
          {isReady ? (
            <Outlet context={openNavigation} />
          ) : isLoadingCollaboration ? (
            <CollaborationPageSkeleton
              mobileNavigation={
                <Button
                  unstyled
                  type="button"
                  className="dsh-icon-btn dsh-room-toggle"
                  aria-label="打开导航"
                  onClick={(event) => openNavigation(event.currentTarget)}
                >
                  <Menu className="size-5" aria-hidden="true" />
                </Button>
              }
            />
          ) : (
            <DelayedPageSkeleton />
          )}
          <div id="workspace-detail-host" />
        </main>
      </div>
    </div>
  )
}
