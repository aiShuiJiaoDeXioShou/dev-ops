import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/features/identity/public'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { EmptyState, PageLoading } from '@/shared/ui/page-state'
import { releasesQueryOptions, reviewsQueryOptions } from '../api/review-queries'

const REVIEW_LABELS: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  withdrawn: '已撤回',
  unknown: '未知',
}
const RELEASE_LABELS: Record<string, string> = {
  not_released: '未发布',
  released: '已发布',
  partially_released: '部分发布',
  unknown: '未知',
}
type ReviewTarget = 'mini_program' | 'mobile_app'
type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn'

/** 外部审核与实际发布记录：两者分开表达，审核通过不自动视为已发布。 */
export function ReviewReleaseSection({ projectId }: { projectId: string }) {
  const { role } = useSession()
  const canManage = role === 'admin' || role === 'developer'
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const reviews = useQuery(reviewsQueryOptions(projectId))
  const releases = useQuery(releasesQueryOptions(projectId))
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewForm, setReviewForm] = useState({
    targetType: 'mini_program' as ReviewTarget,
    versionLabel: '',
    reviewPlatform: '',
    submittedAt: new Date().toISOString(),
    note: '',
  })
  const [statusTarget, setStatusTarget] = useState<{ id: string; version: number } | null>(null)
  const [statusForm, setStatusForm] = useState<{ reviewStatus: ReviewStatus; reviewReason: string }>({
    reviewStatus: 'approved',
    reviewReason: '',
  })
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [releaseForm, setReleaseForm] = useState({
    reviewId: '',
    versionLabel: '',
    releaseStatus: 'released' as 'not_released' | 'released' | 'partially_released' | 'unknown',
    releasedAt: new Date().toISOString(),
    scopeNote: '',
  })
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['delivery', 'reviews', projectId] })
    await queryClient.invalidateQueries({ queryKey: ['delivery', 'releases', projectId] })
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
    <section aria-label="外部审核与发布" className="project-summary-section space-y-6">
      <div className="row spread flex-wrap gap-3">
        <p className="small quiet">审核通过不等同于已发布，两类记录分别维护。</p>
        {canManage ? (
          <div className="row">
            <Button type="button" variant="outline" size="sm" onClick={() => setReviewOpen(true)}>
              记录提审
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setReleaseOpen(true)}>
              记录发布
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
              <Button type="button" onClick={() => setReviewOpen(true)}>
                记录提审
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <section aria-label="提审记录">
            <div className="section-heading">
              <h3>提审记录</h3>
              <span className="counter">{reviewItems.length}</span>
            </div>
            {reviews.isPending ? (
              <DelayedLoading pending>
                <PageLoading />
              </DelayedLoading>
            ) : reviews.isError ? (
              <p className="muted">提审记录加载失败。</p>
            ) : reviewItems.length === 0 ? (
              <p className="muted">还没有提审记录。</p>
            ) : (
              <ul className="plain-list">
                {reviewItems.map((review) => (
                  <li key={review.id}>
                    <span>
                      {review.targetType === 'mini_program' ? '小程序' : '移动端应用'} {review.versionLabel}
                    </span>
                    <span className="muted">{review.reviewPlatform}</span>
                    <span className="tag">{REVIEW_LABELS[review.reviewStatus] ?? review.reviewStatus}</span>
                    <span className="muted">{review.submittedAt}</span>
                    {canManage ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setStatusTarget({ id: review.id, version: review.version })}
                      >
                        更新审核状态
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-label="实际发布">
            <div className="section-heading">
              <h3>实际发布</h3>
              <span className="counter">{releaseItems.length}</span>
            </div>
            {releases.isPending ? (
              <DelayedLoading pending>
                <PageLoading />
              </DelayedLoading>
            ) : releases.isError ? (
              <p className="muted">发布记录加载失败。</p>
            ) : releaseItems.length === 0 ? (
              <p className="muted">还没有发布记录。</p>
            ) : (
              <ul className="plain-list">
                {releaseItems.map((release) => (
                  <li key={release.id}>
                    <span>{release.versionLabel}</span>
                    <span className="tag">{RELEASE_LABELS[release.releaseStatus] ?? release.releaseStatus}</span>
                    <span className="muted">{release.releasedAt ?? '发布时间未知'}</span>
                  </li>
                ))}
              </ul>
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
                onChange={(event) => setReviewForm({ ...reviewForm, versionLabel: event.target.value })}
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              提审平台
              <Input
                value={reviewForm.reviewPlatform}
                maxLength={200}
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
                保存
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
              原因
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
                保存
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
                onChange={(event) => setReleaseForm({ ...releaseForm, scopeNote: event.target.value })}
              />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setReleaseOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={createRelease.isPending}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
