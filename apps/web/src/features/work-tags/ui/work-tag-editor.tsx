import { useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import { workTagsOptions, type WorkTag, type WorkTagTarget } from '../api/queries'

/** 展示目标关联的标签，写权限用户可以选择已有标签或取消关联。 */
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
  onChanged: () => void
}) {
  const [selected, setSelected] = useState('')
  const client = useQueryClient()
  const list = useInfiniteQuery({ ...workTagsOptions(teamId), enabled: !readOnly })
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
      <h3 className="task-section-title">工作标签</h3>
      <div className="ctx-refs">
        {tags.map(({ id, name }) => (
          <span className="ctx-ref" key={id}>
            {name}
            {!readOnly && (
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
      {!readOnly && (
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
