import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  MemberMultiSelect,
  type MemberMultiSelectProps,
  type MemberOption,
  type MemberSelectionDetail,
} from './member-multiselect'

const options: MemberOption[] = [
  { userId: 'user-1', name: '李艳', email: 'liyan@example.test', role: 'admin', status: 'active', available: true },
  {
    userId: 'user-2',
    name: '范东晓',
    email: 'fandongxiao@example.test',
    role: 'developer',
    status: 'active',
    available: true,
  },
  { userId: 'user-3', name: '王远', email: 'wangyuan@example.test', role: 'viewer', status: 'active', available: true },
]

type HarnessProps = Partial<MemberMultiSelectProps> & {
  initialValues?: string[]
  initialDetails?: MemberSelectionDetail[]
}

function Harness({ initialValues = [], initialDetails, ...props }: HarnessProps) {
  const [values, setValues] = useState(initialValues)
  return (
    <MemberMultiSelect
      values={values}
      onValuesChange={setValues}
      options={options}
      selectedDetails={initialDetails}
      {...props}
    />
  )
}

describe('MemberMultiSelect', () => {
  it('聚焦展开候选，显示角色与已选计数，按姓名检索后回车选中', async () => {
    render(<Harness />)
    const input = screen.getByLabelText('搜索姓名或邮箱')
    await userEvent.click(input)
    expect(await screen.findByRole('listbox', { name: '候选成员' })).toBeInTheDocument()
    expect(screen.getByText('管理员')).toBeInTheDocument()
    await userEvent.type(input, '范东')
    expect(screen.queryByText('李艳')).not.toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('button', { name: '移除 范东晓' })).toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(screen.getByText('已选 1/20')).toBeInTheDocument()
  })

  it('按邮箱检索无匹配时显示清除检索入口并恢复全量', async () => {
    render(<Harness />)
    const input = screen.getByLabelText('搜索姓名或邮箱')
    await userEvent.click(input)
    await userEvent.type(input, 'not-exists')
    expect(await screen.findByText('无匹配成员')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '清除检索' }))
    expect(await screen.findByText('李艳')).toBeInTheDocument()
  })

  it('方向键移动高亮并用空格选中，退格移除最后一个标签', async () => {
    render(<Harness />)
    const input = screen.getByLabelText('搜索姓名或邮箱')
    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{ }')
    expect(await screen.findByRole('button', { name: '移除 范东晓' })).toBeInTheDocument()
    await userEvent.keyboard('{Backspace}')
    expect(screen.queryByRole('button', { name: '移除 范东晓' })).not.toBeInTheDocument()
  })

  it('Esc 关闭面板且焦点回到输入框', async () => {
    render(<Harness />)
    const input = screen.getByLabelText('搜索姓名或邮箱')
    await userEvent.click(input)
    expect(await screen.findByRole('listbox', { name: '候选成员' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox', { name: '候选成员' })).not.toBeInTheDocument()
    expect(input).toHaveFocus()
  })

  it('达到上限后停止添加未选项并提示上限', async () => {
    render(<Harness maxSelected={2} />)
    const input = screen.getByLabelText('搜索姓名或邮箱')
    await userEvent.click(input)
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')
    expect(screen.getAllByRole('button', { name: /^移除 / })).toHaveLength(2)
    expect(await screen.findByText('最多选择 2 人')).toBeInTheDocument()
    const thirdOption = screen.getByRole('option', { name: /王远/ })
    expect(thirdOption).toBeDisabled()
    await userEvent.click(thirdOption)
    expect(screen.getAllByRole('button', { name: /^移除 / })).toHaveLength(2)
  })

  it('加载中覆盖空候选，不以“暂无可选成员”冒充', async () => {
    render(<Harness loading />)
    await userEvent.click(screen.getByLabelText('搜索姓名或邮箱'))
    expect(await screen.findByText('成员加载中…')).toBeInTheDocument()
    expect(screen.queryByText('暂无可选成员')).not.toBeInTheDocument()
  })

  it('候选为空时显示暂无可选成员', async () => {
    render(<Harness options={[]} />)
    await userEvent.click(screen.getByLabelText('搜索姓名或邮箱'))
    expect(await screen.findByText('暂无可选成员')).toBeInTheDocument()
  })

  it('加载失败显示原因与重试入口', async () => {
    const onRetry = vi.fn()
    render(<Harness error="成员加载失败，请重试。" onRetry={onRetry} />)
    await userEvent.click(screen.getByLabelText('搜索姓名或邮箱'))
    expect(await screen.findByText('成员加载失败，请重试。')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('只读时标签无移除按钮且不展开候选', async () => {
    render(<Harness disabled initialValues={['user-1']} />)
    expect(screen.queryByRole('button', { name: '移除 李艳' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('搜索姓名或邮箱')).toBeDisabled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('已失效成员保留在已选区并标记不可用', async () => {
    render(
      <Harness
        initialValues={['user-missing']}
        initialDetails={[{ userId: 'user-missing', name: '已停用成员', status: 'disabled', available: false }]}
      />,
    )
    expect(await screen.findByText('已停用成员')).toBeInTheDocument()
    expect(screen.getByText('已失效')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '移除 已停用成员' }))
    expect(screen.queryByText('已停用成员')).not.toBeInTheDocument()
  })

  it('已选成员保持加入顺序且重复选择不重复加入', async () => {
    render(<Harness initialValues={['user-2']} />)
    const input = screen.getByLabelText('搜索姓名或邮箱')
    await userEvent.click(input)
    await userEvent.type(input, '李艳')
    await userEvent.keyboard('{Enter}')
    const tags = screen.getAllByRole('button', { name: /^移除 / })
    expect(tags[0]).toHaveAccessibleName('移除 范东晓')
    expect(tags[1]).toHaveAccessibleName('移除 李艳')
  })

  it('超长姓名在标签内截断，容器换行避免窄屏横向溢出', async () => {
    const longName = '这是一个非常非常长的成员姓名用于验证窄屏换行与省略'
    render(
      <Harness
        initialValues={['user-long']}
        initialDetails={[{ userId: 'user-long', name: longName, status: 'active', available: true }]}
      />,
    )
    expect(screen.getByText(longName)).toHaveClass('truncate', 'max-w-40')
    expect(screen.getByRole('combobox')).toHaveClass('flex-wrap', 'w-full')
  })
})
