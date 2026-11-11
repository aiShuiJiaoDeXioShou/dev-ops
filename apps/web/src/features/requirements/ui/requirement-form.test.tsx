import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, delay } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, success } from '@/test/server'
import type { RequirementDetail } from '../model/types'
import { RequirementForm } from './requirement-form'

/** 上传成功时固定返回的临时附件摘要，便于断言提交体。 */
const uploadedAttachmentFixture = {
  id: 'att-1',
  fileName: '复现.log',
  sizeBytes: 8,
  contentType: 'text/plain',
  sha256: 'a'.repeat(64),
  status: 'temp',
  uploadedAt: '2026-11-11T00:00:00.000Z',
}

/** 编辑场景的需求详情夹具，含一个已绑定附件。 */
const editingRequirement: RequirementDetail = {
  id: 'req-1',
  teamId: 'team-1',
  projectId: 'project-1',
  number: 1,
  title: '已有需求',
  status: 'in_development',
  devOwner: null,
  testOwner: null,
  version: 2,
  updatedAt: '2026-11-10T00:00:00.000Z',
  contentMode: 'markdown',
  contentMarkdown: '已有正文',
  externalUrl: null,
  externalSummary: null,
  acceptanceCriteria: null,
  collaborators: [],
  attachments: [
    {
      id: 'att-1',
      fileName: '旧截图.png',
      sizeBytes: 1024,
      contentType: 'image/png',
      sha256: 'b'.repeat(64),
      uploadedBy: { userId: 'user-1', name: '测试用户', status: 'active', available: true },
      createdAt: '2026-11-10T00:00:00.000Z',
      downloadUrl: '/api/v1/attachments/att-1/download',
    },
    {
      id: 'att-2',
      fileName: '旧日志.txt',
      sizeBytes: 2048,
      contentType: 'text/plain',
      sha256: 'c'.repeat(64),
      uploadedBy: { userId: 'user-1', name: '测试用户', status: 'active', available: true },
      createdAt: '2026-11-10T00:00:00.000Z',
      downloadUrl: '/api/v1/attachments/att-2/download',
    },
  ],
  latestTestSubmission: null,
  linkedBugs: [],
  needsReview: false,
  linkedCodeReferences: [],
  createdAt: '2026-11-10T00:00:00.000Z',
  createdByUserId: 'user-1',
}

function renderForm(options: { requirement?: RequirementDetail | null; onOpenChange?: (open: boolean) => void } = {}) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <RequirementForm
        projectId="project-1"
        teamId="team-1"
        open
        onOpenChange={options.onOpenChange ?? (() => undefined)}
        requirement={options.requirement ?? null}
      />
    </QueryClientProvider>,
  )
}

/** 等待附件策略加载完成并返回可用的文件输入。 */
async function readyFileInput() {
  const input = (await screen.findByLabelText('选择文件')) as HTMLInputElement
  await waitFor(() => expect(input).not.toBeDisabled())
  return input
}

describe('RequirementForm', () => {
  it('使用表单弹窗布局：固定标题栏与底部操作栏，仅内容区滚动', async () => {
    renderForm()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('data-layout', 'form')
    // 宽度与高度由共享样式类统一约束，测试只校验使用的布局类。
    expect(dialog.className).toContain('form-dialog-content')
    const body = dialog.querySelector('[data-slot="dialog-form-body"]')
    const header = dialog.querySelector('[data-slot="dialog-form-header"]')
    const footer = dialog.querySelector('[data-slot="dialog-form-footer"]')
    expect(header?.className).toContain('border-b')
    expect(body?.className).toContain('overflow-y-auto')
    expect(footer?.className).toContain('border-t')
    expect(body?.contains(header)).toBe(false)
    expect(body?.contains(footer)).toBe(false)
  })

  it('按基本信息、负责人与协作人、附件分组，控件与文本域使用统一尺寸', async () => {
    renderForm()
    expect(screen.getByRole('region', { name: '基本信息' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '负责人与协作人' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '附件' })).toBeInTheDocument()
    const basicSection = screen.getByRole('region', { name: '基本信息' })
    expect(within(basicSection).getByRole('textbox', { name: /标题/ })).toHaveClass('h-9')
    expect(within(basicSection).getByRole('textbox', { name: /正文/ })).toHaveClass('min-h-27')
    expect(screen.getByRole('combobox', { name: '协作人员' })).toBeInTheDocument()
  })

  it('校验失败时展示字段级错误，滚动并聚焦首个错误字段', async () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts[0]).toHaveTextContent('请填写需求标题')
    expect(screen.getByRole('textbox', { name: /标题/ })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: /标题/ })).toHaveAttribute('aria-invalid', 'true')
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('标题填写后继续定位到正文错误', async () => {
    renderForm()
    await userEvent.type(screen.getByRole('textbox', { name: /标题/ }), '导入失败时提示不明确')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写需求正文')
    expect(screen.getByRole('textbox', { name: /正文/ })).toHaveFocus()
  })

  it('切换内容方式时条件字段替换且不保留占位', async () => {
    renderForm()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /内容方式/ }), 'external_link')
    expect(screen.queryByRole('textbox', { name: /正文/ })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /外部链接/ })).toBeInTheDocument()
  })

  it('协作人员复用成员多选：候选带角色，选中后以标签展示', async () => {
    renderForm()
    await userEvent.click(screen.getByLabelText('搜索姓名或邮箱'))
    const listbox = await screen.findByRole('listbox', { name: '候选成员' })
    const option = within(listbox).getByRole('option', { name: /测试用户/ })
    expect(option).toHaveTextContent('管理员')
    await userEvent.click(option)
    expect(await screen.findByRole('button', { name: '移除 测试用户' })).toBeInTheDocument()
    expect(screen.getByText(/已选 1 人/)).toBeInTheDocument()
  })
})

describe('RequirementForm 附件接入', () => {
  it('附件上传完成后提交体包含 attachmentIds', async () => {
    let submittedBody: unknown = null
    server.use(
      http.post('*/api/v1/projects/project-1/attachments', () => success({ attachment: uploadedAttachmentFixture })),
      http.post('*/api/v1/projects/project-1/requirements', async ({ request }) => {
        submittedBody = await request.json()
        return success({ id: 'req-1' })
      }),
    )
    const onOpenChange = vi.fn()
    renderForm({ onOpenChange })
    const input = await readyFileInput()
    await userEvent.upload(input, new File(['evidence'], '复现.log', { type: 'text/plain' }))
    expect(await screen.findByText(/已上传/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: /标题/ }), '带附件的需求')
    await userEvent.type(screen.getByRole('textbox', { name: /正文/ }), '正文内容')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(submittedBody).not.toBeNull())
    expect(submittedBody).toMatchObject({ attachmentIds: ['att-1'], collaboratorUserIds: [] })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('存在上传中附件时禁用保存，完成后恢复', async () => {
    server.use(
      http.post('*/api/v1/projects/project-1/attachments', async () => {
        await delay(300)
        return success({ attachment: uploadedAttachmentFixture })
      }),
    )
    renderForm()
    const input = await readyFileInput()
    await userEvent.upload(input, new File(['evidence'], '复现.log', { type: 'text/plain' }))
    expect(screen.getByText('请先完成附件上传或移除失败附件。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled(), { timeout: 3000 })
  })

  it('提交失败时保留已填内容与已上传附件', async () => {
    server.use(
      http.post('*/api/v1/projects/project-1/attachments', () => success({ attachment: uploadedAttachmentFixture })),
      http.post('*/api/v1/projects/project-1/requirements', () =>
        HttpResponse.json(
          { success: false, code: 'FORBIDDEN', message: '无权限', requestId: 'trace' },
          { headers: { 'x-request-id': 'trace' } },
        ),
      ),
    )
    renderForm()
    const input = await readyFileInput()
    await userEvent.upload(input, new File(['evidence'], '复现.log', { type: 'text/plain' }))
    expect(await screen.findByText(/已上传/)).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: /标题/ }), '保留输入的需求')
    await userEvent.type(screen.getByRole('textbox', { name: /正文/ }), '正文内容')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('当前角色无权执行该操作。')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /标题/ })).toHaveValue('保留输入的需求')
    expect(screen.getByText(/已上传/)).toBeInTheDocument()
  })

  it('编辑时提交最终保留的 attachmentIds，移除的附件不再提交', async () => {
    let submittedBody: unknown = null
    server.use(
      http.post('*/api/v1/requirements/req-1/update', async ({ request }) => {
        submittedBody = await request.json()
        return success({ id: 'req-1' })
      }),
    )
    renderForm({ requirement: editingRequirement })
    expect(await screen.findByText('旧截图.png')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '移除 旧截图.png' }))
    expect(screen.queryByText('旧截图.png')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(submittedBody).not.toBeNull())
    expect(submittedBody).toMatchObject({ attachmentIds: ['att-2'], version: 2 })
  })
})
