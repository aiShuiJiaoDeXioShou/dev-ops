import { AcceptInvitationForm } from '@/features/identity/public'

/** 接受团队邀请页。 */
export function Component() {
  return (
    <main className="grid min-h-svh place-items-center bg-muted/40 p-6">
      <section className="w-full max-w-md rounded-2xl border bg-card p-7 shadow-sm">
        <div className="mb-6 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">加入团队</h1>
          <p className="text-sm text-muted-foreground">设置姓名和密码后即可进入工作区。</p>
        </div>
        <AcceptInvitationForm />
      </section>
    </main>
  )
}

export default Component
