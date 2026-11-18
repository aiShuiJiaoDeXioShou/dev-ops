import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { cn } from '@/shared/lib/utils'

/**
 * 渲染智能体、Skills 与记忆的能力中心导航和右侧详情宿主。
 * @returns 能力页面布局；子路由通过 Outlet 上下文使用详情宿主。
 */
export function Component() {
  const [detailHost, setDetailHost] = useState<HTMLDivElement | null>(null)
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <nav className="capability-nav" aria-label="团队能力">
          <NavLink to="bots" className={({ isActive }) => cn('capability-tab', isActive && 'active')}>
            智能体
          </NavLink>
          <NavLink to="skills" className={({ isActive }) => cn('capability-tab', isActive && 'active')}>
            Skills
          </NavLink>
          <NavLink to="memory" className={({ isActive }) => cn('capability-tab', isActive && 'active')}>
            记忆
          </NavLink>
        </nav>
        <Outlet context={detailHost} />
      </div>
      <div ref={setDetailHost} className="flex min-h-0 shrink-0" />
    </div>
  )
}

export default Component
