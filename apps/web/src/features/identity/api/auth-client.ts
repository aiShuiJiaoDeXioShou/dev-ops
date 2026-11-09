/** 认证请求失败；message 可直接展示，不包含服务端内部细节。 */
export class AuthRequestError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'AuthRequestError'
    this.code = code
    this.status = status
  }
}

export interface AuthUser {
  id: string
  name: string
  email: string
}

export interface AuthSession {
  user: AuthUser
  session: { id: string; expiresAt: string }
}

async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/v1/auth${path}`, {
      credentials: 'same-origin',
      ...init,
      headers: {
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
    })
  } catch {
    throw new AuthRequestError('无法连接认证服务，请检查网络后重试。', 'NETWORK_ERROR', 0)
  }
  if (!response.ok) {
    const code = response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? 'FORBIDDEN' : 'AUTH_ERROR'
    const message = response.status === 401 ? '邮箱或密码不正确。' : '认证请求失败，请稍后重试。'
    throw new AuthRequestError(message, code, response.status)
  }
  if (response.status === 204) return undefined as T
  try {
    return (await response.json()) as T
  } catch {
    throw new AuthRequestError('认证服务返回了无法解析的数据。', 'INVALID_RESPONSE', response.status)
  }
}

/** 读取当前会话；未登录返回 null。 */
export async function getSession(): Promise<AuthSession | null> {
  return authRequest<AuthSession | null>('/get-session')
}

/** 邮箱密码登录。 */
export async function signInEmail(email: string, password: string): Promise<void> {
  await authRequest('/sign-in/email', { method: 'POST', body: JSON.stringify({ email, password }) })
}

/** 退出当前会话。 */
export async function signOut(): Promise<void> {
  await authRequest('/sign-out', { method: 'POST', body: '{}' })
}

/** 请求密码重置邮件；协议端点保留认证库语义。 */
export async function requestPasswordReset(email: string): Promise<void> {
  await authRequest('/forget-password', {
    method: 'POST',
    body: JSON.stringify({ email, redirectTo: `${window.location.origin}/reset-password` }),
  })
}

/** 使用重置令牌设置新密码。 */
export async function resetPassword(token: string, password: string): Promise<void> {
  await authRequest('/reset-password', { method: 'POST', body: JSON.stringify({ token, newPassword: password }) })
}
