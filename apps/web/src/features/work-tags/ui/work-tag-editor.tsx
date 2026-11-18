import { useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Combobox } from '@/shared/ui/controls/combobox'
import { workTagsOptions, type WorkTag, type WorkTagTarget } from '../api/queries'

/**
 * 展示会话或任务标签，选择即关联、点击移除即取消关联。
 * @param props 标签、所属团队、目标、写权限、是否折叠编辑控件，以及更改后的刷新回调。
 * @returns 可搜索的标签选择器与标签列表；保存及刷新期间阻止重复操作，失败保留选择供重试。
 */
export function WorkTagEditor({
  tags,
  teamId,
  target,
  readOnly,
  collapsible = false,
  onChanged,
}: {
  tags: WorkTag[]
  teamId: string
  target: WorkTagTarget
  readOnly: boolean
  collapsible?: boolean
  onChanged: () => void | Promise<unknown>
}) {
  const [editing, setEditing] = useState(false)
  const canEdit = !readOnly && (!collapsible || editing)
  const list = useInfiniteQuery({ ...workTagsOptions(teamId), enabled: canEdit })
  const linked = new Set(tags.map(({ id }) => id))
  const available = list.data?.pages.flatMap(({ data }) => data.items) ?? []
  const remaining = available.filter(({ id }) => !linked.has(id))
  const save = useMutation({
    mutationFn: ({ id, link }: { id: string; link: boolean }) =>
      apiClient.setWorkTagLink(id, link, target, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: async () => {
      await onChanged()
    },
  })
  const selected = (save.isPending || save.isError) && save.variables?.link ? save.variables.id : ''
  const failedChange = save.isError ? save.variables : undefined
  const isEmpty = list.isSuccess && available.length === 0 && !list.hasNextPage
  const isFullyLinked = list.isSuccess && available.length > 0 && remaining.length === 0 && !list.hasNextPage
  return (
    <div className="work-gap">
      {collapsible ? (
        <div className="row">
          <h4 className="font-semibold">工作标签</h4>
          <span className="spacer" />
          {!readOnly && (
            <Button
              unstyled
              type="button"
              className="text-btn"
              aria-label={editing ? '完成工作标签管理' : '管理工作标签'}
              aria-expanded={editing}
              disabled={save.isPending}
              onClick={() => setEditing(!editing)}
            >
              {editing ? '完成' : '管理'}
            </Button>
          )}
        </div>
      ) : (
        <h3 className="task-section-title">工作标签</h3>
      )}
      <div className="ctx-refs">
        {tags.map(({ id, name }) => (
          <span className="ctx-ref" key={id}>
            {name}
            {canEdit && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label={`移除标签${name}`}
                disabled={save.isPending}
                onClick={() => save.mutate({ id, link: false })}
              >
                <X className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
              </Button>
            )}
          </span>
        ))}
        {tags.length === 0 && <span className="small muted">暂无标签</span>}
      </div>
      {canEdit && (
        <div className="grid gap-2">
          <Combobox
            aria-label="添加工作标签"
            value={selected}
            options={remaining.map(({ id, name }) => ({ value: id, label: name }))}
            placeholder={list.isPending ? '正在加载标签…' : '选择标签，立即添加'}
            searchPlaceholder="搜索工作标签"
            emptyMessage="没有匹配的标签"
            disabled={list.isPending || save.isPending || remaining.length === 0}
            onValueChange={(id) => {
              if (!save.isPending && !linked.has(id)) save.mutate({ id, link: true })
            }}
          />
          {isEmpty && <p className="small muted">团队暂无工作标签，可在会话列表的「管理标签」中创建。</p>}
          {isFullyLinked && <p className="small muted">全部标签已添加。</p>}
          {save.isPending && (
            <p className="small muted" role="status">
              {save.variables?.link ? '正在添加标签…' : '正在移除标签…'}
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
                重试加载标签
              </Button>
            </>
          )}
        </div>
      )}
      {failedChange && (
        <>
          <p role="alert" className="field-error">
            {describeRequestError(save.error).description}
          </p>
          <Button type="button" variant="outline" onClick={() => save.mutate(failedChange)}>
            {failedChange.link ? '重试添加标签' : '重试移除标签'}
          </Button>
        </>
      )}
    </div>
  )
}
