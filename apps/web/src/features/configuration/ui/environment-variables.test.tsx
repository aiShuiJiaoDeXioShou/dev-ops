import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/model/session'
import { createQueryClient } from '@/shared/api/query-client'
import { ToastProvider } from '@/shared/ui/toast'
import { server, sessionFixture, success } from '@/test/server'
import { EnvironmentVariables } from './environment-variables'

const devItems = [
  {
    id: 'var-1',
    projectId: 'project-1',
    environment: 'development',
    name: 'API_BASE_URL',
    kind: 'plain',
    status: 'active',
    version: 2,
    credential: null,
    valuePreview: 'https://dev.api.example.test',
    masked: false,
    invalidReason: null,
    updatedAt: '2026-11-10T08:00:00.000Z',
  },
  {
    id: 'var-2',
    projectId: 'project-1',
    environment: 'development',
    name: 'NPM_TOKEN',
    kind: 'credential_ref',
    status: 'invalid',
    version: 1,
    credential: {
      id: 'cred-1',
      name: 'npm-publish-token',
      status: 'revoked',
      currentVersion: 3,
    },
    valuePreview: null,
    masked: true,
    invalidReason: 'credential_revoked',
    updatedAt: '2026-11-10T09:00:00.000Z',
  },
]

function renderVariables(initialPath = '/projects/project-1/environment') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={sessionFixture.user}>
        <ToastProvider>
          <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
              <Route path="/projects/:projectId/environment" element={<EnvironmentVariables projectId="project-1" />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('EnvironmentVariables', () => {
  it('展示结构化环境变量表格、凭据版本与中文失效原因，并支持类型筛选与搜索', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/environments/development/variables', () =>
        success({ items: devItems, page: 1, pageSize: 50, total: 2 }),
      ),
      http.get('*/api/v1/projects/project-1/environments/test/variables', () =>
        success({ items: [], page: 1, pageSize: 50, total: 0 }),
      ),
      http.get('*/api/v1/projects/project-1/environments/production/variables', () =>
        success({ items: [], page: 1, pageSize: 50, total: 0 }),
      ),
      http.get('*/api/v1/teams/*/credentials', () => success({ items: [], page: 1, pageSize: 100, total: 0 })),
    )
    renderVariables()

    expect(await screen.findByText('API_BASE_URL')).toBeInTheDocument()
    expect(screen.getByText('https://dev.api.example.test')).toBeInTheDocument()
    expect(screen.getByText('npm-publish-token')).toBeInTheDocument()
    expect(screen.getByText('失效（凭据已吊销）')).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '按变量类型筛选' }), 'credential_ref')
    expect(screen.queryByText('API_BASE_URL')).not.toBeInTheDocument()
    expect(screen.getByText('NPM_TOKEN')).toBeInTheDocument()

    await userEvent.type(screen.getByRole('textbox', { name: '搜索环境变量' }), 'NON_EXISTENT')
    expect(await screen.findByText('没有匹配的环境变量')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: '清除筛选' })[0] as HTMLElement)
    expect(await screen.findByText('API_BASE_URL')).toBeInTheDocument()
  })

  it('空环境提供一键跳转到其他已配置环境，并校验删除原因', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/environments/development/variables', () =>
        success({ items: devItems, page: 1, pageSize: 50, total: 2 }),
      ),
      http.get('*/api/v1/projects/project-1/environments/test/variables', () =>
        success({ items: [], page: 1, pageSize: 50, total: 0 }),
      ),
      http.get('*/api/v1/projects/project-1/environments/production/variables', () =>
        success({ items: [], page: 1, pageSize: 50, total: 0 }),
      ),
      http.get('*/api/v1/teams/*/credentials', () => success({ items: [], page: 1, pageSize: 100, total: 0 })),
    )
    renderVariables('/projects/project-1/environment?env=test')

    expect(await screen.findByText('这个环境还没有配置')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /查看开发环境/ }))
    expect(await screen.findByText('API_BASE_URL')).toBeInTheDocument()

    const rows = screen.getAllByRole('row')
    const firstDataRow = rows[1] as HTMLElement
    await userEvent.click(within(firstDataRow).getByRole('button', { name: '删除' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: '确认删除' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('请填写删除原因')
  })
})
