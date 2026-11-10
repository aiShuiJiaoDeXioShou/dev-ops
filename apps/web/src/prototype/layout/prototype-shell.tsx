import { createContext, useContext, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { cn } from '@/shared/lib/utils'
import { PrototypeDialog } from '@/prototype/components/prototype-dialog'
import { PrototypeIcon } from '@/prototype/icons/icon'
import type { PrototypeIconName } from '@/prototype/icons/icon'
import { usePrototype } from '@/prototype/data/store'
import type { TeamRole } from '@/prototype/data/types'

const primaryNavigation: Array<{ page: string; label: string; icon: PrototypeIconName; to: string }> = [
  { page: 'projects', label: '项目', icon: 'folder', to: '/prototype/projects' },
  { page: 'collaboration', label: '协作', icon: 'bot-live', to: '/prototype/collaboration' },
  { page: 'operations', label: '运维', icon: 'activity', to: '/prototype/operations' },
  { page: 'capabilities', label: '能力', icon: 'capabilities', to: '/prototype/capabilities/bots' },
  { page: 'vault', label: '凭据库', icon: 'lock', to: '/prototype/vault' },
]

const PrototypeMenuContext = createContext<{ openMenu: () => void } | null>(null)

/**
 * 读取原型移动导航控制权，供页面头部的菜单按钮使用。
 * @returns 打开移动端侧栏的函数。
 * @throws 在 PrototypeShell 之外调用时抛出。
 */
export function usePrototypeMenu() {
  const context = useContext(PrototypeMenuContext)
  if (!context) throw new Error('usePrototypeMenu 必须在 PrototypeShell 内使用')
  return context
}

/**
 * 渲染原型应用外壳：侧栏、团队切换、设置与移动端导航。
 * @returns 与 HTML 原型一致的 shell 布局；页面内容由子路由提供。
 * @remarks 侧栏顺序、底部团队信息与设置入口对齐原型，不额外插入通知入口。
 */
export function PrototypeShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const { data, currentTeam, currentRole, setCurrentTeam, persistenceWarning } = usePrototype()
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    document.body.classList.add('prototype-root')
    return () => document.body.classList.remove('prototype-root')
  }, [])

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  const isActive = (to: string) => {
    if (to === '/prototype/projects')
      return location.pathname === to || location.pathname.startsWith('/prototype/project/')
    if (to === '/prototype/capabilities/bots') return location.pathname.startsWith('/prototype/capabilities')
    return location.pathname === to || location.pathname.startsWith(`${to}/`)
  }

  return (
    <PrototypeMenuContext.Provider value={{ openMenu: () => setMenuOpen(true) }}>
      <div className={cn('shell', menuOpen && 'menu-open')}>
        <aside className="sidebar">
          <div className="brand">
            <img src="/prototype/brand.svg" width={29} height={29} alt="" />
            DevOps
          </div>
          <nav className="nav" aria-label="主导航">
            {primaryNavigation.map((item) => (
              <button
                key={item.page}
                type="button"
                className={cn('nav-btn', isActive(item.to) && 'active')}
                onClick={() => navigate(item.to)}
              >
                <PrototypeIcon name={item.icon} className={item.icon === 'bot-live' ? 'nav-bot' : undefined} />
                {item.label}
              </button>
            ))}
          </nav>
          <div className="side-bottom">
            <div className="demo-mark">
              <span className="dot" />
              交互原型 · 本地演示
            </div>
            {currentRole === '管理员' && (
              <button type="button" className="nav-btn" onClick={() => navigate('/prototype/team-admin')}>
                <PrototypeIcon name="users" />
                团队管理
              </button>
            )}
            <button type="button" className="nav-btn" onClick={() => setSettingsOpen(true)}>
              <PrototypeIcon name="settings" />
              设置
            </button>
            <div className="user">
              <span className="avatar">林</span>
              <span>林然</span>
              <span className="spacer" />
              <span className="badge">{currentRole}</span>
            </div>
            {data.teams.length > 1 && (
              <div className="team-switcher" aria-label="切换团队">
                {data.teams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    className={cn('team-token', team.id === currentTeam.id && 'active')}
                    aria-label={`切换到${team.name}`}
                    aria-pressed={team.id === currentTeam.id}
                    title={team.name}
                    onClick={() => setCurrentTeam(team.id)}
                  >
                    <span>{team.initial}</span>
                  </button>
                ))}
                <button type="button" className="team-more" aria-label="团队选项" onClick={() => setSettingsOpen(true)}>
                  ···
                </button>
              </div>
            )}
          </div>
        </aside>

        <div className="surface">
          <main className="main">
            {persistenceWarning && <div className="notice">{persistenceWarning}</div>}
            <Outlet />
          </main>
          <div id="prototype-detail-host" />
        </div>

        <PrototypeSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      </div>
    </PrototypeMenuContext.Provider>
  )
}

/**
 * 渲染原型设置对话框：演示角色、团队切换与重置数据。
 * @param props.open 打开状态；props.onClose 关闭回调。
 * @returns 与原型 dialog 样式一致的原生对话框。
 */
function PrototypeSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, currentTeam, currentRole, setCurrentRole, setCurrentTeam, resetData } = usePrototype()
  return (
    <PrototypeDialog open={open} title="原型设置" onClose={onClose}>
      <div className="info-box">此处只影响演示页面。真实服务端仍需独立校验身份、资源归属与权限。</div>
      <div className="settings-row">
        <div>
          <strong>演示角色</strong>
          <p>浏览者只能查看，不修改业务记录。</p>
        </div>
        <select
          aria-label="演示角色"
          value={currentRole}
          onChange={(event) => setCurrentRole(event.target.value as TeamRole)}
        >
          <option value="管理员">管理员</option>
          <option value="开发者">开发者</option>
          <option value="浏览者">浏览者</option>
        </select>
      </div>
      <div className="settings-row">
        <div>
          <strong>当前团队</strong>
          <p>切换后项目、事项和会话保持团队隔离。</p>
        </div>
        <select aria-label="切换团队" value={currentTeam.id} onChange={(event) => setCurrentTeam(event.target.value)}>
          {data.teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-row">
        <div>
          <strong>重置演示数据</strong>
          <p>只清除本原型创建的团队、项目与事项记录。</p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            resetData()
            onClose()
          }}
        >
          重置
        </button>
      </div>
      <div className="form-actions">
        <button type="button" className="btn primary" onClick={onClose}>
          完成
        </button>
      </div>
    </PrototypeDialog>
  )
}
