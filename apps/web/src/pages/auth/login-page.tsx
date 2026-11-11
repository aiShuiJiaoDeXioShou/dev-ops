import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Folder, FileText } from 'lucide-react'
import { AuthRequestError, sessionQueryOptions, signInEmail } from '@/features/identity/public'

const loginBots = [
  { name: '项目助手', mark: 'orbit' },
  { name: '小林', mark: 'prism' },
  { name: '小渡', mark: 'signal' },
]

/**
 * 登录页；视觉结构沿用交互原型的深色画布与右侧登录卡片，提交真实认证请求。
 * @returns 原型样式登录页；成功后回跳受保护页面。
 */
export function Component() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const session = useQuery(sessionQueryOptions)
  // 已登录访问登录页时直接回到工作台，避免重复登录或误以为会话失效。
  useEffect(() => {
    if (!session.data) return
    const redirect = params.get('redirect')
    navigate(redirect && redirect.startsWith('/') ? redirect : '/projects', { replace: true })
  }, [session.data, params, navigate])
  const mutation = useMutation({
    mutationFn: () => signInEmail(email.trim(), password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sessionQueryOptions.queryKey })
      const redirect = params.get('redirect')
      navigate(redirect && redirect.startsWith('/') ? redirect : '/projects', { replace: true })
    },
    onError: (cause: unknown) => {
      setError(cause instanceof AuthRequestError ? cause.message : '登录失败，请稍后重试。')
    },
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!email.trim() || !password) {
      setError('请输入邮箱和密码。')
      return
    }
    mutation.mutate()
  }

  return (
    <div className="login-shell">
      <section className="login-stage" aria-label="DevOps 项目与 Bot 协作">
        <div className="login-topline">
          <Link className="login-brand" to="/login" aria-label="DevOps 登录">
            <img src="/prototype/brand.svg" width={29} height={29} alt="" />
            DevOps
          </Link>
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
            <span className="login-collab-icon">
              <Folder aria-hidden="true" />
            </span>
            <span className="login-collab-name">
              <strong>研发协作平台</strong>
              <small>团队协作 · 研发工作台</small>
            </span>
            <span className="login-collab-status">
              <span className="dot green" />
              进行中
            </span>
            <span className="login-collab-avatars" aria-label="项目中的 Bot">
              {loginBots.map((bot) => (
                <img key={bot.name} src={`/prototype/bots/bot-${bot.mark}-live.svg`} alt={bot.name} />
              ))}
            </span>
          </div>

          <div className="login-collab-messages">
            <div className="login-message">
              <img src="/prototype/bots/bot-orbit-live.svg" alt="" />
              <div>
                <strong>项目助手</strong>
                <time>09:42</time>
                <p>需求已提测，测试负责人和验收范围已记录。</p>
              </div>
            </div>
            <div className="login-message">
              <img src="/prototype/bots/bot-prism-live.svg" alt="" />
              <div>
                <strong>小林</strong>
                <time>09:48</time>
                <p>已读取仓库并关联代码引用，等待回归验证。</p>
              </div>
            </div>
            <div className="login-message">
              <img src="/prototype/bots/bot-signal-live.svg" alt="" />
              <div>
                <strong>小渡</strong>
                <time>10:07</time>
                <p>Bug 回归失败原因已记录，已回到修复中。</p>
              </div>
            </div>
          </div>

          <div className="login-task">
            <FileText aria-hidden="true" />
            <span>待测试 · 统一接口错误处理</span>
            <span className="login-task-chip">测试负责人</span>
          </div>
        </article>

        <ul className="login-principles" aria-label="DevOps 核心能力">
          <li>
            <span className="dot" />
            团队协作
          </li>
          <li>
            <span className="dot" />
            项目管理
          </li>
          <li>
            <span className="dot" />
            Bot 自动化
          </li>
        </ul>
      </section>

      <main className="login-side">
        <div className="login-card">
          <div className="login-card-brand">
            <img src="/prototype/brand.svg" width={25} height={25} alt="" />
            DevOps <span>研发工作台</span>
          </div>
          <h1>登录研发工作台</h1>
          <form className="auth-form login-form" onSubmit={submit} noValidate>
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
            <div className="auth-row auth-row-end">
              <Link to="/forgot-password">忘记密码？</Link>
            </div>
            {error && (
              <p className="field-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="login-submit" disabled={mutation.isPending}>
              {mutation.isPending ? '登录中…' : '登录'}
            </button>
          </form>
          <p className="login-invite">
            还没有账号？<Link to="/accept-invitation">通过团队邀请加入</Link>
          </p>
        </div>
      </main>
    </div>
  )
}

export default Component
