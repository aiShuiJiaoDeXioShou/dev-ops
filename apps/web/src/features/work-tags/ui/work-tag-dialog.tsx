import { useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/controls/alert-dialog'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFormBody,
  DialogFormFooter,
  DialogFormHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { workTagsOptions, type WorkTag } from '../api/queries'

type TagEdit = { action: 'save'; name: string; id?: string } | { action: 'remove'; id: string }

/**
 * 管理团队标签目录，在明确确认后删除标签及其全部关联。
 * @param props 团队标识、关闭回调与目录变更后的刷新回调。
 * @returns 标签创建、改名与删除弹窗；失败保留输入，保存和刷新期间阻止重复提交。
 */
export function WorkTagDialog({
  teamId,
  onClose,
  onChanged,
}: {
  teamId: string
  onClose: () => void
  onChanged: () => void | Promise<unknown>
}) {
  const [editing, setEditing] = useState<WorkTag>()
  const [name, setName] = useState('')
  const client = useQueryClient()
  const list = useInfiniteQuery(workTagsOptions(teamId))
  const tags = list.data?.pages.flatMap(({ data }) => data.items) ?? []
  const save = useMutation({
    mutationFn: async (input: TagEdit) => {
      const options = { idempotencyKey: createIdempotencyKey() }
      if (input.action === 'remove') await apiClient.removeWorkTag(input.id, options)
      else if (input.id) await apiClient.renameWorkTag(input.id, { name: input.name }, options)
      else await apiClient.createWorkTag(teamId, { name: input.name }, options)
    },
    onSuccess: async () => {
      setEditing(undefined)
      setName('')
      await Promise.all([client.invalidateQueries({ queryKey: workTagsOptions(teamId).queryKey }), onChanged()])
    },
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose()
      }}
    >
      <DialogContent className="dialog-w-md">
        <DialogFormHeader>
          <DialogTitle>管理工作标签</DialogTitle>
          <DialogDescription>为团队会话与任务维护分类。</DialogDescription>
        </DialogFormHeader>
        <DialogFormBody>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim() && !save.isPending) save.mutate({ action: 'save', name: name.trim(), id: editing?.id })
            }}
          >
            <div className="row flex-wrap">
              <label className="field">
                <span>{editing ? '修改标签名称' : '新建标签'}</span>
                <Input autoFocus value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
              </label>
              <Button type="submit" disabled={!name.trim() || save.isPending}>
                {editing ? '保存名称' : '创建标签'}
              </Button>
            </div>
          </form>
          {list.isPending && <p className="small muted">正在加载标签…</p>}
          {list.isError && (
            <Button type="button" variant="ghost" onClick={() => void list.refetch()}>
              重试加载标签
            </Button>
          )}
          <ul>
            {tags.map((tag) => (
              <li key={tag.id} className="row work-gap">
                <strong>{tag.name}</strong>
                <span className="spacer" />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(tag)
                    setName(tag.name)
                  }}
                >
                  改名
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="ghost" disabled={save.isPending}>
                      删除
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>删除 {tag.name}？</AlertDialogTitle>
                      <AlertDialogDescription>此标签将从会话和任务中移除。</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => save.mutate({ action: 'remove', id: tag.id })}>
                        确认删除
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              加载更多
            </Button>
          )}
          {save.isError && (
            <p role="alert" className="field-error">
              {describeRequestError(save.error).description}
            </p>
          )}
        </DialogFormBody>
        <DialogFormFooter>
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
            关闭
          </Button>
        </DialogFormFooter>
      </DialogContent>
    </Dialog>
  )
}
