import { useState } from 'react'
import { Button, buttonVariants } from '@/shared/ui/controls/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/controls/alert-dialog'
import { Skeleton } from '@/shared/ui/controls/skeleton'
import { formatDateTime } from '@/shared/lib/format'
import { formatFileSize, truncateFileName } from '../lib/display'
import type { AttachmentSummary } from '../model/types'

/** 详情附件列表属性。 */
export interface AttachmentListProps {
  /** 业务详情返回的附件摘要；列表顺序即服务端稳定排序。 */
  attachments: AttachmentSummary[]
  /** 是否仍在加载；与空列表区分，不能以空态冒充加载失败。 */
  loading?: boolean
  /** 列表加载错误文案。 */
  error?: string | null
  /** 列表加载失败的重试入口。 */
  onRetry?: () => void
  /** 按当前角色与附件归属判断是否可删除，由父组件决定。 */
  canDelete: (attachment: AttachmentSummary) => boolean
  /** 二次确认后的删除动作；失败由父组件回传 deleteError。 */
  onDelete: (attachment: AttachmentSummary) => void
  /** 正在删除的附件标识；用于禁用以避免重复提交。 */
  deletingId?: string | null
  /** 删除失败原因；保留列表并就地提示。 */
  deleteError?: string | null
}

/**
 * 渲染详情附件列表：文件名、大小、上传者、时间与受鉴权下载链接，并承载删除二次确认。
 * @param props 附件数据、加载/错误状态、角色判定与删除回调。
 * @returns 覆盖 loading / empty / error / 列表 / 删除确认的附件区内容。
 */
export function AttachmentList({
  attachments,
  loading = false,
  error,
  onRetry,
  canDelete,
  onDelete,
  deletingId,
  deleteError,
}: AttachmentListProps) {
  const [pendingDelete, setPendingDelete] = useState<AttachmentSummary | null>(null)

  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <p className="text-sm text-muted-foreground">附件加载中…</p>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    )
  }
  if (error) {
    return (
      <div className="space-y-2">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        )}
      </div>
    )
  }
  if (attachments.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无附件。</p>
  }
  return (
    <div className="space-y-2">
      {deleteError && (
        <p role="alert" className="text-sm text-destructive">
          {deleteError}
        </p>
      )}
      <ul className="max-h-80 space-y-2 overflow-y-auto" aria-label="附件列表">
        {attachments.map((attachment) => {
          const isDeleting = deletingId === attachment.id
          return (
            <li key={attachment.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={attachment.fileName}>
                  {truncateFileName(attachment.fileName)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatFileSize(attachment.sizeBytes)} · {attachment.uploadedBy.name}
                  {!attachment.uploadedBy.available && (
                    <span className="text-destructive">（上传者已失效）</span>
                  )} · {formatDateTime(attachment.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={attachment.downloadUrl}
                  download={attachment.fileName}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  下载
                </a>
                {canDelete(attachment) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    aria-label={`删除附件 ${attachment.fileName}`}
                    disabled={isDeleting}
                    onClick={() => setPendingDelete(attachment)}
                  >
                    {isDeleting ? '删除中…' : '删除'}
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {pendingDelete && (
        <AlertDialog
          open
          onOpenChange={(open) => {
            if (!open) setPendingDelete(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除附件“{pendingDelete.fileName}”？</AlertDialogTitle>
              <AlertDialogDescription>
                删除后不可恢复，其他成员将无法再下载该附件；删除动作会记录到活动记录。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => {
                  const target = pendingDelete
                  setPendingDelete(null)
                  onDelete(target)
                }}
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
