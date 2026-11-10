import { AcceptInvitationForm } from '@/features/identity/public'

/** 接受团队邀请页；沿用认证卡片布局。 */
export function Component() {
  return (
    <div className="auth-shell">
      <main className="auth-card">
        <a className="auth-brand" href="/login" aria-label="返回登录">
          <img src="/prototype/brand.svg" width={29} height={29} alt="" />
          DevOps
        </a>
        <h1>接受团队邀请</h1>
        <p className="auth-sub">设置密码并补全资料后即可加入当前团队。</p>
        <AcceptInvitationForm />
      </main>
    </div>
  )
}

export default Component
