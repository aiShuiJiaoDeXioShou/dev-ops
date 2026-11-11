import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success, teamFixture } from '@/test/server'
import { Component as PipelineNodesPage } from './pipeline-nodes-page'

const nodeOnline = {
  nodeId: 'node-1',
  teamId: 'team-1',
  name: 'dev-machine-01',
  status: 'online',
  os: 'linux',
  arch: 'x64',
  capabilities: ['linux', 'docker', 'node24'],
  concurrencyLimit: 1,
  agentVersion: '0.4.0',
  lastHeartbeatAt: new Date(Date.now() - 30_000).toISOString(),
  lastErrorCode: null,
  currentRunId: null,
  disabledAt: null,
  createdAt: '2026-11-10T08:00:00.000Z',
}

const nodeOffline = {
  ...nodeOnline,
  nodeId: 'node-2',
  name: 'dev-machine-02',
  status: 'offline',
  capabilities: ['linux'],
  agentVersion: '0.3.9',
}

/** 注册节点列表处理。 */
function mockNodes(items: unknown[] = [nodeOnline, nodeOffline]) {
  server.use(http.get('*/api/v1/teams/team-1/pipeline-nodes', () => success({ items })))
}

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={sessionFixture.user}>
        <MemoryRouter initialEntries={['/settings/pipeline-nodes']}>
          <Routes>
            <Route path="/settings/pipeline-nodes" element={<PipelineNodesPage />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('pipeline-nodes-page', () => {
  it('管理员查看节点状态、能力标签、心跳、并发与 Agent 版本', async () => {
    mockNodes()
    renderPage()
    expect(await screen.findByText('dev-machine-01')).toBeInTheDocument()
    expect(screen.getByText('在线')).toBeInTheDocument()
    expect(screen.getByText('离线')).toBeInTheDocument()
    expect(screen.getByText('node24')).toBeInTheDocument()
    expect(screen.getByText('0.4.0')).toBeInTheDocument()
    const onlineRow = screen.getByRole('row', { name: /dev-machine-01/ })
    expect(within(onlineRow).getByText('1')).toBeInTheDocument()
  })

  it('没有节点时给出注册引导与新建入口', async () => {
    mockNodes([])
    renderPage()
    expect(await screen.findByText('还没有执行节点')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '新建执行节点' }).length).toBeGreaterThan(0)
  })

  it('节点列表加载失败时显示错误与重试', async () => {
    server.use(
      http.get('*/api/v1/teams/team-1/pipeline-nodes', () =>
        HttpResponse.json(
          { success: false, code: 'FORBIDDEN', message: '仅团队管理员可查看节点', requestId: 'test-request' },
          { headers: { 'x-request-id': 'test-request' } },
        ),
      ),
    )
    renderPage()
    expect(await screen.findByText('节点列表加载失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新检查/ })).toBeInTheDocument()
  })

  it('非管理员只看到权限说明，不请求节点列表', async () => {
    let requested = false
    server.use(
      http.get('*/api/v1/me/teams', () =>
        success({ teams: [{ ...teamFixture, role: 'viewer' }], isPlatformAdmin: false }),
      ),
      http.get('*/api/v1/teams/team-1/pipeline-nodes', () => {
        requested = true
        return success({ items: [] })
      }),
    )
    renderPage()
    expect(await screen.findByText('仅团队管理员可管理执行节点')).toBeInTheDocument()
    expect(requested).toBe(false)
  })

  it('新建节点后展示只显示一次的注册令牌', async () => {
    mockNodes([])
    let createBody: unknown = null
    server.use(
      http.post('*/api/v1/teams/team-1/pipeline-nodes', async ({ request }) => {
        createBody = await request.json()
        return success({
          node: { ...nodeOnline, nodeId: 'node-3', name: 'dev-machine-03', status: 'pending' },
          registrationToken: 'reg-token-once',
          registrationTokenExpiresAt: '2026-11-10T09:00:00.000Z',
        })
      }),
    )
    renderPage()
    await userEvent.click((await screen.findAllByRole('button', { name: '新建执行节点' }))[0] as HTMLElement)
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('节点名称'), 'dev-machine-03')
    await userEvent.click(within(dialog).getByRole('button', { name: '创建节点' }))
    await waitFor(() => expect(createBody).toMatchObject({ name: 'dev-machine-03', capabilities: ['linux', 'docker'] }))
    expect(await screen.findByText('节点注册令牌')).toBeInTheDocument()
    expect(screen.getByDisplayValue('reg-token-once')).toBeInTheDocument()
    expect(screen.getByText('令牌只显示一次')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /复制令牌/ })).toBeInTheDocument()
  })

  it('排空节点不改变状态前提交排空请求', async () => {
    mockNodes([nodeOnline])
    let drained = false
    server.use(
      http.post('*/api/v1/pipeline-nodes/node-1/drain', () => {
        drained = true
        return success({ node: { ...nodeOnline, status: 'draining' } })
      }),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '排空' }))
    await waitFor(() => expect(drained).toBe(true))
  })

  it('停用节点需要二次确认', async () => {
    mockNodes([nodeOnline])
    let disabled = false
    server.use(
      http.post('*/api/v1/pipeline-nodes/node-1/disable', () => {
        disabled = true
        return success({ node: { ...nodeOnline, status: 'disabled' } })
      }),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '停用' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/停用后节点立即撤销活动 Agent 令牌/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '停用节点' }))
    await waitFor(() => expect(disabled).toBe(true))
  })

  it('轮换令牌确认后展示新的 Agent 令牌', async () => {
    mockNodes([nodeOnline])
    server.use(
      http.post('*/api/v1/pipeline-nodes/node-1/tokens/rotate', () =>
        success({ nodeId: 'node-1', agentToken: 'agent-token-once', createdAt: '2026-11-10T08:30:00.000Z' }),
      ),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '轮换令牌' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: '轮换令牌' }))
    expect(await screen.findByText('节点 Agent 令牌')).toBeInTheDocument()
    expect(screen.getByDisplayValue('agent-token-once')).toBeInTheDocument()
  })
})
