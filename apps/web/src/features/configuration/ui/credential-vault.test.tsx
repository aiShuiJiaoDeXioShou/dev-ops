import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { delay, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success, teamFixture } from '@/test/server'
import { ToastProvider } from '@/shared/ui/toast'
import { CredentialVault } from './credential-vault'

const EMPTY_CREDENTIAL_PAGE = { items: [], page: 1, pageSize: 20, total: 0 }

/** 返回空凭据列表响应，供空库与搜索无匹配场景复用。 */
function emptyCredentialList() {
  return http.get('*/api/v1/teams/team-1/credentials', () => success(EMPTY_CREDENTIAL_PAGE))
}

const OBJECT_STORAGE_CREDENTIAL = {
  id: 'credential-1',
  teamId: 'team-1',
  name: '测试环境对象存储密钥',
  kind: 'api_key',
  description: '供测试环境 Bot 上传构建产物使用。',
  status: 'active',
  currentVersion: 3,
  expiresAt: null,
  grants: [{ projectId: 'project-1', projectName: '测试项目', expiresAt: null, revokedAt: null }],
  maskedValue: 'sk-****9f2c',
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-08T08:00:00.000Z',
}

const ACCOUNT_CREDENTIAL = {
  id: 'credential-2',
  teamId: 'team-1',
  name: '生产账号密码',
  kind: 'account_password',
  description: null,
  status: 'active',
  currentVersion: 1,
  expiresAt: null,
  grants: [],
  maskedValue: '******',
  createdAt: '2026-11-02T08:00:00.000Z',
  updatedAt: '2026-11-09T08:00:00.000Z',
}

const USAGE_ITEM = {
  id: 'usage-1',
  credentialId: 'credential-1',
  credentialVersion: 3,
  projectId: null,
  environment: null,
  action: 'use',
  actorUserId: null,
  result: 'success',
  errorCode: null,
  createdAt: '2026-11-08T09:00:00.000Z',
}

const REVEAL_USAGE_ITEM = {
  id: 'usage-2',
  credentialId: 'credential-1',
  credentialVersion: 3,
  projectId: null,
  environment: null,
  action: 'reveal',
  actorUserId: null,
  result: 'denied',
  errorCode: 'PASSWORD_INVALID',
  createdAt: '2026-11-08T10:00:00.000Z',
}

const REVEALED_VALUE = { value: 'sk-live-revealed-001', version: 3, revealedAt: '2026-11-10T09:30:00.000Z' }

/** 返回指定条目的凭据列表响应，默认只包含一个对象存储密钥。 */
function credentialList(items: unknown[] = [OBJECT_STORAGE_CREDENTIAL]) {
  return http.get('*/api/v1/teams/team-1/credentials', () =>
    success({ items, page: 1, pageSize: 20, total: items.length }),
  )
}

/** 返回凭据使用记录响应，默认包含一条成功使用记录。 */
function credentialUsage(items: unknown[] = [USAGE_ITEM]) {
  return http.get('*/api/v1/credentials/:credentialId/usage', () =>
    success({ items, page: 1, pageSize: 20, total: items.length }),
  )
}

/**
 * 模拟查看明文接口：只有 correct-password 能拿到明文，其余返回密码错误业务信封。
 * @param responseDelayMs 响应延迟毫秒数，用于覆盖提交中禁用状态。
 * @returns 拦截 reveal-value 请求的 msw handler。
 */
function revealValue(responseDelayMs = 0) {
  return http.post('*/api/v1/credentials/:credentialId/reveal-value', async ({ request }) => {
    const body = (await request.json()) as { password: string }
    if (responseDelayMs > 0) await delay(responseDelayMs)
    if (body.password !== 'correct-password') {
      return HttpResponse.json(
        {
          success: false,
          code: 'PASSWORD_INVALID',
          message: '登录密码错误，无法查看凭据值',
          requestId: 'test-request',
        },
        { headers: { 'x-request-id': 'test-request' } },
      )
    }
    return success(REVEALED_VALUE)
  })
}

/** 渲染带会话、查询客户端和提示容器的凭据库，保持与页面一致的依赖。 */
function renderVault() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={sessionFixture.user}>
        <ToastProvider>
          <CredentialVault />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

/** 点击查看入口，输入密码并提交，复用查看明文的交互路径。 */
async function submitRevealPassword(user: ReturnType<typeof userEvent.setup>, password: string) {
  await user.click(screen.getByRole('button', { name: '查看凭据值' }))
  await user.type(await screen.findByLabelText('当前登录密码'), password)
  await user.click(screen.getByRole('button', { name: '确认查看' }))
}

describe('CredentialVault', () => {
  it('空库在页面居中展示 Bot 空状态与添加入口，且不展示明文', async () => {
    server.use(emptyCredentialList())
    renderVault()
    const title = await screen.findByText('凭据库还是空的')
    expect(title.closest('.keychain-detail')).not.toBeNull()
    expect(screen.getAllByRole('button', { name: '添加凭据' }).length).toBeGreaterThan(0)
    expect(screen.queryByText(/sk-/)).not.toBeInTheDocument()
  })

  it('搜索无匹配时展示居中空状态，清除筛选后回到空库提示', async () => {
    server.use(emptyCredentialList())
    const user = userEvent.setup()
    renderVault()
    await screen.findByText('凭据库还是空的')
    await user.type(screen.getByLabelText('搜索凭据'), '不存在的凭据')
    const noMatch = await screen.findByText('没有匹配的凭据')
    expect(noMatch.closest('.keychain-detail')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(await screen.findByText('凭据库还是空的')).toBeInTheDocument()
    expect(screen.getByLabelText('搜索凭据')).toHaveValue('')
  })

  it('选中凭据后展示授权项目名称与使用记录，查看明文动作使用中文标签', async () => {
    server.use(credentialList(), credentialUsage([USAGE_ITEM, REVEAL_USAGE_ITEM]))
    renderVault()
    expect(await screen.findByRole('heading', { name: '测试环境对象存储密钥' })).toBeInTheDocument()
    expect(screen.getByText('测试项目')).toBeInTheDocument()
    expect(screen.queryByText('project-1')).not.toBeInTheDocument()
    expect(await screen.findByText('使用')).toBeInTheDocument()
    expect(screen.getByText('成功')).toBeInTheDocument()
    expect(screen.getByText('查看明文')).toBeInTheDocument()
    expect(screen.getByText('被拒绝')).toBeInTheDocument()
  })

  it('管理员输入正确密码后展示明文、版本与查看时间，且敏感信息不写入存储', async () => {
    server.use(credentialList(), credentialUsage(), revealValue())
    const user = userEvent.setup()
    renderVault()
    await screen.findByRole('heading', { name: '测试环境对象存储密钥' })
    await user.click(screen.getByRole('button', { name: '查看凭据值' }))
    const passwordInput = await screen.findByLabelText('当前登录密码')
    expect(passwordInput).toHaveAttribute('type', 'password')
    expect(passwordInput).toHaveAttribute('autocomplete', 'current-password')
    await waitFor(() => expect(passwordInput).toHaveFocus())
    await user.type(passwordInput, 'correct-password')
    await user.click(screen.getByRole('button', { name: '确认查看' }))
    expect(await screen.findByText('sk-live-revealed-001')).toBeInTheDocument()
    expect(screen.getByText(/明文 · v3 · 查看于/)).toBeInTheDocument()
    expect(screen.getByText(/秒后自动隐藏/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即隐藏' })).toBeInTheDocument()
    const savedStorage = JSON.stringify({ ...localStorage, ...sessionStorage })
    expect(savedStorage).not.toContain('correct-password')
    expect(savedStorage).not.toContain('sk-live-revealed-001')
    expect(window.location.href).not.toContain('correct-password')
  })

  it('密码错误时弹窗保持打开并提示错误，同时清空密码输入', async () => {
    server.use(credentialList(), credentialUsage(), revealValue())
    const user = userEvent.setup()
    renderVault()
    await screen.findByRole('heading', { name: '测试环境对象存储密钥' })
    await submitRevealPassword(user, 'wrong-password')
    expect(await screen.findByRole('alert')).toHaveTextContent('登录密码错误，请重试。')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('当前登录密码')).toHaveValue('')
    expect(screen.queryByText('sk-live-revealed-001')).not.toBeInTheDocument()
  })

  it('提交中禁用确认按钮，避免重复发起密码校验', async () => {
    server.use(credentialList(), credentialUsage(), revealValue(100))
    const user = userEvent.setup()
    renderVault()
    await screen.findByRole('heading', { name: '测试环境对象存储密钥' })
    await submitRevealPassword(user, 'correct-password')
    expect(screen.getByRole('button', { name: '验证中…' })).toBeDisabled()
    expect(await screen.findByText('sk-live-revealed-001')).toBeInTheDocument()
  })

  it('Esc 关闭密码弹窗后清空已输入密码', async () => {
    server.use(credentialList(), credentialUsage(), revealValue())
    const user = userEvent.setup()
    renderVault()
    await screen.findByRole('heading', { name: '测试环境对象存储密钥' })
    await user.click(screen.getByRole('button', { name: '查看凭据值' }))
    await user.type(await screen.findByLabelText('当前登录密码'), 'typed-password')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: '查看凭据值' }))
    expect(await screen.findByLabelText('当前登录密码')).toHaveValue('')
  })

  it('点击立即隐藏后明文消失并恢复掩码入口', async () => {
    server.use(credentialList(), credentialUsage(), revealValue())
    const user = userEvent.setup()
    renderVault()
    await screen.findByRole('heading', { name: '测试环境对象存储密钥' })
    await submitRevealPassword(user, 'correct-password')
    expect(await screen.findByText('sk-live-revealed-001')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '立即隐藏' }))
    expect(screen.queryByText('sk-live-revealed-001')).not.toBeInTheDocument()
    expect(screen.getByText('掩码 sk-****9f2c')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看凭据值' })).toBeInTheDocument()
  })

  it('切换选中凭据后清除已展示的明文', async () => {
    server.use(credentialList([OBJECT_STORAGE_CREDENTIAL, ACCOUNT_CREDENTIAL]), credentialUsage(), revealValue())
    const user = userEvent.setup()
    renderVault()
    await screen.findByRole('heading', { name: '测试环境对象存储密钥' })
    await submitRevealPassword(user, 'correct-password')
    expect(await screen.findByText('sk-live-revealed-001')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /生产账号密码/ }))
    expect(await screen.findByRole('heading', { name: '生产账号密码' })).toBeInTheDocument()
    expect(screen.queryByText('sk-live-revealed-001')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '立即隐藏' })).not.toBeInTheDocument()
  })

  it('浏览者角色不展示查看凭据值入口', async () => {
    server.use(
      http.get('*/api/v1/me/teams', () => success([{ ...teamFixture, role: 'viewer' }])),
      credentialList(),
      credentialUsage(),
    )
    renderVault()
    await screen.findByRole('heading', { name: '测试环境对象存储密钥' })
    expect(screen.queryByRole('button', { name: '查看凭据值' })).not.toBeInTheDocument()
  })
})

describe('CredentialVault 明文自动隐藏', () => {
  beforeEach(() => {
    // 刷新控制台输出前让假时钟跟随真实时间推进，避免 waitFor 永远等不到定时器。
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('明文展示 30 秒后自动隐藏并恢复掩码入口', async () => {
    server.use(credentialList(), credentialUsage(), revealValue())
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    renderVault()
    await screen.findByRole('heading', { name: '测试环境对象存储密钥' })
    await submitRevealPassword(user, 'correct-password')
    expect(await screen.findByText('sk-live-revealed-001')).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(screen.queryByText('sk-live-revealed-001')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '查看凭据值' })).toBeInTheDocument()
  })
})
