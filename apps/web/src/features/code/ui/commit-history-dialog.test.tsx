import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, success } from '@/test/server'
import { CommitHistoryDialog } from './commit-history-dialog'

const commitSummary = {
  sha: 'abc1234def',
  title: '修复交付上报',
  authorName: '测试用户',
  committedAt: '2026-11-10T08:00:00.000Z',
  url: null,
  lastCheckedAt: '2026-11-10T09:00:00.000Z',
}

describe('CommitHistoryDialog', () => {
  it('展示提交列表与变更文件', async () => {
    server.use(
      http.get('*/api/v1/projects/project-1/repositories/repo-1/commits', () =>
        success({ items: [commitSummary], page: 1, pageSize: 30, total: 1 }),
      ),
      http.get('*/api/v1/projects/project-1/repositories/repo-1/commits/abc1234def', () =>
        success({
          ...commitSummary,
          files: [{ path: 'src/a.ts', status: 'modified', additions: 3, deletions: 1 }],
          filesTruncated: false,
          filesUnsupported: false,
        }),
      ),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <CommitHistoryDialog
          projectId="project-1"
          repositoryId="repo-1"
          ref="main"
          open
          onOpenChange={() => undefined}
        />
      </QueryClientProvider>,
    )
    await userEvent.click(await screen.findByRole('button', { name: /abc1234/ }))
    expect(await screen.findByText('src/a.ts')).toBeInTheDocument()
    expect(screen.getByText(/\+3 \/ -1/)).toBeInTheDocument()
  })
})
