import type { ReactNode } from 'react'
import { Link } from 'react-router'

/** 能力模块页头：标题与“技能库 / AGENTS.md 模板”下划线页签，对齐原型。 */
export function CapabilitiesHeader({ active, action }: { active: 'skills' | 'templates'; action?: ReactNode }) {
  return (
    <header className="page-head skills-header">
      <nav className="tabs" aria-label="能力内容">
        <Link to="/capabilities/skills" className="tab" role="tab" aria-selected={active === 'skills'}>
          技能库
        </Link>
        <Link to="/capabilities/templates" className="tab" role="tab" aria-selected={active === 'templates'}>
          AGENTS.md 模板
        </Link>
      </nav>
      {action ? <div className="row">{action}</div> : null}
      <h1 className="sr-only">Skills</h1>
    </header>
  )
}
