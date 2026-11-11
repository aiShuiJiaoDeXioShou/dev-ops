import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, success } from '@/test/server'
import { BugForm } from './bug-form'

/** 上传成功时固定返回的临时附件摘要，便于断言提交体。 */
const uploadedAttachmentFixture = {
  id: 'att-1',
  fileName: '截图.png',
  sizeBytes: 8,
  contentType: 'image/png',
  sha256: 'a'.repeat(64),
  status: 'temp',
  uploadedAt: '2026-11-11T00:00:00.000Z',
}

/** 等待附件策略加载完成并返回可用的文件输入。 */
async function readyFileInput() {
  const input = (await screen.findByLabelText('选择文件')) as HTMLInputElement
  await waitFor(() => expect(input).not.toBeDisabled())
  return input
}

/** 填写缺陷建单必填字段。 */
async function fillRequiredFields(title = '附件缺陷') {
  await userEvent.type(screen.getByRole('textbox', { name: /标题/ }), title)
  await userEvent.type(screen.getByRole('textbox', { name: /现象/ }), '现象描述')
  await userEvent.type(screen.getByRole('textbox', { name: /预期行为/ }), '预期行为')
  await userEvent.type(screen.getByRole('textbox', { name: /复现步骤/ }), '步骤')
}

// jsdom 未实现 ResizeObserver；Radix Checkbox 的指示器尺寸监听在测试环境需要桩实现。
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub
}

function renderForm() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <BugForm projectId="project-1" teamId="team-1" open onOpenChange={() => undefined} />
    </QueryClientProvider>,
  )
}

describe('BugForm', () => {
  it('建单必填项缺失时本地校验阻止提交并聚焦首个错误字段', async () => {
    renderForm()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts[0]).toHaveTextContent('请填写 Bug 标题')
    expect(screen.getByRole('textbox', { name: /标题/ })).toHaveFocus()
  })

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

  it('按分组渲染字段：标题、现象、预期、负责人与协作人、附件', async () => {
    renderForm()
    const basicSection = screen.getByRole('region', { name: '基本信息' })
    expect(within(basicSection).getByRole('textbox', { name: /标题/ })).toHaveClass('h-9')
    expect(within(basicSection).getByRole('textbox', { name: /现象/ })).toHaveClass('min-h-27')
    expect(within(basicSection).getByRole('textbox', { name: /预期行为/ })).toHaveClass('min-h-22')
    expect(screen.getByRole('region', { name: '负责人与协作人' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '附件' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '协作人员' })).toBeInTheDocument()
  })

  it('勾选无法稳定复现后隐藏复现步骤，取消勾选后恢复且不留空占位', async () => {
    renderForm()
    const unknownCheckbox = screen.getByRole('checkbox', { name: '无法稳定复现，已记录现象' })
    expect(screen.getByRole('textbox', { name: /复现步骤/ })).toBeInTheDocument()
    await userEvent.click(unknownCheckbox)
    expect(screen.queryByRole('textbox', { name: /复现步骤/ })).not.toBeInTheDocument()
    await userEvent.click(unknownCheckbox)
    expect(screen.getByRole('textbox', { name: /复现步骤/ })).toBeInTheDocument()
  })

  it('标题填写后继续定位到现象错误', async () => {
    renderForm()
    await userEvent.type(screen.getByRole('textbox', { name: /标题/ }), '附件上传后列表为空')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts[0]).toHaveTextContent('请填写现象')
    expect(screen.getByRole('textbox', { name: /现象/ })).toHaveFocus()
  })

  it('协作人员选择后以标签展示并保留失效标记能力', async () => {
    renderForm()
    await userEvent.click(screen.getByLabelText('搜索姓名或邮箱'))
    const listbox = await screen.findByRole('listbox', { name: '候选成员' })
    await userEvent.click(within(listbox).getByRole('option', { name: /测试用户/ }))
    expect(await screen.findByRole('button', { name: '移除 测试用户' })).toBeInTheDocument()
  })
})

describe('BugForm 附件接入', () => {
  it('从需求详情快捷创建时附件与协作人只归属新缺陷', async () => {
    let submittedBody: unknown = null
    server.use(
      http.post('*/api/v1/projects/project-1/attachments', () => success({ attachment: uploadedAttachmentFixture })),
      http.post('*/api/v1/projects/project-1/bugs', async ({ request }) => {
        submittedBody = await request.json()
        return success({ id: 'bug-1' })
      }),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BugForm projectId="project-1" teamId="team-1" open onOpenChange={() => undefined} requirementId="req-1" />
      </QueryClientProvider>,
    )
    const input = await readyFileInput()
    await userEvent.upload(input, new File(['shot'], '截图.png', { type: 'image/png' }))
    expect(await screen.findByText(/已上传/)).toBeInTheDocument()
    await fillRequiredFields()
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(submittedBody).not.toBeNull())
    expect(submittedBody).toMatchObject({
      attachmentIds: ['att-1'],
      collaboratorUserIds: [],
      requirementIds: ['req-1'],
    })
  })

  it('提交失败时保留已填内容与已上传附件', async () => {
    server.use(
      http.post('*/api/v1/projects/project-1/attachments', () => success({ attachment: uploadedAttachmentFixture })),
      http.post('*/api/v1/projects/project-1/bugs', () =>
        HttpResponse.json(
          { success: false, code: 'ATTACHMENT_STORAGE_UNAVAILABLE', message: '存储不可用', requestId: 'trace' },
          { headers: { 'x-request-id': 'trace' } },
        ),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BugForm projectId="project-1" teamId="team-1" open onOpenChange={() => undefined} />
      </QueryClientProvider>,
    )
    const input = await readyFileInput()
    await userEvent.upload(input, new File(['shot'], '截图.png', { type: 'image/png' }))
    expect(await screen.findByText(/已上传/)).toBeInTheDocument()
    await fillRequiredFields('保留输入的缺陷')
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('附件存储暂时不可用，请联系平台管理员。')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /标题/ })).toHaveValue('保留输入的缺陷')
    expect(screen.getByText(/已上传/)).toBeInTheDocument()
  })
})
