import { Link, Outlet, useLocation } from 'react-router'
import { cn } from '@/shared/lib/utils'

const tabs = [
  { to: '/capabilities/skills', label: '技能库' },
  { to: '/capabilities/templates', label: 'AGENTS.md 模板' },
]

/** 能力模块外壳：页签导航与内容出口；快照页不显示页签。 */
export function Component() {
  const location = useLocation()
  const isSnapshot = location.pathname.startsWith('/capabilities/snapshots/')
  return (
    <>
      <header className="page-head">
        <h1 className="text-xl font-semibold">能力</h1>
        {!isSnapshot && (
          <nav className="tabs" aria-label="能力内容">
            {tabs.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className={cn('tab', location.pathname.startsWith(tab.to) && 'active')}
                aria-current={location.pathname.startsWith(tab.to) ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <div className="content">
        <Outlet />
      </div>
    </>
  )
}

export default Component
