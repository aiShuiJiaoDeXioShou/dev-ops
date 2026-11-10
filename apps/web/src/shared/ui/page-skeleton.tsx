import { DelayedLoading } from './delayed-loading'

/**
 * 首屏会话/团队加载时保持与工作区一致的外壳，避免全屏加载态与最终布局错位。
 * @returns 侧栏与主内容骨架屏。
 */
export function AppShellSkeleton() {
  return (
    <div className="shell" role="status" aria-label="页面加载中">
      <aside className="sidebar">
        <div className="skeleton-brand">
          <span className="skeleton-block skeleton-mark" />
          <span className="skeleton-line skeleton-brand-text" />
        </div>
        <div className="skeleton-nav">
          {[0, 1, 2].map((item) => (
            <div key={item} className="skeleton-line skeleton-nav-item" />
          ))}
        </div>
        <div className="side-bottom">
          <div className="skeleton-user">
            <span className="skeleton-block skeleton-avatar" />
            <span className="skeleton-line skeleton-user-name" />
          </div>
        </div>
      </aside>
      <div className="surface">
        <main className="main">
          <PageSkeleton />
        </main>
      </div>
    </div>
  )
}

/**
 * 页面内容加载骨架；用于会话已就绪后的懒加载路由和页面级查询。
 * @returns 与 page-head/卡片区域一致的占位内容。
 */
export function PageSkeleton() {
  return (
    <div className="catalog" role="status" aria-label="页面加载中">
      <div className="skeleton-page-head">
        <span className="skeleton-line skeleton-title" />
        <span className="skeleton-line skeleton-subtitle" />
      </div>
      <div className="skeleton-grid">
        {[0, 1, 2].map((item) => (
          <div key={item} className="skeleton-block skeleton-card">
            <span className="skeleton-line skeleton-card-title" />
            <span className="skeleton-line skeleton-card-line" />
            <span className="skeleton-line skeleton-card-line short" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * 应用启动/会话加载阶段使用的延迟外壳骨架。
 * 加载快于延迟时不渲染骨架，避免首屏一闪而过的闪烁；慢加载仍有明确占位。
 * @returns 延迟后展示的外壳骨架。
 */
export function DelayedAppShellSkeleton() {
  return (
    <DelayedLoading pending>
      <AppShellSkeleton />
    </DelayedLoading>
  )
}

/**
 * 页面数据加载阶段使用的延迟页面骨架。
 * @returns 延迟后展示的页面骨架。
 */
export function DelayedPageSkeleton() {
  return (
    <DelayedLoading pending>
      <PageSkeleton />
    </DelayedLoading>
  )
}
