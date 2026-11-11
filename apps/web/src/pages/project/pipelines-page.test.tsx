import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success, teamFixture } from '@/test/server'
import { Component as PipelinesPage } from './pipelines-page'

const workflowValid = {
  path: '.devops/workflows/ci.yml',
  name: 'web-build',
  valid: true,
  parseErrors: [],
  lastRun: { runId: 'run-1', status: 'succeeded', createdAt: '2026-11-10T08:00:00.000Z' },
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
}

let lastRunQuery: URLSearchParams | null = null

/** 注册工作流列表处理。 */
function mockWorkflows(items: unknown[] = [workflowValid]) {
  server.use(
    http.get('*/api/v1/projects/project-1/pipeline-workflows', () =>
      success({ ref: 'main', commitSha: 'a1b2c3d4e5f6a7b8', items }),
    ),
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

/** 切换到运行历史页签；两个视图互斥，需要先切换再断言。 */
async function openRunsTab() {
  await userEvent.click(await screen.findByRole('tab', { name: /运行历史/ }))
}

describe('pipelines-page', () => {
  it('工作流加载中显示稳定占位', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/pipeline-workflows', () => new Promise(() => undefined)),
      http.get('*/api/v1/projects/project-1/pipeline-runs', () => new Promise(() => undefined)),
    )
    renderPage()
    expect(await screen.findByText('工作流加载中…')).toBeInTheDocument()
  })

  it('仓库不可用时显示错误与重试，不显示空工作流列表', async () => {
    // 仓库连接失效时服务端返回业务错误信封，页面必须显示错误而不是空列表。
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
    )
    mockRuns()
    renderPage()
    expect(await screen.findByText('工作流读取失败')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /重新检查/ })).toBeInTheDocument()
  })

  it('默认展示工作流页签，切换页签后展示运行历史空状态', async () => {
    mockWorkflows([])
    mockRuns([])
    renderPage()
    expect(await screen.findByText('还没有流水线工作流')).toBeInTheDocument()
    expect(screen.queryByText('还没有运行记录')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /工作流/ })).toHaveAttribute('aria-selected', 'true')

    await openRunsTab()
    expect(await screen.findByText('还没有运行记录')).toBeInTheDocument()
    expect(screen.queryByText('还没有流水线工作流')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /运行历史/ })).toHaveAttribute('aria-selected', 'true')
    // 没有任何运行记录时隐藏筛选栏，避免空页面出现一排无效控件。
    expect(screen.queryByRole('combobox', { name: '按状态筛选' })).not.toBeInTheDocument()
  })

  it('解析失败展示文件、字段与行号，且非法工作流不可触发', async () => {
    mockWorkflows([workflowValid, workflowInvalid])
    mockRuns([])
    renderPage()
    expect(await screen.findByText('解析失败')).toBeInTheDocument()
    const errorRegion = screen.getByRole('region', { name: '解析错误' })
    expect(within(errorRegion).getByText('.devops/workflows/broken.yml')).toBeInTheDocument()
    expect(within(errorRegion).getByText(/jobs\.build\.steps\[0\]\.uses/)).toBeInTheDocument()
    expect(within(errorRegion).getByText(/第 12 行第 9 列/)).toBeInTheDocument()
    expect(within(errorRegion).getByText(/不支持 uses: actions\/checkout@v4/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '触发运行' })).toHaveLength(1)
    expect(screen.getByText('不可触发')).toBeInTheDocument()
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

  it('运行历史行链接到详情，并支持状态筛选与无匹配清除', async () => {
    mockWorkflows()
    mockRuns()
    renderPage()
    await openRunsTab()
    const titleLink = await screen.findByRole('link', { name: 'web-build' })
    expect(titleLink).toHaveAttribute('href', '/projects/project-1/pipelines/run-1')

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '按状态筛选' }), 'failed')
    expect(await screen.findByText('没有匹配的运行')).toBeInTheDocument()
    expect(lastRunQuery?.get('status')).toBe('failed')

    const clearButtons = screen.getAllByRole('button', { name: '清除筛选' })
    await userEvent.click(clearButtons[0] as HTMLElement)
    expect(await screen.findByRole('link', { name: 'web-build' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '按状态筛选' })).toHaveValue('')
    expect(screen.queryByRole('button', { name: '清除筛选' })).not.toBeInTheDocument()
  })

  it('日期筛选写入查询参数后无匹配可清除', async () => {
    mockWorkflows()
    mockRuns()
    renderPage()
    await openRunsTab()
    await screen.findByRole('link', { name: 'web-build' })
    const fromInput = screen.getByLabelText('开始日期')
    fireEvent.change(fromInput, { target: { value: '2026-11-01' } })
    await waitFor(() => expect(lastRunQuery?.get('from')).toBe('2026-11-01'))
    expect(screen.getByLabelText('结束日期')).toBeInTheDocument()
  })

  it('开发者从合法工作流打开触发对话框并提交幂等触发', async () => {
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
})
