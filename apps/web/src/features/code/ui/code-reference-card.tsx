import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { Pencil, Plus, RefreshCw, Unlink2 } from 'lucide-react'
import { RemoveWorkItemRelation } from '@/features/collaboration/ui/remove-work-item-relation'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Tag } from '@/shared/ui/tag'
import { Button } from '@/shared/ui/controls/button'
import { useToast } from '@/shared/ui/toast'
import { CodeReferenceDialog } from './code-reference-dialog'

type CodeReference = ApiSuccessData<'/api/v1/requirements/{requirementId}', 'get'>['linkedCodeReferences'][number]

/**
 * 在事项详情维护 Commit、Issue 和 PR 引用。
 * @param props 事项标识、项目、引用列表和写入权限。
 * @returns 带新增、刷新和移除操作的引用列表，移除时记录原因。
 */
export function WorkItemCodeReferences({
  kind,
  id,
  projectId,
  references,
  canWrite,
}: {
  kind: 'requirement' | 'bug'
  id: string
  projectId: string
  references: CodeReference[]
  canWrite: boolean
}) {
  const client = useQueryClient()
  const { showToast } = useToast()
  const [editor, setEditor] = useState<{ item?: CodeReference; trigger: HTMLButtonElement } | null>(null)
  const [removal, setRemoval] = useState<{ item: CodeReference; trigger: HTMLButtonElement } | null>(null)
  const create = useRef<HTMLButtonElement>(null)
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: [kind === 'requirement' ? 'requirements' : 'bugs', 'detail', id] }),
      client.invalidateQueries({ queryKey: ['collaboration', 'activities', kind, id] }),
    ])
  const refresh = useMutation({
    mutationFn: (referenceId: string) => apiClient.refreshCodeReference(referenceId),
    onSuccess: async () => {
      await invalidate()
      showToast('引用已刷新。', 'success')
    },
  })

  return (
    <section className="space-y-2" aria-label="代码引用">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">代码引用</h3>
        {canWrite && (
          <Button
            ref={create}
            type="button"
            size="sm"
            variant="outline"
            onClick={(event) => setEditor({ trigger: event.currentTarget })}
          >
            <Plus aria-hidden="true" />
            添加引用
          </Button>
        )}
      </div>
      {refresh.isError && (
        <p role="alert" className="text-sm text-destructive">
          {describeRequestError(refresh.error).description}
        </p>
      )}
      {references.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无代码引用。</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {references.map((reference) => {
            const title = reference.title || reference.remoteId
            return (
              <li key={reference.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                {reference.url ? (
                  <a
                    className="min-w-0 flex-1 text-primary wrap-anywhere hover:underline"
                    href={reference.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {title}
                  </a>
                ) : (
                  <span className="min-w-0 flex-1 wrap-anywhere">{title}</span>
                )}
                <Tag variant={reference.lastCheckStatus === 'ok' ? 'green' : 'red'}>
                  {reference.lastCheckStatus === 'ok' ? '正常' : '待核对'}
                </Tag>
                {canWrite && (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="work-item-icon-button"
                      aria-label={`编辑引用 ${title}`}
                      onClick={(event) => setEditor({ item: reference, trigger: event.currentTarget })}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="work-item-icon-button"
                      aria-label={`刷新引用 ${title}`}
                      disabled={refresh.isPending}
                      onClick={() => refresh.mutate(reference.id)}
                    >
                      <RefreshCw aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="work-item-icon-button"
                      aria-label={`移除引用 ${title}`}
                      onClick={(event) => setRemoval({ item: reference, trigger: event.currentTarget })}
                    >
                      <Unlink2 aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {editor && (
        <CodeReferenceDialog
          projectId={projectId}
          targetType={kind}
          targetId={id}
          open
          onOpenChange={(open) => !open && setEditor(null)}
          reference={editor.item}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const target = editor.trigger.isConnected ? editor.trigger : create.current
            target?.focus({ preventScroll: true })
          }}
        />
      )}
      {removal && (
        <RemoveWorkItemRelation
          title={`移除引用「${removal.item.title || removal.item.remoteId}」？`}
          description="移除原因会写入当前事项的操作记录。"
          focusTarget={() => (removal.trigger.isConnected ? removal.trigger : create.current)}
          onClose={() => setRemoval(null)}
          onRemove={async (reason) => {
            await apiClient.removeCodeReference(removal.item.id, { reason })
            await invalidate()
            showToast('引用已移除。', 'success')
          }}
        />
      )}
    </section>
  )
}
