import { useState } from 'react'
import { NavLink, Outlet } from 'react-router'
import { cn } from '@/shared/lib/utils'

/** 能力中心沿用原型子导航与右侧详情栏。 */
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
        </nav>
        <Outlet context={detailHost} />
      </div>
      <div ref={setDetailHost} className="flex min-h-0 shrink-0" />
    </div>
  )
}

export default Component
