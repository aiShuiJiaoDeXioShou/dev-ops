import { ApiTokenSection, useSession } from '@/features/identity/public'

/** 个人页面：账号信息与 API Token 管理。 */
export function Component() {
  const { user, currentTeam } = useSession()
  return (
    <div className="catalog min-w-0 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">个人页面</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理账号信息与供 CLI/自动化使用的 API Token。</p>
      </div>

      <section className="min-w-0 space-y-4" aria-labelledby="account-title">
        <h2 id="account-title" className="text-lg font-semibold">
          账号
        </h2>
        <div className="rounded-xl border bg-card p-5">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">姓名</dt>
              <dd className="mt-1 text-sm font-medium">{user.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">邮箱</dt>
              <dd className="mt-1 text-sm font-medium">{user.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">当前团队</dt>
              <dd className="mt-1 text-sm font-medium">{currentTeam?.name ?? '未加入团队'}</dd>
            </div>
          </dl>
        </div>
      </section>

      <ApiTokenSection />
    </div>
  )
}

export default Component
