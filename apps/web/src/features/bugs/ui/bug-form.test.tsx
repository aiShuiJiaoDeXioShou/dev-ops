import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { BugForm } from './bug-form'

describe('BugForm', () => {
  it('建单必填项缺失时本地校验阻止提交', async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BugForm projectId="project-1" teamId="team-1" open onOpenChange={() => undefined} />
      </QueryClientProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('请填写 Bug 标题')
  })
})
