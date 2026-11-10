import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { createQueryClient } from '@/shared/api/query-client'
import { server, success } from '@/test/server'
import { BuildDetailPanel } from './build-detail-panel'

const buildFixture = {
  id: 'build-1',
  projectId: 'project-1',
  serviceId: null,
  environment: 'test',
  buildKey: 'ci-100',
  versionLabel: '1.0.0',
  commitRef: 'abc1234',
  source: 'pipeline',
  sourceRunId: null,
  collectedAt: '2026-11-10T08:00:00.000Z',
  resultStatus: 'succeeded',
  note: '构建成功',
  artifacts: [
    {
      id: 'artifact-1',
      artifactType: 'web_test_url',
      versionLabel: '1.0.0',
      accessUrl: 'https://test.example.test',
      source: 'pipeline',
      collectedAt: '2026-11-10T08:00:00.000Z',
      status: 'available',
      note: null,
    },
  ],
  targets: [],
  corrections: [],
  version: 1,
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-10T08:00:00.000Z',
}

describe('BuildDetailPanel', () => {
  it('展示构建来源、产物与空关联说明', async () => {
    server.use(http.get('*/api/v1/builds/build-1', () => success(buildFixture)))
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BuildDetailPanel buildId="build-1" />
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('heading', { name: '1.0.0' })).toBeInTheDocument()
    expect(screen.getByText('ci-100')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '1.0.0' })).toHaveAttribute('href', 'https://test.example.test')
    expect(screen.getByText(/尚未关联需求或 Bug/)).toBeInTheDocument()
  })
})
