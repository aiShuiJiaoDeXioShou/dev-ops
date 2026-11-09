import { Activity, ArrowUpRight, Blocks, LayoutDashboard, Menu } from 'lucide-react'
import { NavLink, Outlet, useNavigation } from 'react-router'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { Separator } from '@/shared/ui/controls/separator'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/shared/ui/controls/sheet'
import { cn } from '@/shared/lib/utils'

const navigationItems = [
  { to: '/', label: '工作台', icon: LayoutDashboard },
  { to: '/system/status', label: '系统状态', icon: Activity },
]

/**
 * 渲染桌面与移动端共用的导航项。
 * @param props.closeOnNavigate 是否在选择页面后关闭移动导航抽屉。
 * @returns 带当前页标识的导航；关闭抽屉时恢复触发器焦点。
 */
function Navigation({ closeOnNavigate = false }: { closeOnNavigate?: boolean }) {
  return (
    <nav aria-label="主导航" className="space-y-1 px-3">
      {navigationItems.map(item => {
        const link = (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <item.icon className="size-4" aria-hidden="true" />
            {item.label}
          </NavLink>
        )
        return closeOnNavigate ? <SheetClose key={item.to} asChild>{link}</SheetClose> : link
      })}
    </nav>
  )
}

/**
 * 渲染导航区品牌标识。
 * @returns 静态工作区标识，不代表已登录的团队身份。
 */
function WorkspaceBrand() {
  return (
    <div className="flex items-center gap-3 px-6 py-7">
      <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Blocks className="size-5" aria-hidden="true" />
      </div>
      <div>
        <p className="text-sm font-semibold tracking-tight">项目开发平台</p>
        <p className="mt-0.5 text-xs text-muted-foreground">本地工作区</p>
      </div>
    </div>
  )
}

/**
 * 提供响应式应用布局、键盘跳转入口及嵌套路由出口。
 * @returns 应用外壳；路由加载时播报状态，业务页面保留自身标题。
 */
export function AppLayout() {
  const navigation = useNavigation()

  return (
    <div className="min-h-svh bg-background text-foreground">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-background p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">跳到主要内容</a>
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r bg-card md:flex">
        <WorkspaceBrand />
        <p className="px-6 pb-3 text-xs font-medium tracking-wide text-muted-foreground">工作区</p>
        <Navigation />
        <div className="mt-auto p-5">
          <div className="rounded-xl border bg-muted/40 p-4">
            <p className="text-xs font-medium">基础工作区</p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">业务功能将按需求逐步开放。</p>
          </div>
        </div>
      </aside>
      <div className="md:pl-60">
        <header className="flex h-16 items-center justify-between border-b bg-card px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden" aria-label="打开导航">
                  <Menu className="size-5" aria-hidden="true" />
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
            <span className="text-sm font-medium">工作区</span>
            <Separator orientation="vertical" className="h-4" />
            {import.meta.env.DEV && <Badge variant="secondary">开发环境</Badge>}
          </div>
          <Button variant="ghost" size="sm" asChild>
            <a href="/api/v1/health" target="_blank" rel="noreferrer">
              API 状态 <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </a>
          </Button>
        </header>
        {navigation.state !== 'idle' && (
          <div role="status" className="border-b bg-primary/5 px-6 py-2 text-xs text-primary">页面加载中…</div>
        )}
        <main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl p-5 outline-none sm:p-8 lg:p-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
