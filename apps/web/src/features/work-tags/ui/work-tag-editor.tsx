import { useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import { workTagsOptions, type WorkTag, type WorkTagTarget } from '../api/queries'

/**
 * 展示会话或任务关联的标签，写权限用户可关联已有标签或取消关联。
 * @param props 标签、所属团队、目标、写权限、是否折叠编辑控件，以及更改后的刷新回调。
 * @returns 标签列表与适用的编辑控件。
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
  onChanged: () => void
}) {
  const [selected, setSelected] = useState('')
  const [editing, setEditing] = useState(false)
  const canEdit = !readOnly && (!collapsible || editing)
  const client = useQueryClient()
  const list = useInfiniteQuery({ ...workTagsOptions(teamId), enabled: canEdit })
  const linked = new Set(tags.map(({ id }) => id))
  const remaining = (list.data?.pages.flatMap(({ data }) => data.items) ?? []).filter(({ id }) => !linked.has(id))
  const save = useMutation({
    mutationFn: ({ id, link }: { id: string; link: boolean }) =>
      apiClient.setWorkTagLink(id, link, target, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: () => {
      setSelected('')
      void client.invalidateQueries({ queryKey: workTagsOptions(teamId).queryKey })
      onChanged()
    },
  })
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
              aria-label={editing ? '收起工作标签管理' : '管理工作标签'}
              aria-expanded={editing}
              disabled={save.isPending}
              onClick={() => setEditing(!editing)}
            >
              {editing ? '收起' : '管理'}
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
                size="icon-xs"
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
        <div className="row flex-wrap">
          <label className="field">
            <span>添加工作标签</span>
            <Select value={selected} disabled={list.isPending} onChange={(event) => setSelected(event.target.value)}>
              <option value="">{list.isPending ? '正在加载…' : '选择标签'}</option>
              {remaining.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={!selected || save.isPending}
            onClick={() => save.mutate({ id: selected, link: true })}
          >
            添加
          </Button>
          {list.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              disabled={list.isFetchingNextPage}
              onClick={() => void list.fetchNextPage()}
            >
              更多标签
            </Button>
          )}
          {list.isError && (
            <Button type="button" variant="ghost" onClick={() => void list.refetch()}>
              重试加载标签
            </Button>
          )}
        </div>
      )}
      {save.isError && (
        <p role="alert" className="field-error">
          {describeRequestError(save.error).description}
        </p>
      )}
    </div>
  )
}
