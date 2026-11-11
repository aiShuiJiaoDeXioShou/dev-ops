import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success, teamFixture } from '@/test/server'
import { Component as PipelineRunPage } from './pipeline-run-page'

const runBase = {
  runId: 'run-1',
  projectId: 'project-1',
  repositoryId: 'repo-1',
  workflowPath: '.devops/workflows/ci.yml',
  workflowName: 'web-build',
  ref: 'main',
  commitSha: 'a1b2c3d4e5f6a7b8',
  status: 'interrupted',
  triggerSource: 'manual',
  initiatorChannel: 'web',
  triggeredByUserId: 'user-1',
  initiator: '测试用户',
  nodeId: 'node-1',
  nodeName: 'dev-machine-01',
  errorCode: 'PIPELINE_LEASE_EXPIRED',
  errorMessage: '执行节点失联，租约已过期。',
  durationSeconds: 40,
  cancelRequestedAt: null,
  createdAt: '2026-11-10T08:00:00.000Z',
  assignedAt: '2026-11-10T08:00:10.000Z',
  startedAt: '2026-11-10T08:00:20.000Z',
  finishedAt: '2026-11-10T08:01:00.000Z',
}

const stepInstall = {
  index: 0,
  name: 'Install',
  kind: 'run',
  status: 'failed',
  exitCode: 1,
  errorCode: 'STEP_EXIT_CODE',
  errorMessage: '命令退出码非 0。',
  startedAt: '2026-11-10T08:00:20.000Z',
  finishedAt: '2026-11-10T08:00:50.000Z',
}

const artifactWebDist = {
  artifactId: 'artifact-1',
  runId: 'run-1',
  name: 'web-dist',
  stepIndex: 2,
  sizeBytes: 2048,
  sha256: 'f'.repeat(64),
  status: 'available',
  createdAt: '2026-11-10T08:00:55.000Z',
  downloadUrl: '/api/v1/pipeline-artifacts/artifact-1/download',
}

/** 构造统一失败信封，模拟业务错误。 */
function failure(code: string, message: string) {
  return HttpResponse.json(
    { success: false, code, message, requestId: 'test-request' },
    { headers: { 'x-request-id': 'test-request' } },
  )
}

/** 运行详情响应：默认带空步骤、空产物与空日志统计。 */
function runDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...runBase,
    inputs: {},
    steps: [],
    artifacts: [],
    logs: { items: [], totalSizeBytes: 0 },
    ...overrides,
  }
}

/**
 * 注册详情与日志读取的默认处理；日志按步骤返回给定分片。
 * 与真实服务端一致：afterSeq 是“不含”游标且 seq 从 0 开始，默认值为 -1。
 */
function mockRun(
  detail: Record<string, unknown>,
  logs: { items?: { seq: number; content: string; truncated: boolean }[]; hasMore?: boolean } = {},
) {
  const allChunks = logs.items ?? []
  server.use(
    http.get('*/api/v1/pipeline-runs/run-1', () => success(detail)),
    http.get('*/api/v1/pipeline-runs/run-1/logs', ({ request }) => {
      const afterSeq = Number(new URL(request.url).searchParams.get('afterSeq') ?? '-1')
      const items = allChunks.filter((chunk) => chunk.seq > afterSeq)
      return success({
        stepIndex: 0,
        items,
        nextSeq: items.at(-1)?.seq ?? afterSeq,
        hasMore: logs.hasMore ?? false,
      })
    }),
  )
}

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={sessionFixture.user}>
        <MemoryRouter initialEntries={['/projects/project-1/pipelines/run-1']}>
          <Routes>
            <Route path="/projects/:projectId/pipelines/:runId" element={<PipelineRunPage />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('pipeline-run-page', () => {
  it('加载中显示与最终布局一致的骨架', async () => {
    server.use(http.get('*/api/v1/pipeline-runs/run-1', () => new Promise(() => undefined)))
    renderPage()
    expect(await screen.findByRole('status', { name: '页面加载中' })).toBeInTheDocument()
  })

  it('运行不存在时显示错误与重试入口', async () => {
    server.use(
      http.get('*/api/v1/pipeline-runs/run-1', () => failure('PIPELINE_RUN_NOT_FOUND', '运行不存在或已不可用。')),
    )
    renderPage()
    expect(await screen.findByText('运行详情加载失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新检查/ })).toBeInTheDocument()
  })

  it('中断状态、失败步骤与终态原因可区分展示', async () => {
    // 运行中断时仍停留在 running 的步骤展示为已中断，且不按当前时间累计假耗时。
    mockRun(
      runDetail({
        steps: [
          stepInstall,
          { ...stepInstall, index: 1, name: 'Wait', status: 'running', exitCode: null, finishedAt: null },
        ],
      }),
    )
    renderPage()
    expect(await screen.findByRole('heading', { name: 'web-build' })).toBeInTheDocument()
    expect(screen.getByText('运行已中断')).toBeInTheDocument()
    expect(screen.getByText('执行节点失联，租约已过期。')).toBeInTheDocument()
    expect(screen.getByText('Install')).toBeInTheDocument()
    expect(screen.getByText(/退出码：1/)).toBeInTheDocument()
    expect(screen.getByText('Wait')).toBeInTheDocument()
    expect(screen.getAllByText('已中断')).toHaveLength(2)
    expect(screen.getByText('dev-machine-01')).toBeInTheDocument()
  })

  it('运行日志按步骤展示，过期日志通过重新读取恢复', async () => {
    mockRun(runDetail({ status: 'failed', errorMessage: '步骤执行失败。', steps: [stepInstall] }), {
      items: [
        { seq: 0, content: '> install dependencies\n', truncated: false },
        { seq: 1, content: 'ERR_PNPM_NO_SCRIPT\n', truncated: false },
      ],
    })
    renderPage()
    // seq=0 的首片也必须在真实 afterSeq 语义下返回，避免日志首片被跳过。
    expect(await screen.findByText(/ERR_PNPM_NO_SCRIPT/)).toBeInTheDocument()
    expect(screen.getByText(/install dependencies/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '按步骤筛选日志' })).toBeInTheDocument()
  })

  it('有下载地址时产物可从详情下载', async () => {
    mockRun(runDetail({ status: 'failed', steps: [stepInstall], artifacts: [artifactWebDist] }))
    renderPage()
    expect(await screen.findByText('web-dist')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /下载/ })).toHaveAttribute('href', artifactWebDist.downloadUrl)
  })

  it('开发者可取消运行，二次确认后提交取消请求并展示取消中原因', async () => {
    mockRun(runDetail({ status: 'running', steps: [{ ...stepInstall, status: 'running', exitCode: null }] }))
    let cancelBody: unknown = null
    server.use(
      http.post('*/api/v1/pipeline-runs/run-1/cancel', async ({ request }) => {
        cancelBody = await request.json()
        return success(runDetail({ status: 'cancelling', steps: [{ ...stepInstall, status: 'running' }] }))
      }),
    )
    renderPage()
    const cancelButton = await screen.findByRole('button', { name: '取消运行' })
    await userEvent.click(cancelButton)
    expect(await screen.findByText('取消这次运行？')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('取消原因（可选，写入审计）'), '验证环境已恢复')
    await userEvent.click(screen.getByRole('button', { name: '确认取消' }))
    await waitFor(() => expect(cancelBody).toEqual({ reason: '验证环境已恢复' }))
    expect(await screen.findByText('取消请求已发出')).toBeInTheDocument()
  })

  it('浏览者看不到取消入口', async () => {
    server.use(
      http.get('*/api/v1/me/teams', () =>
        success({ teams: [{ ...teamFixture, role: 'viewer' }], isPlatformAdmin: false }),
      ),
    )
    mockRun(runDetail({ status: 'running', steps: [{ ...stepInstall, status: 'running', exitCode: null }] }))
    renderPage()
    await screen.findByRole('heading', { name: 'web-build' })
    expect(screen.queryByRole('button', { name: '取消运行' })).not.toBeInTheDocument()
  })
})
