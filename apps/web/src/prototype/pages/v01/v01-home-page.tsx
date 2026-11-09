import { Link } from 'react-router'
import { PrototypeIcon } from '@/prototype/icons/icon'
import type { PrototypeIconName } from '@/prototype/icons/icon'
import { usePrototypeMenu } from '@/prototype/layout/prototype-shell'

const entries: Array<{ title: string; description: string; to: string; action: string; icon: PrototypeIconName }> = [
  {
    title: '登录与邀请',
    description: '登录、接受团队邀请、找回密码；验证邮箱邀请开通与账号创建流程。',
    to: '/prototype/auth/login',
    action: '打开登录页',
    icon: 'user',
  },
  {
    title: '团队与权限',
    description: '成员、角色、邀请、停用/恢复与最后管理员保护；浏览者只读。',
    to: '/prototype/team-admin',
    action: '打开团队管理',
    icon: 'users',
  },
  {
    title: '项目工作区',
    description: '不连接仓库也能创建项目；项目列表、状态筛选与项目卡片。',
    to: '/prototype/projects',
    action: '打开项目列表',
    icon: 'folder',
  },
  {
    title: '需求与 Bug',
    description: '两种内容方式、负责人、组合筛选、右侧详情、评论与活动记录。',
    to: '/prototype/project/dev-ops/requirements',
    action: '打开需求列表',
    icon: 'file',
  },
  {
    title: 'Bug 与回归',
    description: '独立建单、修复、提交回归、回归失败/通过、关闭与重开。',
    to: '/prototype/project/dev-ops/bugs',
    action: '打开 Bug 列表',
    icon: 'bug',
  },
  {
    title: '代码关联',
    description: '只读展示 Commit、Issue、PR 引用；远端状态与本地业务状态分开维护。',
    to: '/prototype/project/dev-ops/code',
    action: '打开代码页',
    icon: 'repo',
  },
]

const flow = [
  ['建立团队', '邀请管理员与成员，角色和停用状态生效。'],
  ['创建项目', '不要求先连接仓库，维护负责人和项目状态。'],
  ['编写需求', '选择内置 Markdown 或外部链接，指定负责人和验收标准。'],
  ['开发提测', '满足字段后提交测试；不触发构建或流水线。'],
  ['测试与 Bug', '开始测试、退回开发；独立记录 Bug 与回归结论。'],
  ['测试通过', '关联 Bug 均为已解决或已关闭后记录结论，保留历史。'],
]

/**
 * 渲染 V0.1 原型入口，集中链接认证、团队、项目与研发流程页面。
 * @returns 使用原型样式的内容导航页；所有链接只进入本地演示数据。
 */
export function V01HomePage() {
  const { openMenu } = usePrototypeMenu()
  return (
    <div className="work-padding v01-page">
      <header className="page-head" style={{ padding: 0, border: 0, height: 'auto' }}>
        <div className="row">
          <button type="button" className="icon-btn mobile-menu" aria-label="展开导航" onClick={openMenu}>
            <PrototypeIcon name="menu" />
          </button>
          <div>
            <p className="small quiet" style={{ marginBottom: 6 }}>
              V0.1 · 研发流程试用版
            </p>
            <h1 style={{ fontSize: 25, margin: 0 }}>V0.1 原型</h1>
          </div>
          <span className="spacer" />
          <Link className="btn" to="/prototype/projects">
            进入完整原型
          </Link>
        </div>
      </header>
      <p className="v01-section-note" style={{ marginTop: 14 }}>
        本页只覆盖 V0.1 的团队开通、项目、需求、Bug、代码关联与研发流程。权限、状态机与验收标准以规格为准；
        原型使用本地演示数据，不调用真实 API、数据库、邮件或代码平台。
      </p>

      <div className="v01-grid">
        {entries.map((entry) => (
          <section key={entry.title} className="v01-card">
            <div className="v01-card-head">
              <PrototypeIcon name={entry.icon} />
              <h3>{entry.title}</h3>
            </div>
            <p>{entry.description}</p>
            <Link className="btn" to={entry.to}>
              {entry.action}
            </Link>
          </section>
        ))}
      </div>

      <div className="section-heading" style={{ marginTop: 28 }}>
        <h2>V0.1 主路径</h2>
        <span className="spacer" />
        <span className="small quiet">邀请 → 项目 → 需求 → 提测 → Bug/回归 → 测试通过</span>
      </div>
      <ol className="v01-steps">
        {flow.map(([title, description], index) => (
          <li key={title}>
            <span className="step-no">{index + 1}</span>
            <div>
              <strong>{title}</strong>
              <small>{description}</small>
            </div>
          </li>
        ))}
      </ol>
      <div className="auth-demo" style={{ marginTop: 22 }}>
        <strong>演示边界：</strong>登录、邀请、提测和 Bug
        回归均为本地交互；刷新后部分页面状态可能回到演示种子数据。正式实现按{' '}
        <code>specs/001-v01-rd-workflow/tasks.md</code> 接入认证、数据库、权限与代码平台。
      </div>
    </div>
  )
}
