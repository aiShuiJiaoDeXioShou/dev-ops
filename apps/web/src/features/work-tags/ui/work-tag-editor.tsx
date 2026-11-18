import { useRef, useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, X } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Combobox } from '@/shared/ui/controls/combobox'
import { Input } from '@/shared/ui/controls/input'
import { Tag } from '@/shared/ui/tag'
import { workTagsOptions, type WorkTag, type WorkTagTarget } from '../api/queries'
import { WorkTagDialog } from './work-tag-dialog'

type TagChange = { action: 'create'; name: string } | { action: 'link' | 'unlink'; id: string }

/**
 * 以 Tag 展示会话或任务标签，允许直接输入新增、选择已有标签与移除关联。
 * @param props 标签、所属团队、关联目标、只读状态，以及保存后的刷新回调。
 * @returns 就地标签编辑器；团队标签的删除由管理弹窗明确确认，失败保留输入以便重试。
 */
export function WorkTagEditor({
  tags,
  teamId,
  target,
  readOnly,
  onChanged,
}: {
  tags: WorkTag[]
  teamId: string
  target: WorkTagTarget
  readOnly: boolean
  onChanged: () => void | Promise<unknown>
}) {
  const [name, setName] = useState('')
  const [managing, setManaging] = useState(false)
  const manager = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const client = useQueryClient()
  const list = useInfiniteQuery({ ...workTagsOptions(teamId), enabled: !readOnly })
  const linked = new Set(tags.map(({ id }) => id))
  const remaining = (list.data?.pages.flatMap(({ data }) => data.items) ?? []).filter(({ id }) => !linked.has(id))
  const save = useMutation({
    mutationFn: async (change: TagChange) => {
      // 创建按团队和规范化名称幂等；关联失败后的重试复用同名标签。
      const id =
        change.action === 'create'
          ? (await apiClient.createWorkTag(teamId, { name: change.name }, { idempotencyKey: createIdempotencyKey() }))
              .data.id
          : change.id
      await apiClient.setWorkTagLink(id, change.action !== 'unlink', target, { idempotencyKey: createIdempotencyKey() })
    },
    onSuccess: async (_, change) => {
      if (change.action === 'create') setName('')
      await Promise.all([
        onChanged(),
        change.action === 'create'
          ? client.invalidateQueries({ queryKey: workTagsOptions(teamId).queryKey })
          : undefined,
      ])
    },
    onSettled: () =>
      requestAnimationFrame(() => {
        if (document.activeElement === document.body) input.current?.focus()
      }),
  })
  const failedChange = save.isError ? save.variables : undefined
  return (
    <div className="work-gap">
      <div className="row">
        <h3 className="task-section-title">工作标签</h3>
        <span className="spacer" />
        {!readOnly && (
          <Button
            ref={manager}
            type="button"
            variant="ghost"
            disabled={save.isPending}
            onClick={() => setManaging(true)}
          >
            管理标签
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {tags.map((tag) => (
          <Tag key={tag.id} variant="blue" className="inline-flex max-w-full items-center gap-1 whitespace-normal">
            <span className="min-w-0 wrap-break-word">{tag.name}</span>
            {!readOnly && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`移除标签${tag.name}`}
                title="从当前会话或任务移除"
                disabled={save.isPending}
                onClick={() => save.mutate({ action: 'unlink', id: tag.id })}
              >
                <X className="size-3" aria-hidden="true" />
              </Button>
            )}
          </Tag>
        ))}
        {readOnly && tags.length === 0 && <span className="small muted">暂无标签</span>}
      </div>
      {!readOnly && (
        <div className="grid gap-2">
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim() && !save.isPending) save.mutate({ action: 'create', name: name.trim() })
            }}
          >
            <Input
              ref={input}
              aria-label="新建工作标签"
              placeholder="输入标签名称，按 Enter 添加"
              value={name}
              maxLength={40}
              disabled={save.isPending}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229))
                  event.preventDefault()
              }}
            />
            <Button
              type="submit"
              variant="outline"
              size="icon"
              aria-label="添加工作标签"
              title="添加标签"
              disabled={!name.trim() || save.isPending}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Button>
          </form>
          {remaining.length > 0 && (
            <Combobox
              aria-label="选择已有工作标签"
              value=""
              options={remaining.map(({ id, name: label }) => ({ value: id, label }))}
              placeholder="选择已有标签"
              searchPlaceholder="搜索工作标签"
              emptyMessage="没有匹配的标签"
              disabled={save.isPending}
              onValueChange={(id) => {
                if (!save.isPending && !linked.has(id)) save.mutate({ action: 'link', id })
              }}
            />
          )}
          {list.isPending && (
            <p className="small muted" role="status">
              正在加载已有标签…
            </p>
          )}
          {save.isPending && (
            <p className="small muted" role="status">
              {save.variables?.action === 'unlink' ? '正在移除标签…' : '正在添加标签…'}
            </p>
          )}
          {list.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              {list.isFetchingNextPage ? '正在加载…' : '加载更多标签'}
            </Button>
          )}
          {list.isError && (
            <>
              <p className="field-error" role="alert">
                {describeRequestError(list.error).description}
              </p>
              <Button type="button" variant="ghost" disabled={list.isFetching} onClick={() => void list.refetch()}>
                重试加载已有标签
              </Button>
            </>
          )}
          {failedChange && (
            <>
              <p className="field-error" role="alert">
                {describeRequestError(save.error).description}
              </p>
              <Button type="button" variant="outline" onClick={() => save.mutate(failedChange)}>
                重试{failedChange.action === 'unlink' ? '移除' : '添加'}标签
              </Button>
            </>
          )}
        </div>
      )}
      {managing && !readOnly && (
        <WorkTagDialog
          teamId={teamId}
          onClose={() => {
            setManaging(false)
            requestAnimationFrame(() => manager.current?.focus())
          }}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}
