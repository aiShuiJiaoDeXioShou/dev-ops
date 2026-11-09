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
