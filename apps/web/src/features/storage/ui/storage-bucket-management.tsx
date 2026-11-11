import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useCreateStorageBucket,
  useRemoveStorageBucket,
  useSetStorageBucketDefault,
  useTestStorageBucket,
  useUpdateStorageBucket,
  storageBucketsQueryOptions,
} from '../api/queries'
import { describeStorageError } from '../lib/errors'
import {
  BUCKET_KIND_LABELS,
  BUCKET_STATUS_LABELS,
  PROBE_RESULT_LABELS,
  bucketDefaultBlockedReason,
  bucketRemoveBlockedReason,
  canRemoveBucket,
  canSetBucketDefault,
} from '../model/labels'
import type { StorageBucket } from '../model/types'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { EmptyState, PageError, PageLoading } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'
import { formatDateTime } from '@/shared/lib/format'
import { StorageBucketConfirmDialog } from './storage-bucket-confirm-dialog'
import { StorageBucketFormDialog } from './storage-bucket-form-dialog'

/**
 * 渲染储存桶的最近探测结论：结论、原因与时间必须同时可见，不能只靠颜色。
 * @param props.bucket 储存桶视图。
 * @returns 探测结论单元格内容；从未测试时给出明确状态。
 */
function ProbeCell({ bucket }: { bucket: StorageBucket }) {
  const probe = bucket.lastProbe
  if (!probe) return <span className="text-sm text-muted-foreground">尚未测试</span>
  return (
    <div className="space-y-1">
      <Badge variant={probe.result === 'read_write' ? 'outline' : 'secondary'}>
        {PROBE_RESULT_LABELS[probe.result]}
      </Badge>
      {probe.message && <p className="max-w-64 text-xs break-words text-muted-foreground">{probe.message}</p>}
      {probe.at && <p className="text-xs text-muted-foreground">{formatDateTime(probe.at)}</p>}
    </div>
  )
}

/**
 * 平台储存桶管理面板：列表、创建/编辑、连接测试、设为默认与删除。
 * 仅平台管理员可见；服务端仍会独立校验身份。
 * @returns 储存桶配置界面与操作弹窗；列表排序直接采用服务端顺序。
 */
export function StorageBucketManagement() {
  const { showToast } = useToast()
  const buckets = useQuery(storageBucketsQueryOptions())
  const createMutation = useCreateStorageBucket()
  const updateMutation = useUpdateStorageBucket()
  const probeMutation = useTestStorageBucket()
  const defaultMutation = useSetStorageBucketDefault()
  const removeMutation = useRemoveStorageBucket()
  const [formBucket, setFormBucket] = useState<StorageBucket | null | undefined>(undefined)
  const [defaultTarget, setDefaultTarget] = useState<StorageBucket | null>(null)
  const [removeTarget, setRemoveTarget] = useState<StorageBucket | null>(null)
  const formTriggerRef = useRef<HTMLElement | null>(null)
  const defaultTriggerRef = useRef<HTMLElement | null>(null)
  const removeTriggerRef = useRef<HTMLElement | null>(null)

  const createError = createMutation.isError
    ? describeStorageError(createMutation.error).description
    : updateMutation.isError
      ? describeStorageError(updateMutation.error).description
      : null
  const defaultError = defaultMutation.isError ? describeStorageError(defaultMutation.error).description : null
  const removeError = removeMutation.isError ? describeStorageError(removeMutation.error).description : null
  const listError = buckets.isError ? describeStorageError(buckets.error) : null
  const bucketItems = buckets.data ?? []

  /**
   * 打开创建/编辑弹窗并记录触发元素，关闭后归还焦点。
   * @param bucket 编辑目标；null 表示创建。
   * @param trigger 触发按钮。
   */
  const openForm = (bucket: StorageBucket | null, trigger: HTMLElement) => {
    formTriggerRef.current = trigger
    setFormBucket(bucket)
  }

  /**
   * 执行连接测试；四类结论都会给出可读提示。
   * @param bucket 目标储存桶。
   */
  const runProbe = (bucket: StorageBucket) => {
    probeMutation.mutate(bucket.id, {
      onSuccess: (probe) => {
        const resultLabel = `${PROBE_RESULT_LABELS[probe.result]}${probe.message ? `：${probe.message}` : ''}`
        showToast(`连接测试完成，${resultLabel}`, probe.result === 'read_write' ? 'success' : 'error')
      },
      onError: (error: unknown) => showToast(describeStorageError(error).description, 'error'),
    })
  }

  return (
    <div className="content">
      <div className="page-head">
        <div>
          <h1>储存桶</h1>
          <p className="small quiet">
            附件默认写入默认储存桶。内置本地桶始终存在且不可删除；自定义桶需通过连接测试后才能设为默认。
          </p>
        </div>
        <Button
          type="button"
          onClick={(event) => openForm(null, event.currentTarget)}
          disabled={createMutation.isPending}
        >
          新建储存桶
        </Button>
      </div>

      <section aria-label="储存桶列表" className="settings-section space-y-4">
        {listError ? (
          <PageError
            title="储存桶列表加载失败"
            description={listError.description}
            requestId={listError.requestId}
            retrying={buckets.isFetching}
            onRetry={() => void buckets.refetch()}
          />
        ) : buckets.isPending ? (
          <PageLoading message="储存桶加载中…" />
        ) : bucketItems.length === 0 ? (
          <EmptyState
            title="还没有储存桶配置"
            description="平台应始终包含一个内置本地储存桶；如果列表为空，请重新加载或联系部署管理员。"
            action={
              <Button type="button" variant="outline" onClick={() => void buckets.refetch()}>
                重新加载
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近探测</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bucketItems.map((bucket) => {
                const isTesting = probeMutation.isPending && probeMutation.variables === bucket.id
                const defaultReason = canSetBucketDefault(bucket) ? null : bucketDefaultBlockedReason(bucket)
                const removeReason = canRemoveBucket(bucket) ? null : bucketRemoveBlockedReason(bucket)
                return (
                  <TableRow key={bucket.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{bucket.name}</span>
                          {bucket.isDefault && <Badge>默认</Badge>}
                          {bucket.isBuiltin && <Badge variant="outline">内置</Badge>}
                        </div>
                        {bucket.kind === 's3' && (
                          <p
                            className="max-w-80 truncate text-xs text-muted-foreground"
                            title={bucket.endpoint ?? undefined}
                          >
                            {bucket.endpoint}
                            {bucket.bucketName ? ` / ${bucket.bucketName}` : ''}
                          </p>
                        )}
                        {bucket.kind === 'local' && <p className="text-xs text-muted-foreground">部署服务器本地目录</p>}
                      </div>
                    </TableCell>
                    <TableCell>{BUCKET_KIND_LABELS[bucket.kind]}</TableCell>
                    <TableCell>
                      <Badge variant={bucket.status === 'enabled' ? 'outline' : 'secondary'}>
                        {BUCKET_STATUS_LABELS[bucket.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <ProbeCell bucket={bucket} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isTesting}
                          onClick={() => runProbe(bucket)}
                        >
                          {isTesting ? '测试中…' : '测试连接'}
                        </Button>
                        {!bucket.isDefault && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!canSetBucketDefault(bucket)}
                            title={defaultReason ?? undefined}
                            onClick={(event) => {
                              defaultTriggerRef.current = event.currentTarget
                              setDefaultTarget(bucket)
                            }}
                          >
                            设为默认
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={(event) => openForm(bucket, event.currentTarget)}
                        >
                          编辑
                        </Button>
                        {!bucket.isBuiltin && (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={!canRemoveBucket(bucket)}
                            title={removeReason ?? undefined}
                            onClick={(event) => {
                              removeTriggerRef.current = event.currentTarget
                              setRemoveTarget(bucket)
                            }}
                          >
                            删除
                          </Button>
                        )}
                      </div>
                      {defaultReason && !bucket.isDefault && (
                        <p className="mt-1 text-right text-xs text-muted-foreground">{defaultReason}</p>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </section>

      <StorageBucketFormDialog
        open={formBucket !== undefined}
        onOpenChange={(open) => {
          if (open) return
          setFormBucket(undefined)
          createMutation.reset()
          updateMutation.reset()
          formTriggerRef.current?.focus()
        }}
        bucket={formBucket ?? null}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        errorDescription={createError}
        onCreate={(input) =>
          createMutation.mutate(input, {
            onSuccess: () => {
              setFormBucket(undefined)
              showToast('储存桶已创建。', 'success')
            },
          })
        }
        onUpdate={(bucketId, input) =>
          updateMutation.mutate(
            { bucketId, body: input },
            {
              onSuccess: () => {
                setFormBucket(undefined)
                showToast('储存桶配置已保存。', 'success')
              },
            },
          )
        }
      />

      <StorageBucketConfirmDialog
        open={defaultTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          setDefaultTarget(null)
          defaultMutation.reset()
          defaultTriggerRef.current?.focus()
        }}
        title={`把「${defaultTarget?.name ?? ''}」设为默认储存桶？`}
        description="切换后新上传的附件写入该桶，历史附件仍按各自记录的桶下载；同一时刻只会有一个默认桶。"
        confirmLabel="设为默认"
        pendingLabel="切换中…"
        isPending={defaultMutation.isPending}
        errorDescription={defaultError}
        onConfirm={() => {
          if (!defaultTarget) return
          defaultMutation.mutate(
            { bucketId: defaultTarget.id, version: defaultTarget.version },
            {
              onSuccess: () => {
                setDefaultTarget(null)
                showToast('默认储存桶已切换。', 'success')
              },
            },
          )
        }}
      />

      <StorageBucketConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (open) return
          setRemoveTarget(null)
          removeMutation.reset()
          removeTriggerRef.current?.focus()
        }}
        title={`删除储存桶「${removeTarget?.name ?? ''}」？`}
        description="删除后不可恢复，历史附件将无法下载；被附件引用或作为默认桶时服务端会拒绝删除。"
        confirmLabel="删除储存桶"
        pendingLabel="删除中…"
        isPending={removeMutation.isPending}
        errorDescription={removeError}
        destructive
        onConfirm={() => {
          if (!removeTarget) return
          removeMutation.mutate(removeTarget.id, {
            onSuccess: () => {
              setRemoveTarget(null)
              showToast('储存桶已删除。', 'success')
            },
          })
        }}
      />
    </div>
  )
}
