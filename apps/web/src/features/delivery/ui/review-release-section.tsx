import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ClipboardCheck, Rocket } from 'lucide-react'
import { useSession } from '@/features/identity/model/session'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { Textarea } from '@/shared/ui/controls/textarea'
import { CompactListSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { StatusBadge, type StatusTone } from '@/shared/ui/status-badge'
import { useToast } from '@/shared/ui/toast'
import { releasesQueryOptions, reviewsQueryOptions } from '../api/review-queries'

const REVIEW_LABELS: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  withdrawn: '已撤回',
  unknown: '未知',
}

const REVIEW_TONES: Record<string, StatusTone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
  unknown: 'neutral',
}

const RELEASE_LABELS: Record<string, string> = {
  not_released: '未发布',
  released: '已发布',
  partially_released: '部分发布',
  unknown: '未知',
}

const RELEASE_TONES: Record<string, StatusTone> = {
  not_released: 'neutral',
  released: 'success',
  partially_released: 'warning',
  unknown: 'neutral',
}

type ReviewTarget = 'mini_program' | 'mobile_app'
type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

/**
 * 外部审核与实际发布记录。
 *
 * 两者分开表达，审核通过不自动视为已发布；使用结构化表格与语义状态徽标展示审核进度与实际发布范围。
 * @param props.projectId 项目标识。
 * @returns 外部提审与实际发布管理视图。
 */
export function ReviewReleaseSection({ projectId }: { projectId: string }) {
  const { role } = useSession()
  const canManage = role === 'admin' || role === 'developer'
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const reviews = useQuery(reviewsQueryOptions(projectId))
  const releases = useQuery(releasesQueryOptions(projectId))
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewForm, setReviewForm] = useState(() => ({
    targetType: 'mini_program' as ReviewTarget,
    versionLabel: '',
    reviewPlatform: '',
    submittedAt: new Date().toISOString(),
    note: '',
  }))
  const [statusTarget, setStatusTarget] = useState<{ id: string; version: number; versionLabel: string } | null>(null)
  const [statusForm, setStatusForm] = useState<{ reviewStatus: ReviewStatus; reviewReason: string }>({
    reviewStatus: 'approved',
    reviewReason: '',
  })
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseForm, setReleaseForm] = useState(() => ({
    reviewId: '',
    versionLabel: '',
    releaseStatus: 'released' as 'not_released' | 'released' | 'partially_released' | 'unknown',
    releasedAt: new Date().toISOString(),
    scopeNote: '',
  }))

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['delivery', 'reviews', projectId] })
    await queryClient.invalidateQueries({ queryKey: ['delivery', 'releases', projectId] })
  }

  const openCreateReview = () => {
    setReviewForm({
      targetType: 'mini_program',
      versionLabel: '',
      reviewPlatform: '',
      submittedAt: new Date().toISOString(),
      note: '',
    })
    setReviewOpen(true)
  }

  const openCreateRelease = () => {
    setReleaseForm({
      reviewId: '',
      versionLabel: '',
      releaseStatus: 'released',
      releasedAt: new Date().toISOString(),
      scopeNote: '',
    })
    setReleaseOpen(true)
  }

  const createReview = useMutation({
    mutationFn: () =>
      apiClient.createReview(projectId, {
        targetType: reviewForm.targetType,
        versionLabel: reviewForm.versionLabel.trim(),
        reviewPlatform: reviewForm.reviewPlatform.trim(),
        submittedAt: new Date(reviewForm.submittedAt).toISOString(),
        note: reviewForm.note.trim() || undefined,
      }),
    onSuccess: async () => {
      await refresh()
      setReviewOpen(false)
      showToast('提审记录已保存。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const updateStatus = useMutation({
    mutationFn: () => {
      if (!statusTarget) throw new Error('缺少提审记录')
      return apiClient.updateReview(statusTarget.id, {
        version: statusTarget.version,
        reviewStatus: statusForm.reviewStatus,
        reviewReason: statusForm.reviewReason.trim() || undefined,
      })
    },
    onSuccess: async () => {
      await refresh()
      setStatusTarget(null)
      showToast('审核状态已更新。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const createRelease = useMutation({
    mutationFn: () =>
      apiClient.createRelease(projectId, {
        ...(releaseForm.reviewId ? { reviewId: releaseForm.reviewId } : {}),
        versionLabel: releaseForm.versionLabel.trim(),
        releaseStatus: releaseForm.releaseStatus,
        releasedAt: new Date(releaseForm.releasedAt).toISOString(),
        scopeNote: releaseForm.scopeNote.trim() || undefined,
      }),
    onSuccess: async () => {
      await refresh()
      setReleaseOpen(false)
      showToast('发布结果已记录。', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const reviewItems = reviews.data?.data.items ?? []
  const releaseItems = releases.data?.data.items ?? []
  const isLoading = reviews.isPending || releases.isPending
  const hasLoadError = reviews.isError || releases.isError
  const hasAnyRecord = reviewItems.length > 0 || releaseItems.length > 0

  return (
    <section aria-label="外部审核与发布" className="space-y-6">
      <div className="dlv-info-banner">
        <span className="inline-flex items-center gap-2">
          <CheckCircle2 size={15} className="text-muted-foreground" aria-hidden="true" />
          <span>审核通过不等同于已发布，小程序及应用商店提审与实际发布结果分开维护。</span>
        </span>
        {canManage ? (
          <div className="dlv-review-actions">
            <Button type="button" variant="outline" size="sm" onClick={openCreateRelease}>
              <Rocket size={14} aria-hidden="true" />
              记录发布
            </Button>
            <Button type="button" size="sm" onClick={openCreateReview}>
              <ClipboardCheck size={14} aria-hidden="true" />
              记录提审
            </Button>
          </div>
        ) : null}
      </div>

      {!isLoading && !hasLoadError && !hasAnyRecord ? (
        <EmptyState
          mascot="prism"
          title="还没有审核与发布记录"
          description="记录小程序或移动端应用的提审与发布结果，方便团队追溯上架进度。"
          action={
            canManage ? (
              <Button type="button" onClick={openCreateReview}>
                记录提审
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <section aria-label="提审记录" className="dlv-section">
            <div className="dlv-section-head">
              <div className="dlv-section-title">
                <h3>提审记录</h3>
                <span className="counter">{reviewItems.length}</span>
              </div>
            </div>

            {reviews.isPending ? (
              <CompactListSkeleton rows={3} trailing bordered label="提审记录加载中" />
            ) : reviews.isError && !reviews.data ? (
              <PageError
                title="提审记录加载失败"
                error={reviews.error}
                retrying={reviews.isFetching}
                onRetry={() => void reviews.refetch()}
              />
            ) : reviewItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有提审记录。</p>
            ) : (
              <div className="table-wrap">
                <Table aria-label="提审记录列表">
                  <TableHeader>
                    <TableRow>
                      <TableHead>版本与对象</TableHead>
                      <TableHead>提审平台</TableHead>
                      <TableHead>审核状态</TableHead>
                      <TableHead>提审时间</TableHead>
                      <TableHead>说明 / 审核原因</TableHead>
                      {canManage ? <TableHead>操作</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reviewItems.map((review) => (
                      <TableRow key={review.id}>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="secondary">
                              {review.targetType === 'mini_program' ? '小程序' : '移动端应用'}
                            </Badge>
                            <strong className="mono">{review.versionLabel}</strong>
                          </div>
                        </TableCell>
                        <TableCell>{review.reviewPlatform}</TableCell>
                        <TableCell>
                          <StatusBadge tone={REVIEW_TONES[review.reviewStatus] ?? 'neutral'}>
                            {REVIEW_LABELS[review.reviewStatus] ?? review.reviewStatus}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{formatDateTime(review.submittedAt)}</TableCell>
                        <TableCell className="text-muted-foreground whitespace-normal">
                          {review.reviewReason ?? review.note ?? '—'}
                        </TableCell>
                        {canManage ? (
                          <TableCell>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setStatusForm({
                                  reviewStatus:
                                    review.reviewStatus === 'pending' ||
                                    review.reviewStatus === 'approved' ||
                                    review.reviewStatus === 'rejected' ||
                                    review.reviewStatus === 'withdrawn'
                                      ? review.reviewStatus
                                      : 'approved',
                                  reviewReason: review.reviewReason ?? '',
                                })
                                setStatusTarget({
                                  id: review.id,
                                  version: review.version,
                                  versionLabel: review.versionLabel,
                                })
                              }}
                            >
                              更新审核状态
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>

          <section aria-label="实际发布" className="dlv-section">
            <div className="dlv-section-head">
              <div className="dlv-section-title">
                <h3>实际发布</h3>
                <span className="counter">{releaseItems.length}</span>
              </div>
            </div>

            {releases.isPending ? (
              <CompactListSkeleton rows={3} trailing bordered label="发布记录加载中" />
            ) : releases.isError && !releases.data ? (
              <PageError
                title="发布记录加载失败"
                error={releases.error}
                retrying={releases.isFetching}
                onRetry={() => void releases.refetch()}
              />
            ) : releaseItems.length === 0 ? (
              <p className="text-sm text-muted-foreground">还没有发布记录。</p>
            ) : (
              <div className="table-wrap">
                <Table aria-label="实际发布列表">
                  <TableHeader>
                    <TableRow>
                      <TableHead>版本标识</TableHead>
                      <TableHead>发布结果</TableHead>
                      <TableHead>发布时间</TableHead>
                      <TableHead>发布范围说明</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {releaseItems.map((release) => (
                      <TableRow key={release.id}>
                        <TableCell>
                          <strong className="mono">{release.versionLabel}</strong>
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={RELEASE_TONES[release.releaseStatus] ?? 'neutral'}>
                            {RELEASE_LABELS[release.releaseStatus] ?? release.releaseStatus}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {release.releasedAt ? formatDateTime(release.releasedAt) : '发布时间未知'}
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-normal">
                          {release.scopeNote ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </>
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event: FormEvent) => {
              event.preventDefault()
              if (!reviewForm.versionLabel.trim()) return showToast('请填写版本标识。', 'error')
              if (!reviewForm.reviewPlatform.trim()) return showToast('请填写提审平台。', 'error')
              createReview.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>记录外部提审</DialogTitle>
            </DialogHeader>
            <label className="block space-y-1.5 text-sm font-medium">
              对象
              <Select
                value={reviewForm.targetType}
                onChange={(event) => setReviewForm({ ...reviewForm, targetType: event.target.value as ReviewTarget })}
              >
                <option value="mini_program">小程序</option>
                <option value="mobile_app">移动端应用</option>
              </Select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              版本标识
              <Input
                value={reviewForm.versionLabel}
                maxLength={200}
                placeholder="例如 v1.2.0"
                onChange={(event) => setReviewForm({ ...reviewForm, versionLabel: event.target.value })}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              提审平台
              <Input
                value={reviewForm.reviewPlatform}
                maxLength={200}
                placeholder="例如 微信小程序、App Store、华为应用市场"
                onChange={(event) => setReviewForm({ ...reviewForm, reviewPlatform: event.target.value })}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              说明
              <Textarea
                value={reviewForm.note}
                maxLength={2000}
                onChange={(event) => setReviewForm({ ...reviewForm, note: event.target.value })}
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReviewOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={createReview.isPending}>
                {createReview.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={statusTarget !== null} onOpenChange={(open) => (open ? undefined : setStatusTarget(null))}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (
                (statusForm.reviewStatus === 'rejected' || statusForm.reviewStatus === 'withdrawn') &&
                !statusForm.reviewReason.trim()
              ) {
                return showToast('拒绝或撤回必须填写原因。', 'error')
              }
              updateStatus.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>更新审核状态</DialogTitle>
            </DialogHeader>
            {statusTarget ? (
              <p className="text-sm text-muted-foreground">
                当前版本：<strong className="mono text-foreground">{statusTarget.versionLabel}</strong>
              </p>
            ) : null}
            <label className="block space-y-1.5 text-sm font-medium">
              审核状态
              <Select
                value={statusForm.reviewStatus}
                onChange={(event) => setStatusForm({ ...statusForm, reviewStatus: event.target.value as ReviewStatus })}
              >
                <option value="pending">待审核</option>
                <option value="approved">通过</option>
                <option value="rejected">拒绝</option>
                <option value="withdrawn">撤回</option>
              </Select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              原因（拒绝或撤回时必填）
              <Input
                value={statusForm.reviewReason}
                maxLength={1000}
                onChange={(event) => setStatusForm({ ...statusForm, reviewReason: event.target.value })}
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setStatusTarget(null)}>
                取消
              </Button>
              <Button type="submit" disabled={updateStatus.isPending}>
                {updateStatus.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={releaseOpen} onOpenChange={setReleaseOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (!releaseForm.versionLabel.trim()) return showToast('请填写版本标识。', 'error')
              createRelease.mutate()
            }}
          >
            <DialogHeader>
              <DialogTitle>记录实际发布</DialogTitle>
            </DialogHeader>
            <label className="block space-y-1.5 text-sm font-medium">
              版本标识
              <Input
                value={releaseForm.versionLabel}
                maxLength={200}
                placeholder="例如 v1.2.0"
                onChange={(event) => setReleaseForm({ ...releaseForm, versionLabel: event.target.value })}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              发布结果
              <Select
                value={releaseForm.releaseStatus}
                onChange={(event) =>
                  setReleaseForm({
                    ...releaseForm,
                    releaseStatus: event.target.value as typeof releaseForm.releaseStatus,
                  })
                }
              >
                <option value="released">已发布</option>
                <option value="partially_released">部分发布</option>
                <option value="not_released">未发布</option>
                <option value="unknown">未知</option>
              </Select>
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              发布范围说明
              <Textarea
                value={releaseForm.scopeNote}
                maxLength={2000}
                placeholder="例如 全量放量、灰度 20% 用户"
                onChange={(event) => setReleaseForm({ ...releaseForm, scopeNote: event.target.value })}
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReleaseOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={createRelease.isPending}>
                {createRelease.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
