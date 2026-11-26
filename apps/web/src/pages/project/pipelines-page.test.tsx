import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/model/session'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success, teamFixture } from '@/test/server'
import { Component as PipelinesPage } from './pipelines-page'

const workflowValid = {
  path: '.devops/workflows/ci.yml',
  name: 'web-build',
  valid: true,
  parseErrors: [],
  runsOn: ['linux'],
  jobCount: 1,
  stepCount: 2,
  inputCount: 1,
  timeoutMinutes: 15,
  recentStatuses: ['succeeded'],
  lastRun: {
    runId: 'run-1',
    status: 'succeeded',
    createdAt: '2026-11-10T08:00:00.000Z',
    durationSeconds: 40,
    ref: 'main',
  },
}

const workflowInvalid = {
  path: '.devops/workflows/broken.yml',
  name: 'broken-build',
  valid: false,
  parseErrors: [
    {
      code: 'PIPELINE_WORKFLOW_UNSUPPORTED',
      message: '不支持 uses: actions/checkout@v4，请使用 builtin:checkout',
      fieldPath: 'jobs.build.steps[0].uses',
      line: 12,
      column: 9,
    },
  ],
  runsOn: [],
  jobCount: 0,
  stepCount: 0,
  inputCount: 0,
  timeoutMinutes: null,
  recentStatuses: [],
  lastRun: null,
}

const runSummary = {
  runId: 'run-1',
  projectId: 'project-1',
  repositoryId: 'repo-1',
  workflowPath: '.devops/workflows/ci.yml',
  workflowName: 'web-build',
  ref: 'main',
  commitSha: 'a1b2c3d4e5f6a7b8',
  status: 'succeeded',
  triggerSource: 'manual',
  initiatorChannel: 'web',
  triggeredByUserId: 'user-1',
  initiator: '测试用户',
  nodeId: 'node-1',
  nodeName: 'dev-machine-01',
  errorCode: null,
  errorMessage: null,
  durationSeconds: 40,
  cancelRequestedAt: null,
  createdAt: '2026-11-10T08:00:00.000Z',
  assignedAt: '2026-11-10T08:00:10.000Z',
  startedAt: '2026-11-10T08:00:20.000Z',
  finishedAt: '2026-11-10T08:01:00.000Z',
  steps: [
    {
      index: 0,
      name: '检出代码',
      kind: 'builtin_checkout',
      status: 'succeeded',
      exitCode: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-11-10T08:00:20.000Z',
      finishedAt: '2026-11-10T08:00:30.000Z',
    },
    {
      index: 1,
      name: '构建应用',
      kind: 'run',
      status: 'succeeded',
      exitCode: 0,
      errorCode: null,
      errorMessage: null,
      startedAt: '2026-11-10T08:00:30.000Z',
      finishedAt: '2026-11-10T08:01:00.000Z',
    },
  ],
}

let lastRunQuery: URLSearchParams | null = null

/** 注册工作流列表与节点默认处理。 */
function mockWorkflows(items: unknown[] = [workflowValid]) {
  server.use(
    http.get('*/api/v1/projects/project-1/pipeline-workflows', () =>
      success({ ref: 'main', commitSha: 'a1b2c3d4e5f6a7b8', items }),
    ),
    http.get('*/api/v1/projects/project-1/pipeline-workflows/detail', () =>
      success({
        path: '.devops/workflows/ci.yml',
        name: 'web-build',
        repositoryId: 'repo-1',
        ref: 'main',
        commitSha: 'a1b2c3d4e5f6a7b8',
        content: 'name: web-build\non:\n  workflow_dispatch:\njobs: {}\n',
        contentHash: 'hash-1',
        valid: true,
        parseErrors: [],
        planSummary: {
          jobs: [
            {
              id: 'build',
              name: '构建与测试',
              steps: [
                { index: 0, name: '检出代码', kind: 'builtin_checkout' },
                { index: 1, name: '构建应用', kind: 'run' },
              ],
            },
          ],
        },
        inputs: [],
      }),
    ),
    http.get('*/api/v1/teams/*/pipeline-nodes', () => success({ items: [] })),
  )
}

/** 注册运行列表处理；按 status 筛选时返回空列表以模拟无匹配。 */
function mockRuns(items: unknown[] = [runSummary]) {
  server.use(
    http.get('*/api/v1/projects/project-1/pipeline-runs', ({ request }) => {
      const url = new URL(request.url)
      lastRunQuery = url.searchParams
      const status = url.searchParams.get('status')
      const pageItems = status === 'failed' ? [] : items
      return success({ items: pageItems, page: 1, pageSize: 20, total: pageItems.length })
    }),
  )
}

function renderPage() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <SessionProvider initialUser={sessionFixture.user}>
        <MemoryRouter initialEntries={['/projects/project-1/pipelines']}>
          <Routes>
            <Route path="/projects/:projectId/pipelines" element={<PipelinesPage />} />
            <Route path="/projects/:projectId/pipelines/:runId" element={<p>运行详情占位</p>} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

describe('pipelines-page', () => {
  it('工作流加载中显示稳定占位', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/pipeline-workflows', () => new Promise(() => undefined)),
      http.get('*/api/v1/projects/project-1/pipeline-runs', () => new Promise(() => undefined)),
      http.get('*/api/v1/teams/*/pipeline-nodes', () => success({ items: [] })),
    )
    renderPage()
    expect(await screen.findByRole('status', { name: '工作流加载中' })).toBeInTheDocument()
    expect(screen.queryByText('工作流加载中…')).not.toBeInTheDocument()
  })

  it('仓库不可用时显示错误与重试，不显示空工作流列表', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/pipeline-workflows', () =>
        HttpResponse.json(
          {
            success: false,
            code: 'PIPELINE_REPOSITORY_UNAVAILABLE',
            message: '仓库或 Git 连接不可用',
            requestId: 'test-request',
          },
          { headers: { 'x-request-id': 'test-request' } },
        ),
      ),
      http.get('*/api/v1/teams/*/pipeline-nodes', () => success({ items: [] })),
    )
    mockRuns()
    renderPage()
    expect(await screen.findByText('工作流读取失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新检查/ })).toBeInTheDocument()
  })

  it('无工作流时显示空工作流引导状态', async () => {
    mockWorkflows([])
    mockRuns([])
    renderPage()
    expect(await screen.findByText('还没有流水线工作流')).toBeInTheDocument()
    expect(screen.queryByText('还没有运行记录')).not.toBeInTheDocument()
  })

  it('有工作流但无运行记录时，左侧显示工作流目录且右侧隐藏无效筛选栏', async () => {
    mockWorkflows([workflowValid])
    mockRuns([])
    renderPage()
    expect(await screen.findByText('还没有运行记录')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '仓库工作流目录' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '按状态筛选' })).not.toBeInTheDocument()
  })

  it('解析失败展示文件、字段与行号，且非法工作流不可触发', async () => {
    mockWorkflows([workflowValid, workflowInvalid])
    mockRuns([])
    renderPage()
    const errorRegion = await screen.findByRole('region', { name: '解析错误' })
    expect(within(errorRegion).getByText('.devops/workflows/broken.yml')).toBeInTheDocument()
    expect(within(errorRegion).getByText(/jobs\.build\.steps\[0\]\.uses/)).toBeInTheDocument()
    expect(within(errorRegion).getByText(/第 12 行第 9 列/)).toBeInTheDocument()
    expect(within(errorRegion).getByText(/不支持 uses: actions\/checkout@v4/)).toBeInTheDocument()
    expect(within(errorRegion).getByText('不可触发')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '触发运行' })).toHaveLength(1)
  })

  it('浏览者只读：显示说明且没有触发入口', async () => {
    server.use(
      http.get('*/api/v1/me/teams', () =>
        success({ teams: [{ ...teamFixture, role: 'viewer' }], isPlatformAdmin: false }),
      ),
    )
    mockWorkflows()
    mockRuns()
    renderPage()
    expect(await screen.findByText(/不能触发运行/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '触发运行' })).not.toBeInTheDocument()
  })

  it('运行历史展示内嵌阶段进度条并直达对应步骤日志，同时支持状态筛选与清除', async () => {
    mockWorkflows()
    mockRuns()
    renderPage()
    const titleLink = await screen.findByRole('link', { name: 'web-build' })
    expect(titleLink).toHaveAttribute('href', '/projects/project-1/pipelines/run-1')
    const stepLink = screen.getByRole('link', { name: /2\. 构建应用/ })
    expect(stepLink).toHaveAttribute('href', '/projects/project-1/pipelines/run-1?step=1')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '按状态筛选' }), 'failed')
    expect(await screen.findByText('没有匹配的运行')).toBeInTheDocument()
    expect(lastRunQuery?.get('status')).toBe('failed')

    const clearButtons = screen.getAllByRole('button', { name: '清除筛选' })
    await userEvent.click(clearButtons[0] as HTMLElement)
    expect(await screen.findByRole('link', { name: 'web-build' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '按状态筛选' })).toHaveValue('')
  })

  it('日期筛选写入查询参数', async () => {
    mockWorkflows()
    mockRuns()
    renderPage()
    await screen.findByRole('link', { name: 'web-build' })
    const fromInput = screen.getByLabelText('开始日期')
    fireEvent.change(fromInput, { target: { value: '2026-11-01' } })
    await waitFor(() => expect(lastRunQuery?.get('from')).toBe('2026-11-01'))
    expect(screen.getByLabelText('结束日期')).toBeInTheDocument()
  })

  it('开发者打开触发对话框并提交幂等触发', async () => {
    mockWorkflows()
    mockRuns()
    let triggerBody: unknown = null
    server.use(
      http.post('*/api/v1/projects/project-1/pipeline-runs', async ({ request }) => {
        triggerBody = await request.json()
        return success({
          ...runSummary,
          runId: 'run-2',
          status: 'queued',
          steps: [],
          artifacts: [],
          inputs: {},
          workflowSnapshot: null,
          planJobs: [],
          logs: { items: [], totalSizeBytes: 0 },
        })
      }),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '触发运行' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('触发流水线运行')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('分支、标签或提交 SHA')).toHaveValue('main')
    await userEvent.click(within(dialog).getByRole('button', { name: '触发运行' }))
    await waitFor(() => expect(triggerBody).toMatchObject({ workflowPath: '.devops/workflows/ci.yml', ref: 'main' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('缺少 GitHub 授权时提供绑定入口，读权限不足时提示向仓库管理员申请', async () => {
    mockWorkflows()
    mockRuns([])
    let code = 'GITHUB_ACCOUNT_REQUIRED'
    server.use(
      http.post('*/api/v1/projects/project-1/pipeline-runs', () =>
        HttpResponse.json({ success: false, code, message: '仓库权限校验失败', requestId: 'test-request' }),
      ),
    )
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: '触发运行' }))
    const dialog = within(await screen.findByRole('dialog'))
    await userEvent.click(dialog.getByRole('button', { name: '触发运行' }))
    expect(await dialog.findByRole('button', { name: '绑定 GitHub 账号' })).toBeEnabled()

    code = 'GITHUB_REPOSITORY_FORBIDDEN'
    await userEvent.click(dialog.getByRole('button', { name: '触发运行' }))
    expect(await dialog.findByText(/向仓库管理员申请读取权限/)).toBeVisible()
    expect(dialog.queryByRole('button', { name: '绑定 GitHub 账号' })).not.toBeInTheDocument()
  })
})
