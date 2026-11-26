import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, useSearchParams } from 'react-router'
import { CheckCircle2, ExternalLink, Globe, Package, Plus, QrCode, Search, Smartphone } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { isNestedInteractiveTarget } from '@/shared/lib/clickable'
import { formatDateTime } from '@/shared/lib/format'
import { useSession } from '@/features/identity/model/session'
import { projectServicesQueryOptions } from '@/features/projects/api/queries'
import { projectArtifactsQueryOptions, runVersionsQueryOptions } from '@/features/delivery/api/artifact-queries'
import { BuildDetailPanel } from '@/features/delivery/ui/build-detail-panel'
import { BuildReportDialog } from '@/features/delivery/ui/build-report-dialog'
import { ReviewReleaseSection } from '@/features/delivery/ui/review-release-section'
import { ArtifactsPageSkeleton } from '@/pages/page-skeletons'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/controls/sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { CompactListSkeleton, TableSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { StatusBadge, type StatusTone } from '@/shared/ui/status-badge'
import { useToast } from '@/shared/ui/toast'
import '@/features/delivery/ui/delivery.css'

const ENVIRONMENTS = [
  { value: 'development', label: '开发' },
  { value: 'test', label: '测试' },
  { value: 'production', label: '生产' },
] as const

/** 产物筛选环境；「全部」用于展示未指定环境的构建产物。 */
const ARTIFACT_ENVIRONMENTS = [{ value: 'all', label: '全部' }, ...ENVIRONMENTS] as const
type ArtifactEnvironment = (typeof ARTIFACT_ENVIRONMENTS)[number]['value']

/** 页面内视图页签；构建产物与外部审核发布是两条独立链路，不在同一屏纵向堆叠。 */
type ArtifactsTab = 'builds' | 'review'

const TAB_PARAM = 'tab'

const ARTIFACTS_TABS: { value: ArtifactsTab; label: string }[] = [
  { value: 'builds', label: '构建产物' },
  { value: 'review', label: '审核与发布' },
]

const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  mobile_package: '移动安装包',
  mini_program_qr: '小程序二维码',
  web_test_url: '测试地址',
}

const SOURCE_LABELS: Record<string, string> = {
  pipeline: '流水线',
  manual: '人工上报',
  local: '本地构建',
  external_system: '外部系统',
}

const RUN_VERSION_SOURCE_LABELS: Record<string, string> = {
  deployment_receipt: '部署回执',
  manual: '手动确认',
}

const STATUS_LABELS: Record<string, string> = {
  available: '可用',
  expired: '已失效',
  invalid: '无效',
  confirmed: '已确认',
  pending: '待核对',
  unknown: '未知',
}

function renderArtifactTypeIcon(type: string) {
  switch (type) {
    case 'mobile_package':
      return <Smartphone size={14} className="text-muted-foreground" aria-hidden="true" />
    case 'mini_program_qr':
      return <QrCode size={14} className="text-muted-foreground" aria-hidden="true" />
    default:
      return <Globe size={14} className="text-muted-foreground" aria-hidden="true" />
  }
}

function artifactStatusTone(status: string): StatusTone {
  if (status === 'available') return 'success'
  if (status === 'expired') return 'warning'
  return 'danger'
}

/**
 * 产物与版本页：按服务切换查看三环境运行版本卡片，按环境/类型/最新版本/关键词筛选构建产物，
 * 并通过右侧抽屉查看构建详情与更正历史。
 */
export function Component() {
  const { projectId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const { role } = useSession()
  const canManage = role === 'admin' || role === 'developer'
  const tab: ArtifactsTab = searchParams.get(TAB_PARAM) === 'review' ? 'review' : 'builds'

  const [selectedServiceId, setSelectedServiceId] = useState('')
  const [environment, setEnvironment] = useState<ArtifactEnvironment>('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [latestOnly, setLatestOnly] = useState(true)
  const [keyword, setKeyword] = useState('')
  const [selectedBuildId, setSelectedBuildId] = useState('')
  const [reportOpen, setReportOpen] = useState(false)

  const services = useQuery(projectServicesQueryOptions(projectId))
  const serviceItems = services.data?.data ?? []
  const activeServiceId = serviceItems.find((item) => item.id === selectedServiceId)?.id ?? serviceItems[0]?.id ?? ''
  const activeService = serviceItems.find((item) => item.id === activeServiceId) ?? null
  const serviceNameById = useMemo(() => new Map(serviceItems.map((item) => [item.id, item.name])), [serviceItems])

  const artifacts = useQuery(
    projectArtifactsQueryOptions(projectId, {
      ...(environment === 'all' ? {} : { environment }),
      ...(latestOnly ? { latest: 'true' } : {}),
      page: 1,
      pageSize: 50,
    }),
  )
  const runVersions = useQuery(runVersionsQueryOptions(projectId, activeServiceId))

  const queryClient = useQueryClient()
  const { showToast } = useToast()

  const changeTab = (next: ArtifactsTab) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'builds') params.delete(TAB_PARAM)
    else params.set(TAB_PARAM, next)
    setSearchParams(params)
  }

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
      if (!confirmTarget || !activeServiceId) throw new Error('缺少服务或环境')
      return apiClient.confirmRunVersion(projectId, activeServiceId, confirmTarget.environment, {
        version: confirmTarget.version,
        versionLabel: versionLabelInput.trim(),
        source: 'manual',
        verificationStatus: 'confirmed',
        ...(confirmTarget.version === 0 ? {} : { reason: confirmReason.trim() || undefined }),
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['delivery', 'run-versions', projectId, activeServiceId] })
      setConfirmTarget(null)
      showToast('运行版本已确认。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const rawArtifacts = artifacts.data?.data.items ?? []
  const filteredArtifacts = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    return rawArtifacts.filter((item) => {
      if (typeFilter && item.artifactType !== typeFilter) return false
      if (!q) return true
      const serviceName = item.serviceId ? (serviceNameById.get(item.serviceId) ?? '') : ''
      return `${item.versionLabel} ${item.note ?? ''} ${serviceName}`.toLowerCase().includes(q)
    })
  }, [rawArtifacts, typeFilter, keyword, serviceNameById])

  const hasLocalFilter = Boolean(typeFilter || keyword.trim() || environment !== 'all' || !latestOnly)

  if (services.isPending) return <ArtifactsPageSkeleton />
  if (services.isError && !services.data) {
    return (
      <PageError
        title="产物与版本加载失败"
        error={services.error}
        retrying={services.isFetching}
        retryLabel="重新加载"
        onRetry={() => void services.refetch()}
      />
    )
  }

  return (
    <div className="project-tab-panel">
      <div className="dlv-root">
        <div className="dlv-top-bar">
          <div className="segments" role="tablist" aria-label="产物视图">
            {ARTIFACTS_TABS.map((item) => (
              <Button
                key={item.value}
                type="button"
                variant="ghost"
                size="sm"
                className={`segment ${tab === item.value ? 'active' : ''}`}
                role="tab"
                id={`artifacts-tab-${item.value}`}
                aria-selected={tab === item.value}
                aria-controls={`artifacts-panel-${item.value}`}
                onClick={() => changeTab(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>

          <div className="dlv-top-actions">
            {tab === 'builds' && serviceItems.length > 1 ? (
              <label className="dlv-service-picker">
                <span>服务</span>
                <Select
                  aria-label="切换服务"
                  className="dlv-service-select"
                  value={activeServiceId}
                  onChange={(event) => setSelectedServiceId(event.target.value)}
                >
                  {serviceItems.map((svc) => (
                    <option key={svc.id} value={svc.id}>
                      {svc.name}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}

            {tab === 'builds' && canManage ? (
              <Button type="button" size="sm" onClick={() => setReportOpen(true)}>
                <Plus size={14} aria-hidden="true" />
                上报构建
              </Button>
            ) : null}
          </div>
        </div>

        <div
          role="tabpanel"
          id={`artifacts-panel-${tab}`}
          aria-labelledby={`artifacts-tab-${tab}`}
          className="space-y-6"
        >
          {tab === 'builds' ? (
            <>
              {activeServiceId ? (
                <section aria-label="运行版本" className="dlv-section">
                  <div className="dlv-section-head">
                    <div className="dlv-section-title">
                      <h3>运行版本</h3>
                      {activeService ? <Badge variant="secondary">{activeService.name}</Badge> : null}
                    </div>
                    <span className="text-xs text-muted-foreground">开发 / 测试 / 生产当前运行版本核对状态</span>
                  </div>

                  {runVersions.isPending ? (
                    <CompactListSkeleton rows={3} trailing bordered label="运行版本加载中" />
                  ) : runVersions.isError && !runVersions.data ? (
                    <PageError
                      title="运行版本加载失败"
                      error={runVersions.error}
                      retrying={runVersions.isFetching}
                      retryLabel="重新加载"
                      onRetry={() => void runVersions.refetch()}
                    />
                  ) : (
                    <div className="dlv-env-grid">
                      {runVersions.data.data.items.map((item) => {
                        const environmentLabel =
                          ENVIRONMENTS.find((env) => env.value === item.environment)?.label ?? item.environment
                        const tone: StatusTone =
                          item.verificationStatus === 'confirmed'
                            ? 'success'
                            : item.verificationStatus === 'pending'
                              ? 'warning'
                              : 'neutral'
                        const sourceLabel = item.source
                          ? (RUN_VERSION_SOURCE_LABELS[item.source] ?? item.source)
                          : '待记录来源'
                        return (
                          <article className="dlv-env-card" key={item.environment}>
                            <div className="dlv-env-card-head">
                              <span className="dlv-env-name">
                                <span
                                  className={`dlv-env-dot ${
                                    item.verificationStatus === 'confirmed'
                                      ? 'confirmed'
                                      : item.verificationStatus === 'pending'
                                        ? 'pending'
                                        : ''
                                  }`}
                                  aria-hidden="true"
                                />
                                {environmentLabel}环境
                              </span>
                              <StatusBadge tone={tone}>
                                {STATUS_LABELS[item.verificationStatus] ?? item.verificationStatus}
                              </StatusBadge>
                            </div>

                            <div className="dlv-env-version">
                              <strong
                                className={`dlv-env-version-label mono ${item.versionLabel ? '' : 'unknown'}`}
                                title={item.versionLabel ?? undefined}
                              >
                                {item.versionLabel ?? '未知版本'}
                              </strong>
                              <Badge variant="outline" className="mono">
                                v{item.version}
                              </Badge>
                            </div>

                            <div className="dlv-env-meta">
                              <span>{sourceLabel}</span>
                              <span>
                                {item.confirmedAt ? `确认于 ${formatDateTime(item.confirmedAt)}` : '尚未确认'}
                              </span>
                            </div>

                            <div className="dlv-env-actions">
                              {item.source === 'deployment_receipt' && item.evidenceUrl ? (
                                <Button asChild variant="ghost" size="sm">
                                  <a href={item.evidenceUrl} target="_blank" rel="noreferrer">
                                    查看证据
                                    <ExternalLink size={12} aria-hidden="true" />
                                  </a>
                                </Button>
                              ) : null}
                              {canManage ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    setConfirmTarget({
                                      environment: item.environment,
                                      version: item.version,
                                      versionLabel: item.versionLabel,
                                    })
                                  }
                                >
                                  <CheckCircle2 size={13} aria-hidden="true" />
                                  确认/更正
                                </Button>
                              ) : null}
                            </div>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </section>
              ) : null}

              <section aria-label="产物" className="dlv-section">
                <div className="dlv-section-head">
                  <div className="dlv-section-title">
                    <h3>构建产物</h3>
                    <span className="counter">{filteredArtifacts.length}</span>
                  </div>
                </div>

                <div className="dlv-filter-bar">
                  <div className="dlv-filter-group">
                    <div className="segments" role="tablist" aria-label="环境">
                      {ARTIFACT_ENVIRONMENTS.map((item) => (
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

                    <Select
                      aria-label="按产物类型筛选"
                      className="dlv-type-select"
                      value={typeFilter}
                      onChange={(event) => setTypeFilter(event.target.value)}
                    >
                      <option value="">全部类型</option>
                      <option value="web_test_url">测试地址</option>
                      <option value="mobile_package">移动安装包</option>
                      <option value="mini_program_qr">小程序二维码</option>
                    </Select>

                    <Button
                      type="button"
                      variant={latestOnly ? 'secondary' : 'outline'}
                      size="sm"
                      aria-pressed={latestOnly}
                      onClick={() => setLatestOnly((prev) => !prev)}
                    >
                      {latestOnly ? '仅看最新' : '含历史版本'}
                    </Button>
                  </div>

                  <div className="dlv-search-wrap">
                    <Search size={13} className="dlv-search-icon" aria-hidden="true" />
                    <Input
                      aria-label="搜索构建产物"
                      className="dlv-search-input"
                      placeholder="搜索版本标识或说明…"
                      value={keyword}
                      onChange={(event) => setKeyword(event.target.value)}
                    />
                  </div>
                </div>

                {artifacts.isPending ? (
                  <TableSkeleton rows={5} columns={['30%', '16%', '12%', '18%', '10%', '14%']} label="产物加载中" />
                ) : artifacts.isError && !artifacts.data ? (
                  <PageError
                    title="产物加载失败"
                    error={artifacts.error}
                    retrying={artifacts.isFetching}
                    retryLabel="重新加载"
                    onRetry={() => void artifacts.refetch()}
                  />
                ) : rawArtifacts.length === 0 && !hasLocalFilter ? (
                  <EmptyState
                    mascot="project"
                    title="还没有构建产物"
                    description="上报构建后，安装包、二维码或测试地址会出现在这里。"
                    action={
                      canManage ? (
                        <Button type="button" onClick={() => setReportOpen(true)}>
                          上报构建
                        </Button>
                      ) : undefined
                    }
                  />
                ) : filteredArtifacts.length === 0 ? (
                  <EmptyState
                    icon={<Package />}
                    title="没有匹配的构建产物"
                    description="当前筛选条件下没有结果，可切换环境、放宽产物类型或包含历史版本查看。"
                    action={
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEnvironment('all')
                          setTypeFilter('')
                          setLatestOnly(true)
                          setKeyword('')
                        }}
                      >
                        清除筛选
                      </Button>
                    }
                  />
                ) : (
                  <div className="table-wrap">
                    <Table aria-label="构建产物列表">
                      <TableHeader>
                        <TableRow>
                          <TableHead>版本标识</TableHead>
                          <TableHead>产物类型</TableHead>
                          <TableHead>环境</TableHead>
                          <TableHead>来源与采集时间</TableHead>
                          <TableHead>状态</TableHead>
                          <TableHead>操作</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredArtifacts.map((artifact) => {
                          const envLabel =
                            ENVIRONMENTS.find((item) => item.value === artifact.environment)?.label ?? '未指定'
                          const serviceName = artifact.serviceId ? serviceNameById.get(artifact.serviceId) : null
                          return (
                            <TableRow
                              key={artifact.id}
                              className="clickable-row"
                              onClick={(event) => {
                                if (isNestedInteractiveTarget(event.target)) return
                                setSelectedBuildId(artifact.buildId)
                              }}
                            >
                              <TableCell>
                                <div className="dlv-version-cell">
                                  <div className="dlv-version-row">
                                    <strong className="mono">{artifact.versionLabel}</strong>
                                    {artifact.isLatest ? <Badge variant="secondary">最新</Badge> : null}
                                    {serviceName ? <Badge variant="outline">{serviceName}</Badge> : null}
                                  </div>
                                  {artifact.note ? (
                                    <span className="dlv-note-snippet" title={artifact.note}>
                                      {artifact.note}
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="dlv-type-badge">
                                  {renderArtifactTypeIcon(artifact.artifactType)}
                                  {ARTIFACT_TYPE_LABELS[artifact.artifactType] ?? artifact.artifactType}
                                </span>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{envLabel}</Badge>
                              </TableCell>
                              <TableCell>
                                <div className="dlv-source-cell">
                                  <span>{SOURCE_LABELS[artifact.source] ?? artifact.source}</span>
                                  <span className="text-muted-foreground">{formatDateTime(artifact.collectedAt)}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <StatusBadge tone={artifactStatusTone(artifact.status)}>
                                  {STATUS_LABELS[artifact.status] ?? artifact.status}
                                </StatusBadge>
                              </TableCell>
                              <TableCell>
                                <div className="dlv-row-actions">
                                  {artifact.status === 'available' ? (
                                    <Button asChild variant="outline" size="sm">
                                      <a href={artifact.accessUrl} target="_blank" rel="noreferrer">
                                        打开产物
                                        <ExternalLink size={12} aria-hidden="true" />
                                      </a>
                                    </Button>
                                  ) : null}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSelectedBuildId(artifact.buildId)}
                                  >
                                    构建详情
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </section>
            </>
          ) : (
            <ReviewReleaseSection projectId={projectId} />
          )}
        </div>
      </div>

      <Sheet open={Boolean(selectedBuildId)} onOpenChange={(open) => (open ? undefined : setSelectedBuildId(''))}>
        <SheetContent side="right" className="dlv-detail-sheet">
          <SheetHeader>
            <SheetTitle>构建详情</SheetTitle>
            <SheetDescription>查看本次构建的元信息、产物引用、关联需求/Bug 及版本更正历史。</SheetDescription>
          </SheetHeader>
          <div className="dlv-detail-body">
            {selectedBuildId ? <BuildDetailPanel buildId={selectedBuildId} /> : null}
          </div>
        </SheetContent>
      </Sheet>

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
              <DialogDescription>
                {confirmTarget
                  ? `更新${activeService ? `「${activeService.name}」` : ''}${
                      ENVIRONMENTS.find((env) => env.value === confirmTarget.environment)?.label ??
                      confirmTarget.environment
                    }环境的当前运行版本记录。`
                  : ''}
              </DialogDescription>
            </DialogHeader>
            <label className="block space-y-1.5 text-sm font-medium">
              版本标识
              <Input
                value={versionLabelInput}
                onChange={(event) => setVersionLabelInput(event.target.value)}
                maxLength={200}
                placeholder="例如 v1.2.0-build.42"
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
                  placeholder="说明为何更正当前环境的运行版本"
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
