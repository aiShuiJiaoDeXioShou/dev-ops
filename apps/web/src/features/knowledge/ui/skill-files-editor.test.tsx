import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SkillFilesEditor } from './skill-files-editor'

describe('SkillFilesEditor', () => {
  it('添加文本资源文件后回调新文件', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<SkillFilesEditor files={[]} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /添加文件/ }))
    await user.type(screen.getByLabelText('相对路径'), 'references/checklist.md')
    await user.type(screen.getByLabelText('文件内容'), '- 检查风险')
    await user.click(screen.getByRole('button', { name: '保存文件' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange.mock.calls[0]?.[0]).toEqual([
      { path: 'references/checklist.md', content: '- 检查风险', encoding: 'utf8' },
    ])
  })

  it('路径包含穿越段时提示错误且不回调', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<SkillFilesEditor files={[]} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /添加文件/ }))
    await user.type(screen.getByLabelText('相对路径'), '../secret.md')
    await user.type(screen.getByLabelText('文件内容'), 'secret')
    await user.click(screen.getByRole('button', { name: '保存文件' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('路径只能包含')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('展示已有资源文件与大小', () => {
    render(
      <SkillFilesEditor
        files={[{ path: 'scripts/lint.sh', content: 'echo ok', encoding: 'utf8' }]}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText('scripts/lint.sh')).toBeInTheDocument()
    expect(screen.getByText('文本')).toBeInTheDocument()
  })
})
