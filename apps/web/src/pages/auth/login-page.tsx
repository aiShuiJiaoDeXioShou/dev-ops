import { LoginForm } from '@/features/identity/public'

/** 登录页；未登录用户由 RequireAuth 跳转至此。 */
export function Component() {
  return (
    <main className="grid min-h-svh place-items-center bg-muted/40 p-6">
      <section className="w-full max-w-sm rounded-2xl border bg-card p-7 shadow-sm">
        <div className="mb-6 space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground">DEV OPS</p>
          <h1 className="text-2xl font-semibold tracking-tight">登录工作区</h1>
          <p className="text-sm text-muted-foreground">使用平台邮箱密码登录。</p>
        </div>
        <LoginForm />
      </section>
    </main>
  )
}

export default Component
