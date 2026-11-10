import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success } from '@/test/server'
import { ToastProvider } from '@/shared/ui/toast'
import { CredentialVault } from './credential-vault'

const EMPTY_CREDENTIAL_PAGE = { items: [], page: 1, pageSize: 20, total: 0 }

/** 返回空凭据列表响应，供空库与搜索无匹配场景复用。 */
function emptyCredentialList() {
  return http.get('*/api/v1/teams/team-1/credentials', () => success(EMPTY_CREDENTIAL_PAGE))
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

describe('CredentialVault', () => {
  it('空库在页面居中展示 Bot 空状态与添加入口，且不展示明文', async () => {
    server.use(emptyCredentialList())
    renderVault()
    const title = await screen.findByText('凭据库还是空的')
    expect(title.closest('.empty-page')).not.toBeNull()
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
    expect(noMatch.closest('.empty-page')).not.toBeNull()
    await user.click(screen.getByRole('button', { name: '清除筛选' }))
    expect(await screen.findByText('凭据库还是空的')).toBeInTheDocument()
    expect(screen.getByLabelText('搜索凭据')).toHaveValue('')
  })

  it('选中凭据后展示授权项目名称与使用记录', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/credentials', () =>
        success({
          items: [
            {
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
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        }),
      ),
      http.get('*/api/v1/credentials/credential-1/usage', () =>
        success({
          items: [
            {
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
            },
          ],
          page: 1,
          pageSize: 20,
          total: 1,
        }),
      ),
    )
    renderVault()
    expect(await screen.findByRole('heading', { name: '测试环境对象存储密钥' })).toBeInTheDocument()
    expect(screen.getByText('测试项目')).toBeInTheDocument()
    expect(screen.queryByText('project-1')).not.toBeInTheDocument()
    expect(await screen.findByText('使用')).toBeInTheDocument()
    expect(screen.getByText('成功')).toBeInTheDocument()
  })
})
