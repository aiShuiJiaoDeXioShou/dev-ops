import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { SessionProvider } from '@/features/identity/public'
import { createQueryClient } from '@/shared/api/query-client'
import { server, sessionFixture, success, teamFixture } from '@/test/server'
import { localBucketFixture } from '@/test/storage-handlers'
import { Component as StorageBucketsPage } from './storage-buckets-page'

describe('储存桶管理页', () => {
  it('非平台管理员只看到权限说明，不请求储存桶列表', async () => {
    let listRequests = 0
    server.use(
      http.get('*/api/v1/me/teams', () =>
        success({ teams: [{ ...teamFixture, role: 'admin' }], isPlatformAdmin: false }),
      ),
      http.get('*/api/v1/platform/storage-buckets', () => {
        listRequests += 1
        return success({ buckets: [localBucketFixture] })
      }),
    )
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SessionProvider initialUser={sessionFixture.user}>
          <StorageBucketsPage />
        </SessionProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByText('仅平台管理员可管理储存桶')).toBeInTheDocument()
    await waitFor(() => expect(listRequests).toBe(0))
  })
})
