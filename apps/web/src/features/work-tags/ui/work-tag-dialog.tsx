import { useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, Trash2 } from 'lucide-react'
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
} from '@/shared/ui/controls/alert-dialog'
import { Button, buttonVariants } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFormBody,
  DialogFormHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { workTagsOptions, type WorkTag } from '../api/queries'
import { tagTone } from './tag-tone'
import './work-tags.css'

type TagEdit =
  { action: 'create'; name: string } | { action: 'rename'; id: string; name: string } | { action: 'remove'; id: string }

/**
 * 管理团队标签目录：顶部一行新建，列表内就地改名，删除前确认后果。
 * @param props 团队标识、关闭回调与目录变更后的刷新回调。
 * @returns 标签管理弹窗；失败保留输入并就地提示，保存期间阻止重复提交与关闭。
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
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState<{ id: string; name: string }>()
  const [removing, setRemoving] = useState<WorkTag>()
  const createInput = useRef<HTMLInputElement>(null)
  const renameButtons = useRef(new Map<string, HTMLButtonElement>())
  const removeOpener = useRef<HTMLButtonElement>(null)
  const client = useQueryClient()
  const list = useInfiniteQuery(workTagsOptions(teamId))
  const tags = list.data?.pages.flatMap(({ data }) => data.items) ?? []
  const save = useMutation({
    mutationFn: async (input: TagEdit) => {
      const options = { idempotencyKey: createIdempotencyKey() }
      if (input.action === 'remove') await apiClient.removeWorkTag(input.id, options)
      else if (input.action === 'rename') await apiClient.renameWorkTag(input.id, { name: input.name }, options)
      else await apiClient.createWorkTag(teamId, { name: input.name }, options)
    },
    onSuccess: async (_, input) => {
      if (input.action === 'create') setDraft('')
      if (input.action === 'rename') setRenaming(undefined)
      await Promise.all([client.invalidateQueries({ queryKey: workTagsOptions(teamId).queryKey }), onChanged()])
      // 改名和删除会移除行内焦点元素，统一回到新建输入框。
      if (input.action !== 'create') requestAnimationFrame(() => createInput.current?.focus())
    },
  })
  const submitRename = () => {
    const name = renaming?.name.trim()
    if (renaming && name && !save.isPending) save.mutate({ action: 'rename', id: renaming.id, name })
  }
  const cancelRename = () => {
    if (!renaming || save.isPending) return
    const { id } = renaming
    setRenaming(undefined)
    requestAnimationFrame(() => renameButtons.current.get(id)?.focus())
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose()
      }}
    >
      <DialogContent
        className="dialog-w-md"
        onEscapeKeyDown={(event) => {
          // 改名时 Esc 只取消改名，不关闭整个弹窗。
          if (!renaming) return
          event.preventDefault()
          cancelRename()
        }}
      >
        <DialogFormHeader>
          <DialogTitle>管理工作标签</DialogTitle>
          <DialogDescription>标签用于整理团队的会话与任务，改名和删除对所有关联同时生效。</DialogDescription>
        </DialogFormHeader>
        <DialogFormBody className="work-tag-manage">
          <form
            className="work-tag-manage-create"
            onSubmit={(event) => {
              event.preventDefault()
              const name = draft.trim()
              if (name && !save.isPending) save.mutate({ action: 'create', name })
            }}
          >
            <Input
              ref={createInput}
              autoFocus
              aria-label="新标签名称"
              placeholder="输入新标签名称，按 Enter 创建"
              value={draft}
              maxLength={40}
              disabled={save.isPending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
                  event.preventDefault()
              }}
            />
            <Button type="submit" variant="outline" disabled={!draft.trim() || save.isPending}>
              创建
            </Button>
          </form>
          {save.isError && (
            <p role="alert" className="field-error">
              {describeRequestError(save.error).description}
            </p>
          )}
          <div className="work-tag-manage-meta">
            {list.isSuccess && (list.hasNextPage ? `已加载 ${tags.length} 个标签` : `共 ${tags.length} 个标签`)}
          </div>
          {list.isPending && (
            <p className="small muted" role="status">
              正在加载标签…
            </p>
          )}
          {list.isError && (
            <div className="grid gap-2">
              <p role="alert" className="field-error">
                {describeRequestError(list.error).description}
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => void list.refetch()}>
                重试加载标签
              </Button>
            </div>
          )}
          {list.isSuccess && tags.length === 0 && (
            <p className="work-tag-manage-empty">还没有标签，在上方输入名称创建。</p>
          )}
          {tags.length > 0 && (
            <ul className="work-tag-manage-list">
              {tags.map((tag) =>
                renaming?.id === tag.id ? (
                  <li key={tag.id} className="work-tag-manage-row">
                    <form
                      className="work-tag-manage-rename"
                      onSubmit={(event) => {
                        event.preventDefault()
                        submitRename()
                      }}
                    >
                      <Input
                        autoFocus
                        aria-label={`标签「${tag.name}」的新名称`}
                        value={renaming.name}
                        maxLength={40}
                        disabled={save.isPending}
                        onChange={(event) => setRenaming({ id: tag.id, name: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
                            event.preventDefault()
                        }}
                      />
                      <Button type="submit" size="sm" disabled={!renaming.name.trim() || save.isPending}>
                        {save.isPending ? '保存中…' : '保存'}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={cancelRename}>
                        取消
                      </Button>
                    </form>
                  </li>
                ) : (
                  <li key={tag.id} className="work-tag-manage-row">
                    <span className="work-tag-chip" data-tone={tagTone(tag.id)}>
                      {tag.name}
                    </span>
                    <span className="work-tag-manage-actions">
                      <Button
                        ref={(button) => {
                          if (button) renameButtons.current.set(tag.id, button)
                          else renameButtons.current.delete(tag.id)
                        }}
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`改名标签「${tag.name}」`}
                        title="改名"
                        disabled={save.isPending}
                        onClick={() => setRenaming({ id: tag.id, name: tag.name })}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="work-tag-manage-remove"
                        aria-label={`删除标签「${tag.name}」`}
                        title="删除"
                        disabled={save.isPending}
                        onClick={(event) => {
                          removeOpener.current = event.currentTarget
                          setRemoving(tag)
                        }}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Button>
                    </span>
                  </li>
                ),
              )}
            </ul>
          )}
          {list.hasNextPage && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="justify-self-start"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? '正在加载…' : '加载更多标签'}
            </Button>
          )}
        </DialogFormBody>
        <AlertDialog
          open={Boolean(removing)}
          onOpenChange={(open) => {
            if (!open) setRemoving(undefined)
          }}
        >
          <AlertDialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault()
              removeOpener.current?.focus()
            }}
          >
            <AlertDialogHeader>
              <AlertDialogTitle>删除标签「{removing?.name}」？</AlertDialogTitle>
              <AlertDialogDescription>它会从所有会话和任务中移除，删除后不能恢复。</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive' })}
                onClick={() => {
                  if (removing) save.mutate({ action: 'remove', id: removing.id })
                }}
              >
                删除标签
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  )
}
