import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthRequestError, signInEmail } from './auth-client'

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('认证错误文案', () => {
  it('未授权来源不直接展示英文 Invalid origin', async () => {
    stubFetch(403, { message: 'Invalid origin' })
    await expect(signInEmail('user@example.test', 'password-123')).rejects.toMatchObject({
      message: '当前访问地址未获授权，请使用平台配置的访问地址。',
    })
  })

  it('401 使用统一安全文案，不泄露账号是否存在', async () => {
    stubFetch(401, { message: 'User not found' })
    await expect(signInEmail('user@example.test', 'password-123')).rejects.toBeInstanceOf(AuthRequestError)
    await expect(signInEmail('user@example.test', 'password-123')).rejects.toMatchObject({
      message: '邮箱或密码不正确。',
    })
  })

  it('中文业务原因保留并可直接展示', async () => {
    stubFetch(400, { message: '密码重置暂不可用，请联系平台管理员。' })
    await expect(signInEmail('user@example.test', 'password-123')).rejects.toMatchObject({
      message: '密码重置暂不可用，请联系平台管理员。',
    })
  })
})
