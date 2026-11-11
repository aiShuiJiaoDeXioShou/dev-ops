import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { Button } from '@/shared/ui/controls/button'
import { FormField } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { cn } from '@/shared/lib/utils'
import { removeAttachment } from '../api/attachments-api'
import { useAttachmentPolicy } from '../api/queries'
import { describeAttachmentError } from '../lib/errors'
import { formatFileSize, truncateFileName } from '../lib/display'
import { hasUnfinishedAttachments } from '../lib/pending'
import { isUploadAborted, uploadAttachment, type AttachmentUploadHandle } from '../lib/upload'
import type { PendingAttachment } from '../model/types'

/** 同时上传的文件数上限；避免一次选择多个大文件时抢占带宽并拖慢整体反馈。 */
const MAX_CONCURRENT_UPLOADS = 3

/** 附件表单区属性。 */
export interface AttachmentFieldProps {
  /** 目标项目标识；临时附件归属该项目。 */
  projectId: string
  /** 当前附件行，受控于父表单。 */
  value: PendingAttachment[]
  /** 附件行变化回调；重试、取消、移除都通过它同步给父表单。 */
  onChange: (next: PendingAttachment[]) => void
  /** 只读态：隐藏选择入口，仅展示已选附件与原因。 */
  disabled?: boolean
  /** 字段标题。 */
  label: string
  /** 父表单提交被附件阻塞时的提示；非空时把焦点移到附件区。 */
  error?: string | null
  /** 只读原因；未提供时使用默认说明。 */
  disabledReason?: string
  /** 编辑场景：提示移除已保存附件会在保存后生效。 */
  editing?: boolean
}

/**
 * 生成稳定的本地行标识；重试复用同一行而不新建。
 * @returns 带前缀的随机会话内唯一标识。
 */
function createClientId(): string {
  return `upload-${globalThis.crypto.randomUUID()}`
}

/**
 * 渲染附件表单区：前置校验 → 并发上传 → 进度/取消/失败重试 → 完成后进入提交集合。
 * 上限来自策略接口，零字节与超限文件在发请求前被拒绝。
 * @param props 项目、附件行、变更回调与只读/错误状态。
 * @returns 附件选择、行状态列表与上限说明。
 */
export function AttachmentField({
  projectId,
  value,
  onChange,
  disabled = false,
  label,
  error,
  disabledReason = '当前状态不可修改附件，已有附件仍可在详情中下载。',
  editing = false,
}: AttachmentFieldProps) {
  const policy = useAttachmentPolicy()
  const [limitError, setLimitError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const labelId = useId()
  const valueRef = useRef(value)
  const filesRef = useRef(new Map<string, File>())
  const handlesRef = useRef(new Map<string, AttachmentUploadHandle>())
  const queueRef = useRef<string[]>([])
  const activeCountRef = useRef(0)
  const cancelledRef = useRef(new Set<string>())
  const mountedRef = useRef(true)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    // 上传句柄 Map 在组件生命周期内保持同一实例，卸载时统一中断，避免请求悬挂。
    const uploadHandles = handlesRef.current
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      for (const handle of uploadHandles.values()) handle.abort()
      uploadHandles.clear()
      queueRef.current = []
    }
  }, [])

  useEffect(() => {
    if (!error) return
    containerRef.current?.focus()
  }, [error])

  /**
   * 用最新值替换附件行并通知父表单；卸载后不再写状态。
   * @param next 下一份附件行。
   */
  const commit = (next: PendingAttachment[]) => {
    valueRef.current = next
    if (!mountedRef.current) return
    onChange(next)
  }

  /**
   * 就地更新某一行的部分字段；行已被移除时忽略。
   * @param clientId 行标识。
   * @param patch 需要合并的字段。
   */
  const patchRow = (clientId: string, patch: Partial<PendingAttachment>) => {
    const current = valueRef.current
    if (!current.some((row) => row.clientId === clientId)) return
    commit(current.map((row) => (row.clientId === clientId ? { ...row, ...patch } : row)))
  }

  /**
   * 启动单个文件上传并处理进度、成功、失败与取消后的临时附件清理。
   * @param clientId 行标识。
   * @param file 本地文件。
   */
  const startUpload = (clientId: string, file: File) => {
    const handle = uploadAttachment({ projectId, file })
    handlesRef.current.set(clientId, handle)
    handle.onProgress((progress) => patchRow(clientId, { progress }))
    handle.promise
      .then((attachment) => {
        handlesRef.current.delete(clientId)
        filesRef.current.delete(clientId)
        if (cancelledRef.current.delete(clientId)) {
          // 取消与响应接近同时发生时，服务端可能已落成临时附件；尽力清理，失败只记录日志。
          void removeAttachment(attachment.id).catch((cause: unknown) => {
            console.warn('取消上传后清理临时附件失败', cause)
          })
          return
        }
        patchRow(clientId, {
          status: 'done',
          progress: 100,
          attachmentId: attachment.id,
          error: undefined,
        })
      })
      .catch((cause: unknown) => {
        handlesRef.current.delete(clientId)
        if (isUploadAborted(cause)) return
        patchRow(clientId, { status: 'failed', progress: 0, error: describeAttachmentError(cause) })
      })
      .finally(() => {
        activeCountRef.current = Math.max(0, activeCountRef.current - 1)
        if (mountedRef.current) startNext()
      })
  }

  /**
   * 按并发上限从队列取出下一批上传任务。
   */
  function startNext() {
    while (activeCountRef.current < MAX_CONCURRENT_UPLOADS) {
      const clientId = queueRef.current.shift()
      if (!clientId) return
      const file = filesRef.current.get(clientId)
      if (!file) {
        patchRow(clientId, { status: 'failed', progress: 0, error: '文件已失效，请移除后重新选择。' })
        continue
      }
      activeCountRef.current += 1
      startUpload(clientId, file)
    }
  }

  /**
   * 处理文件选择：先做零字节、单文件上限与单次数量上限校验，通过后再排队上传。
   * @param event 文件输入变化事件。
   */
  const handleFilesSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? [])
    // 清空输入值，保证连续选择同一文件时仍触发变更事件。
    event.target.value = ''
    const currentPolicy = policy.data
    if (selectedFiles.length === 0 || !currentPolicy) return
    const rejectionMessages: string[] = []
    const acceptedFiles: Array<{ clientId: string; file: File }> = []
    let plannedCount = valueRef.current.length
    for (const file of selectedFiles) {
      if (file.size === 0) {
        rejectionMessages.push(`文件「${file.name}」为空，无法上传。`)
        continue
      }
      if (file.size > currentPolicy.maxFileBytes) {
        rejectionMessages.push(`文件「${file.name}」超过单文件上限 ${formatFileSize(currentPolicy.maxFileBytes)}。`)
        continue
      }
      if (plannedCount >= currentPolicy.maxFilesPerSubmit) {
        rejectionMessages.push(`一次最多上传 ${currentPolicy.maxFilesPerSubmit} 个附件。`)
        continue
      }
      acceptedFiles.push({ clientId: createClientId(), file })
      plannedCount += 1
    }
    setLimitError(rejectionMessages.join(' '))
    if (acceptedFiles.length === 0) return
    const rows: PendingAttachment[] = acceptedFiles.map(({ clientId, file }) => {
      filesRef.current.set(clientId, file)
      return { clientId, fileName: file.name, sizeBytes: file.size, status: 'uploading', progress: 0 }
    })
    commit([...valueRef.current, ...rows])
    queueRef.current.push(...acceptedFiles.map((item) => item.clientId))
    startNext()
  }

  /**
   * 取消上传：中断请求并从提交集合移除；排队中的任务直接出队。
   * @param clientId 行标识。
   */
  const cancelUpload = (clientId: string) => {
    cancelledRef.current.add(clientId)
    queueRef.current = queueRef.current.filter((item) => item !== clientId)
    handlesRef.current.get(clientId)?.abort()
    handlesRef.current.delete(clientId)
    filesRef.current.delete(clientId)
    commit(valueRef.current.filter((row) => row.clientId !== clientId))
  }

  /**
   * 重试失败行：复用同一 clientId 与文件，不新增行也不产生重复附件。
   * @param clientId 行标识。
   */
  const retryUpload = (clientId: string) => {
    const file = filesRef.current.get(clientId)
    if (!file) {
      patchRow(clientId, { status: 'failed', progress: 0, error: '文件已失效，请移除后重新选择。' })
      return
    }
    cancelledRef.current.delete(clientId)
    patchRow(clientId, { status: 'uploading', progress: 0, error: undefined })
    queueRef.current.push(clientId)
    startNext()
  }

  /**
   * 移除一行；上传中的行先取消请求，已完成的行只是从最终集合移除。
   * @param clientId 行标识。
   */
  const removeRow = (clientId: string) => {
    const row = valueRef.current.find((item) => item.clientId === clientId)
    if (row?.status === 'uploading') {
      cancelUpload(clientId)
      return
    }
    filesRef.current.delete(clientId)
    handlesRef.current.delete(clientId)
    cancelledRef.current.delete(clientId)
    commit(valueRef.current.filter((item) => item.clientId !== clientId))
  }

  /**
   * 渲染单行附件状态：文件名、大小、进度、取消/重试/移除。
   * @param row 附件行。
   * @returns 行元素；长文件名中间省略并保留扩展名。
   */
  const renderRow = (row: PendingAttachment): ReactNode => {
    const isFailed = row.status === 'failed'
    return (
      <li
        key={row.clientId}
        data-status={row.status}
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2',
          isFailed ? 'border-destructive/40 bg-destructive/10' : 'border-border bg-muted/40',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm" title={row.fileName}>
            {truncateFileName(row.fileName)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(row.sizeBytes)}
            {row.status === 'uploading' && ' · 上传中'}
            {row.status === 'failed' && ' · 上传失败'}
            {row.status === 'done' && ' · 已上传'}
          </p>
          {row.status === 'uploading' && (
            <div className="mt-1 flex items-center gap-2">
              <progress
                className="h-1.5 w-24 accent-primary"
                value={row.progress}
                max={100}
                aria-label={`${row.fileName} 上传进度 ${row.progress}%`}
              />
              <span className="text-xs text-muted-foreground">{row.progress}%</span>
            </div>
          )}
          {isFailed && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {row.error ?? '上传失败，请重试。'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {row.status === 'uploading' && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={`取消上传 ${row.fileName}`}
              onClick={() => cancelUpload(row.clientId)}
            >
              取消
            </Button>
          )}
          {isFailed && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label={`重试 ${row.fileName}`}
              onClick={() => retryUpload(row.clientId)}
            >
              重试
            </Button>
          )}
          {row.status !== 'uploading' && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={`移除 ${row.fileName}`}
              onClick={() => removeRow(row.clientId)}
            >
              移除
            </Button>
          )}
        </div>
      </li>
    )
  }

  const policyHelp = policy.data
    ? `单个文件不超过 ${formatFileSize(policy.data.maxFileBytes)}，一次最多 ${policy.data.maxFilesPerSubmit} 个；上传完成后才能保存。`
    : undefined
  const unfinished = hasUnfinishedAttachments(value)

  return (
    <FormField label={label} labelId={labelId} help={policyHelp} error={error ?? (limitError || null)}>
      <div
        ref={containerRef}
        tabIndex={-1}
        aria-labelledby={labelId}
        data-slot="attachment-field"
        className="space-y-2 rounded-lg border border-dashed border-border p-3 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {disabled ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{disabledReason}</p>
            {value.length > 0 && <ul className="space-y-2">{value.map((row) => renderRow(row))}</ul>}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                ref={fileInputRef}
                type="file"
                multiple
                className="sr-only"
                aria-label="选择文件"
                disabled={policy.isPending || policy.isError}
                onChange={handleFilesSelected}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={policy.isPending || policy.isError}
                onClick={() => fileInputRef.current?.click()}
              >
                选择文件
              </Button>
              {policy.isPending && <span className="text-xs text-muted-foreground">正在读取上传限制…</span>}
              {policy.isError && (
                <Button type="button" variant="link" size="sm" onClick={() => void policy.refetch()}>
                  重试读取限制
                </Button>
              )}
            </div>
            {policy.isError && (
              <p role="alert" className="text-xs text-destructive">
                {describeAttachmentError(policy.error)}
              </p>
            )}
            {value.length > 0 && <ul className="space-y-2">{value.map((row) => renderRow(row))}</ul>}
            {unfinished && !error && (
              <p role="status" className="text-xs text-muted-foreground">
                附件未全部上传完成，完成或移除后才能保存。
              </p>
            )}
            {editing && <p className="text-xs text-muted-foreground">移除已保存的附件将在保存后生效。</p>}
          </>
        )}
      </div>
    </FormField>
  )
}
