import { NavLink, Outlet } from 'react-router'
import { cn } from '@/shared/lib/utils'

/** 能力中心子导航；顺序与旧 HTML 原型 capabilityNav 一致。 */
const capabilityTabs = [
  { to: 'bots', label: '智能体' },
  { to: 'skills', label: 'Skills' },
  { to: 'templates', label: 'AGENTS.md' },
  { to: 'memory', label: '记忆' },
  { to: 'connections', label: '连接与节点' },
]

/**
 * 渲染能力中心布局：原型 `.capability-nav` 子导航与子路由出口。
 * @returns 团队能力导航；子页各自渲染页面头部与正文。
 * @remarks 导航与子页头部相邻，供 `.capability-nav + .agent-page-header` 等原型间距规则生效。
 */
export function CapabilitiesLayout() {
  return (
    <>
      <nav className="capability-nav" aria-label="团队能力">
        {capabilityTabs.map((tab) => (
          <NavLink key={tab.to} to={tab.to} className={({ isActive }) => cn('capability-tab', isActive && 'active')}>
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  )
}
