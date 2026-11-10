import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { PrototypeIcon } from '@/prototype/icons/icon'

/**
 * 渲染 V0.1 认证页的居中外壳。
 * @param props.title 标题；props.subtitle 说明；props.children 表单；props.footer 底部链接。
 * @returns 与原型 tokens 一致的认证卡片。
 */
function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="auth-shell">
      <main className="auth-card">
        <Link className="auth-brand" to="/prototype/v01" aria-label="返回 V0.1 原型入口">
          <img src="/prototype/brand.svg" width={29} height={29} alt="" />
          DevOps
        </Link>
        <h1>{title}</h1>
        <p className="auth-sub">{subtitle}</p>
        {children}
        {footer && <p className="auth-footer">{footer}</p>}
      </main>
    </div>
  )
}

const loginBots = [
  { name: '项目助手', mark: 'orbit' },
  { name: '小林', mark: 'prism' },
  { name: '小渡', mark: 'signal' },
]

/**
 * 渲染 V0.1 登录原型页：左侧 Bot 项目协作现场，右侧邮箱登录。
 * @returns 与 OpenBot 官网一致的深色画布、胶囊控件和大圆角卡片；提交后进入原型项目列表。
 * @remarks 项目、Bot 与消息均为本地演示数据，不调用真实服务。
 */
export function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('lin@example.test')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError('请输入邮箱和密码。')
      return
    }
    setError('')
    navigate('/prototype/projects')
  }

  return (
    <div className="login-shell">
      <section className="login-stage" aria-label="DevOps 项目与 Bot 协作">
        <div className="login-topline">
          <Link className="login-brand" to="/prototype/v01" aria-label="返回 V0.1 原型入口">
            <img src="/prototype/brand.svg" width={29} height={29} alt="" />
            DevOps
          </Link>
          <span className="login-version">V0.1 · 研发协作</span>
        </div>

        <div className="login-copy">
          <h2>
            团队协作更高效，
            <br />
            项目管理更清晰。
          </h2>
          <div className="login-bot-note">
            <span className="login-bot-badge">
              <img src="/prototype/bots/bot-orbit-live.svg" alt="" />
              Bot 自动协作
            </span>
            <p>Bot 自动跟进需求、任务与回归，让团队专注真正的交付。</p>
          </div>
        </div>

        <article className="login-collab" aria-label="研发协作平台项目">
          <div className="login-collab-head">
            <span className="login-collab-icon"><PrototypeIcon name="folder" /></span>
            <span className="login-collab-name">
              <strong>研发协作平台</strong>
              <small>GitHub · team/dev-ops</small>
            </span>
            <span className="login-collab-status"><span className="dot green" />进行中</span>
            <span className="login-collab-avatars" aria-label="项目中的 Bot">
              {loginBots.map((bot) => <img key={bot.name} src={`/prototype/bots/bot-${bot.mark}-live.svg`} alt={bot.name} />)}
            </span>
          </div>

          <div className="login-collab-messages">
            <div className="login-message">
              <img src="/prototype/bots/bot-orbit-live.svg" alt="" />
              <div><strong>项目助手</strong><time>09:42</time><p>PRD-024 已提测，测试负责人：陈悦，验收范围已记录。</p></div>
            </div>
            <div className="login-message">
              <img src="/prototype/bots/bot-prism-live.svg" alt="" />
              <div><strong>小林</strong><time>09:48</time><p>已读取仓库并关联 PR #45，等待回归验证。</p></div>
            </div>
            <div className="login-message">
              <img src="/prototype/bots/bot-signal-live.svg" alt="" />
              <div><strong>小渡</strong><time>10:07</time><p>BUG-018 回归失败原因已记录，已回到修复中。</p></div>
            </div>
          </div>

          <div className="login-task">
            <PrototypeIcon name="file" />
            <span>待测试 · PRD-024 统一接口错误处理</span>
            <span className="login-task-chip">陈悦</span>
          </div>
        </article>

        <ul className="login-principles" aria-label="DevOps 核心能力">
          <li><span className="dot" />团队协作</li>
          <li><span className="dot" />项目管理</li>
          <li><span className="dot" />Bot 自动化</li>
        </ul>
      </section>

      <main className="login-side">
        <div className="login-card">
          <div className="login-card-brand">
            <img src="/prototype/brand.svg" width={25} height={25} alt="" />
            DevOps <span>研发工作台</span>
          </div>
          <h1>登录研发工作台</h1>
          <p className="auth-sub">使用受邀邮箱登录，进入团队项目与 Bot 协作现场。</p>
          <form className="auth-form login-form" onSubmit={submit}>
            <label className="field">
              邮箱
              <input
                type="email"
                value={email}
                autoComplete="email"
                placeholder="name@company.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              密码
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                placeholder="输入密码"
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <div className="auth-row">
              <span>演示环境不发送真实请求</span>
              <Link to="/prototype/auth/forgot-password">忘记密码？</Link>
            </div>
            {error && <p className="field-error" role="alert">{error}</p>}
            <button type="submit" className="login-submit">登录</button>
          </form>
          <p className="login-invite">
            还没有账号？<Link to="/prototype/auth/accept-invitation">通过团队邀请加入</Link>
          </p>
          <p className="login-trust">V0.1 原型 · 本地演示<br />登录信息仅保存在当前浏览器，不会发送到服务器。</p>
        </div>
        <p className="login-side-foot">V0.1 PROTOTYPE · PROJECT COLLABORATION</p>
      </main>
    </div>
  )
}

/**
 * 渲染接受团队邀请原型页。
 * @returns 邀请信息、姓名与密码设置表单；成功后显示登录入口。
 */
export function AcceptInvitationPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? 'demo-invitation'
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('请补全姓名。')
      return
    }
    if (password.length < 8) {
      setError('密码至少需要 8 个字符。')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致。')
      return
    }
    setError('')
    setSuccess(true)
  }

  return (
    <AuthCard
      title="接受团队邀请"
      subtitle="邀请只用于当前团队。设置密码并补全资料后即可登录；邀请过期或已使用时需要管理员重发。"
      footer={
        <>
          已有账号？<Link to="/prototype/auth/login">返回登录</Link>
        </>
      }
    >
      <div className="auth-demo">
        <strong>邀请摘要：</strong>研发团队 · 开发者 · lin@example.test
        <br />
        令牌：{token}（仅用于本地原型展示）
      </div>
      {success ? (
        <div style={{ marginTop: 20 }}>
          <div className="auth-success">
            <PrototypeIcon name="check" />
            <span>邀请已接受，账号已创建。原型不写入真实账号数据，请登录后查看演示工作区。</span>
          </div>
          <div className="form-actions" style={{ marginTop: 18 }}>
            <Link className="btn primary" to="/prototype/auth/login">
              去登录
            </Link>
          </div>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            邮箱
            <input value="lin@example.test" readOnly aria-readonly="true" />
          </label>
          <label className="field">
            姓名
            <input
              value={name}
              autoComplete="name"
              placeholder="用于成员与活动记录"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            设置密码
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              placeholder="至少 8 个字符"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="field">
            确认密码
            <input
              type="password"
              value={confirm}
              autoComplete="new-password"
              placeholder="再次输入密码"
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn primary auth-submit">
            接受邀请并创建账号
          </button>
        </form>
      )}
    </AuthCard>
  )
}

/**
 * 渲染忘记密码原型页。
 * @returns 邮箱提交表单与模拟发送结果。
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('请输入有效的邮箱地址。')
      return
    }
    setError('')
    setSent(true)
  }

  return (
    <AuthCard
      title="找回密码"
      subtitle="输入受邀邮箱，我们会发送重置链接。原型只展示流程，不发送真实邮件。"
      footer={<Link to="/prototype/auth/login">返回登录</Link>}
    >
      {sent ? (
        <div style={{ marginTop: 20 }}>
          <div className="auth-success">
            <PrototypeIcon name="check" />
            <span>如果 {email} 是有效账号，重置链接已发送。链接有效期与真实邮件策略以正式实现为准。</span>
          </div>
          <div className="form-actions" style={{ marginTop: 18 }}>
            <Link className="btn" to="/prototype/auth/reset-password">
              查看重置密码页
            </Link>
          </div>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            邮箱
            <input
              type="email"
              value={email}
              autoComplete="email"
              placeholder="name@company.com"
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn primary auth-submit">
            发送重置链接
          </button>
        </form>
      )}
    </AuthCard>
  )
}

/**
 * 渲染重置密码原型页。
 * @returns 新密码表单；成功后返回登录入口。
 */
export function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (password.length < 8) {
      setError('密码至少需要 8 个字符。')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致。')
      return
    }
    setError('')
    setMessage('密码已重置。原型不保存密码，请返回登录页继续演示。')
  }

  return (
    <AuthCard
      title="设置新密码"
      subtitle="重置链接只能使用一次。密码修改后，旧会话按正式策略失效。"
      footer={<Link to="/prototype/auth/login">返回登录</Link>}
    >
      {message ? (
        <div style={{ marginTop: 20 }}>
          <div className="auth-success">
            <PrototypeIcon name="check" />
            <span>{message}</span>
          </div>
          <div className="form-actions" style={{ marginTop: 18 }}>
            <Link className="btn primary" to="/prototype/auth/login">
              去登录
            </Link>
          </div>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label className="field">
            新密码
            <input
              type="password"
              value={password}
              autoComplete="new-password"
              placeholder="至少 8 个字符"
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="field">
            确认新密码
            <input
              type="password"
              value={confirm}
              autoComplete="new-password"
              placeholder="再次输入密码"
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn primary auth-submit">
            保存新密码
          </button>
        </form>
      )}
    </AuthCard>
  )
}
