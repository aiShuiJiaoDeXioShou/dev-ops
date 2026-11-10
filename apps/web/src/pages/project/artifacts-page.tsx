import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { apiClient } from '@/shared/api/client'
import { useSession } from '@/features/identity/public'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { useToast } from '@/shared/ui/toast'
import { projectServicesQueryOptions } from '@/features/projects/public'
import {
  BuildDetailPanel,
  BuildReportDialog,
  projectArtifactsQueryOptions,
  ReviewReleaseSection,
  runVersionsQueryOptions,
} from '@/features/delivery/public'
import { describeRequestError } from '@/shared/api/errors'
import { EmptyState, PageLoading } from '@/shared/ui/page-state'
import { PageSkeleton } from '@/shared/ui/page-skeleton'

const ENVIRONMENTS = [
  { value: 'development', label: '开发' },
  { value: 'test', label: '测试' },
  { value: 'production', label: '生产' },
] as const
const STATUS_LABELS: Record<string, string> = {
  available: '可用',
  expired: '已失效',
  invalid: '无效',
  confirmed: '已确认',
  pending: '待核对',
  unknown: '未知',
}

/** 产物与版本页：按服务/环境查看最新与历史产物，并确认运行版本。 */
export function Component() {
  const { projectId = '' } = useParams()
  const { role } = useSession()
  const canManage = role === 'admin' || role === 'developer'
  const [environment, setEnvironment] = useState<'development' | 'test' | 'production'>('test')
  const [selectedBuildId, setSelectedBuildId] = useState('')
  const [reportOpen, setReportOpen] = useState(false)
  const services = useQuery(projectServicesQueryOptions(projectId))
  const artifacts = useQuery(
    projectArtifactsQueryOptions(projectId, { environment, latest: 'true', page: 1, pageSize: 50 }),
  )
  const firstServiceId = services.data?.data[0]?.id ?? ''
  const runVersions = useQuery(runVersionsQueryOptions(projectId, firstServiceId))
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [confirmTarget, setConfirmTarget] = useState<{
    environment: string
    version: number
    versionLabel: string | null
  } | null>(null)
  const [versionLabelInput, setVersionLabelInput] = useState('')
  const [confirmReason, setConfirmReason] = useState('')
  useEffect(() => {
    setVersionLabelInput(confirmTarget?.versionLabel ?? '')
    setConfirmReason('')
  }, [confirmTarget])
  const confirmVersion = useMutation({
    mutationFn: async () => {
      if (!confirmTarget || !firstServiceId) throw new Error('缺少服务或环境')
      return apiClient.confirmRunVersion(projectId, firstServiceId, confirmTarget.environment, {
        version: confirmTarget.version,
        versionLabel: versionLabelInput.trim(),
        source: 'manual',
        verificationStatus: 'confirmed',
        ...(confirmTarget.version === 0 ? {} : { reason: confirmReason.trim() || undefined }),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', 'run-versions', projectId, firstServiceId] })
      setConfirmTarget(null)
      showToast('运行版本已确认。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  if (services.isPending) return <PageSkeleton />
  if (services.isError) {
    const described = describeRequestError(services.error)
    return (
      <EmptyState
        title="产物与版本加载失败"
        description={described.description}
        action={
          <Button type="button" onClick={() => void services.refetch()}>
            重新加载
          </Button>
        }
      />
    )
  }

  return (
    <div className="project-tab-panel">
      <div className="row spread">
        <div className="segments" role="tablist" aria-label="环境">
          {ENVIRONMENTS.map((item) => (
            <Button
              key={item.value}
              type="button"
              variant="ghost"
              size="sm"
              className={`segment ${environment === item.value ? 'active' : ''}`}
              role="tab"
              aria-selected={environment === item.value}
              onClick={() => setEnvironment(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        {canManage ? (
          <Button type="button" variant="default" onClick={() => setReportOpen(true)}>
            上报构建
          </Button>
        ) : null}
      </div>

      {firstServiceId ? (
        <section aria-label="运行版本" className="project-summary-section">
          <h3>运行版本</h3>
          {runVersions.isPending ? (
            <PageLoading />
          ) : runVersions.isError ? (
            <p className="muted">运行版本加载失败，请重试。</p>
          ) : (
            <ul className="plain-list">
              {runVersions.data.data.items.map((item) => (
                <li key={item.environment}>
                  <span className="muted">{ENVIRONMENTS.find((env) => env.value === item.environment)?.label}</span>
                  <span>{item.versionLabel ?? '未知版本'}</span>
                  <span className="tag">{STATUS_LABELS[item.verificationStatus] ?? item.verificationStatus}</span>
                  <span className="muted">{item.confirmedAt ?? '尚未确认'}</span>
                  {canManage ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setConfirmTarget({
                          environment: item.environment,
                          version: item.version,
                          versionLabel: item.versionLabel,
                        })
                      }
                    >
                      确认/更正
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section aria-label="产物">
        <h3>最新构建产物</h3>
        {artifacts.isPending ? (
          <PageLoading />
        ) : artifacts.isError ? (
          <EmptyState title="产物加载失败" description={describeRequestError(artifacts.error).description} />
        ) : artifacts.data.data.items.length === 0 ? (
          <EmptyState title="暂无产物" description="上报构建后，安装包、二维码或测试地址会出现在这里。" />
        ) : (
          <ul className="artifact-list">
            {artifacts.data.data.items.map((artifact) => (
              <li key={artifact.id} className="artifact-item">
                <div>
                  <strong>{artifact.versionLabel}</strong>
                  <span className="muted"> {artifact.artifactType}</span>
                </div>
                <div className="row">
                  {artifact.status === 'available' ? (
                    <a href={artifact.accessUrl} target="_blank" rel="noreferrer" className="btn">
                      打开产物
                    </a>
                  ) : (
                    <span className="tag">{STATUS_LABELS[artifact.status] ?? artifact.status}</span>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedBuildId(artifact.buildId)}>
                    构建详情
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReviewReleaseSection projectId={projectId} />

      {selectedBuildId ? (
        <section aria-label="构建详情">
          <BuildDetailPanel buildId={selectedBuildId} />
        </section>
      ) : null}

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => (open ? undefined : setConfirmTarget(null))}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!versionLabelInput.trim()) return showToast('请填写版本标识。', 'error')
              confirmVersion.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>确认运行版本</DialogTitle>
            </DialogHeader>
            <label className="block space-y-1.5 text-sm font-medium">
              版本标识
              <Input
                value={versionLabelInput}
                onChange={(event) => setVersionLabelInput(event.target.value)}
                maxLength={200}
                autoFocus
              />
            </label>
            {confirmTarget && confirmTarget.version > 0 ? (
              <label className="block space-y-1.5 text-sm font-medium">
                更正原因
                <Input
                  value={confirmReason}
                  onChange={(event) => setConfirmReason(event.target.value)}
                  maxLength={1000}
                />
              </label>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmTarget(null)}>
                取消
              </Button>
              <Button type="submit" disabled={confirmVersion.isPending}>
                {confirmVersion.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <BuildReportDialog
        projectId={projectId}
        open={reportOpen}
        onOpenChange={setReportOpen}
        onSaved={(buildId) => setSelectedBuildId(buildId)}
      />
    </div>
  )
}
