import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Combobox } from './combobox'

const options = [
  { value: 'repo-1', label: 'acme/dev-ops' },
  { value: 'repo-2', label: 'acme/lkwg' },
]

describe('Combobox', () => {
  it('展开面板顶部提供搜索并选择选项', async () => {
    const onValueChange = vi.fn()
    render(
      <Combobox
        value=""
        onValueChange={onValueChange}
        options={options}
        placeholder="选择仓库"
        searchPlaceholder="搜索仓库"
      />,
    )
    await userEvent.click(screen.getByRole('combobox', { name: '选择仓库' }))
    await userEvent.type(await screen.findByLabelText('搜索仓库'), 'lkwg')
    await userEvent.click(await screen.findByRole('option', { name: 'acme/lkwg' }))
    expect(onValueChange).toHaveBeenCalledWith('repo-2')
  })

  it('没有匹配项时显示空提示', async () => {
    render(<Combobox value="" onValueChange={() => undefined} options={options} searchPlaceholder="搜索" />)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.type(await screen.findByLabelText('搜索'), 'missing')
    expect(await screen.findByText('没有匹配项')).toBeInTheDocument()
  })
})
