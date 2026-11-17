import { NavLink, Outlet } from 'react-router'
import { cn } from '@/shared/lib/utils'

/** 保持能力页的组内导航，正文仍由技能和 Bot 各自的页面负责。 */
export function Component() {
  return (
    <>
      <nav className="flex flex-wrap gap-2 border-b border-border px-4 py-2 sm:px-6" aria-label="能力导航">
        <NavLink to="skills" className={({ isActive }) => cn('btn quiet', isActive && 'text-primary')}>
          技能库
        </NavLink>
        <NavLink to="bots" className={({ isActive }) => cn('btn quiet', isActive && 'text-primary')}>
          智能体
        </NavLink>
      </nav>
      <Outlet />
    </>
  )
}

export default Component
