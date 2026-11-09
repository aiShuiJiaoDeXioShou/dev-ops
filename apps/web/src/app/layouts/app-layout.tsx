import { Activity, FlaskConical, FolderKanban, LogOut, Menu, Settings, Users } from 'lucide-react'
import { NavLink, Outlet, useNavigate, useNavigation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import { Separator } from '@/shared/ui/controls/separator'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/ui/controls/sheet'
import { cn } from '@/shared/lib/utils'
import { signOut, useSession } from '@/features/identity/public'

const ROLE_LABELS = { admin: '管理员', developer: '开发者', viewer: '浏览者' } as const

/**
 * 渲染桌面与移动端共用的导航项。
 * @param props.closeOnNavigate 选择后是否关闭移动导航抽屉。
 * @returns 当前页面高亮的导航。
 */
function Navigation({ closeOnNavigate = false }: { closeOnNavigate?: boolean }) {
  const { currentTeam, role } = useSession()
  const items = [
    { to: '/projects', label: '项目', icon: FolderKanban },
    ...(!currentTeam || role === 'admin' ? [{ to: '/settings/team', label: '团队管理', icon: Users }] : []),
    { to: '/system/status', label: '系统状态', icon: Activity },
    ...(import.meta.env.DEV ? [{ to: '/prototype/projects', label: '交互原型', icon: FlaskConical }] : []),
  ]
  return (
    <nav aria-label="主导航" className="space-y-1 px-3">
      {items.map((item) => {
        const link = (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            <item.icon className="size-4" aria-hidden="true" />
            {item.label}
          </NavLink>
        )
        return closeOnNavigate ? (
          <SheetClose key={item.to} asChild>
            {link}
          </SheetClose>
        ) : (
          link
        )
      })}
    </nav>
  )
}

/** 工作区品牌与当前团队切换。 */
function WorkspaceBrand() {
  return (
    <div className="flex items-center gap-3 px-6 py-7">
      <img src="/prototype/brand.svg" width={32} height={32} alt="" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold tracking-tight">项目开发平台</p>
        <p className="mt-0.5 text-xs text-muted-foreground">研发协作工作区</p>
      </div>
    </div>
  )
}

/** 渲染受保护的应用外壳、团队切换与导航。 */
export function AppLayout() {
  const navigation = useNavigation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user, teams, currentTeam, role, setCurrentTeam } = useSession()
  const logout = async () => {
    await signOut().catch(() => undefined)
    queryClient.clear()
    navigate('/login', { replace: true })
  }
  return (
    <div className="min-h-svh bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        跳到主要内容
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-card md:flex">
        <WorkspaceBrand />
        <Navigation />
        <div className="mt-auto space-y-3 p-5">
          {teams.length > 1 ? (
            <Select
              aria-label="切换团队"
              value={currentTeam?.id ?? ''}
              onChange={(event) => setCurrentTeam(event.target.value)}
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </Select>
          ) : (
            <p className="text-xs text-muted-foreground">{currentTeam?.name ?? '未加入团队'}</p>
          )}
          <div className="rounded-xl border bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <Badge variant="outline">{ROLE_LABELS[role]}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{user.email}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 w-full justify-start"
              onClick={() => void logout()}
            >
              <LogOut className="size-4" />
              退出登录
            </Button>
          </div>
        </div>
      </aside>
      <div className="md:pl-60">
        <header className="flex h-16 items-center justify-between border-b bg-card px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="打开导航">
                  <Menu className="size-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>工作区导航</SheetTitle>
                  <SheetDescription>选择需要访问的页面。</SheetDescription>
                </SheetHeader>
                <WorkspaceBrand />
                <Navigation closeOnNavigate />
              </SheetContent>
            </Sheet>
            <span className="text-sm font-medium">{currentTeam?.name ?? '工作区'}</span>
            <Separator orientation="vertical" className="h-4" />
            {import.meta.env.DEV && <Badge variant="secondary">开发环境</Badge>}
          </div>
          <div className="flex items-center gap-2">
            {(!currentTeam || role === 'admin') && (
              <Button variant="ghost" size="sm" asChild>
                <a href="/settings/team">
                  <Settings className="size-4" />
                  团队设置
                </a>
              </Button>
            )}
          </div>
        </header>
        {navigation.state !== 'idle' && (
          <div role="status" className="border-b bg-primary/5 px-6 py-2 text-xs text-primary">
            页面加载中…
          </div>
        )}
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl p-5 outline-none sm:p-8 lg:p-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
