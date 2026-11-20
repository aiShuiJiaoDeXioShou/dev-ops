import { useId, useRef, useState, type Ref } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Funnel } from 'lucide-react'
import { workTagsOptions } from '@/features/work-tags/api/queries'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import { FormField } from '@/shared/ui/controls/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/controls/popover'
import { Select } from '@/shared/ui/controls/select'

/**
 * 用工作标签筛选团队会话列表，面板内选好条件并「应用筛选」后才生效。
 * @param props 团队标识、已应用的标签、只读状态、触发器 ref、应用回调与管理标签入口。
 * @returns 会话列表工具条中的筛选触发器，以及带键盘支持和焦点归还的筛选面板。
 */
export function ConversationFilter({
  teamId,
  value,
  readOnly,
  triggerRef,
  onApply,
  onManageTags,
}: {
  teamId: string
  value: string
  readOnly: boolean
  /** 触发器 ref，供管理标签弹窗关闭后归还焦点。 */
  triggerRef?: Ref<HTMLButtonElement>
  onApply: (tagId: string) => void
  onManageTags: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  // 从面板进入标签管理时，焦点交给弹窗，浮层不再把它抢回触发器。
  const handingFocusAway = useRef(false)
  const tagFieldId = useId()
  const tags = useInfiniteQuery({ ...workTagsOptions(teamId), enabled: open })
  const tagItems = tags.data?.pages.flatMap(({ data }) => data.items) ?? []
  const count = value ? 1 : 0
  // 已应用的标签可能已被删除或不在当前分页，仍需在下拉中保底显示，避免静默换成「全部标签」。
  const selectedTagMissing = draft !== '' && tags.isSuccess && !tagItems.some(({ id }) => id === draft)
  let optionHelp: string | undefined
  if (tags.isFetching) optionHelp = '正在加载标签选项…'
  else if (tags.isSuccess && tagItems.length === 0)
    optionHelp = readOnly ? '团队还没有工作标签。' : '团队还没有工作标签，可在「管理标签」中创建。'

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          unstyled
          type="button"
          className={cn('icon-btn conv-filter-trigger', count > 0 && 'is-active')}
          aria-label={count ? `会话筛选，已应用 ${count} 个条件` : '会话筛选'}
          title="会话筛选"
        >
          <Funnel className="size-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        aria-label="会话筛选"
        className="conv-filter-panel"
        focusPanelOnOpen
        onCloseAutoFocus={(event) => {
          if (!handingFocusAway.current) return
          handingFocusAway.current = false
          event.preventDefault()
        }}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            setOpen(false)
            onApply(draft)
          }}
        >
          <FormField label="工作标签" htmlFor={tagFieldId} help={optionHelp}>
            <Select className="w-full" id={tagFieldId} value={draft} onChange={(event) => setDraft(event.target.value)}>
              <option value="">全部标签</option>
              {tagItems.map(({ id, name }) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
              {selectedTagMissing && <option value={draft}>所选标签不可用</option>}
            </Select>
            {tags.isError && (
              <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                标签选项加载失败
                <Button type="button" size="sm" variant="ghost" onClick={() => void tags.refetch()}>
                  重试
                </Button>
              </div>
            )}
            {tags.hasNextPage && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={tags.isFetchingNextPage}
                onClick={() => void tags.fetchNextPage()}
              >
                {tags.isFetchingNextPage ? '加载中…' : '更多标签'}
              </Button>
            )}
          </FormField>
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                handingFocusAway.current = true
                setOpen(false)
                onManageTags()
              }}
            >
              管理标签
            </Button>
          )}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" disabled={!draft} onClick={() => setDraft('')}>
              重置
            </Button>
            <Button type="submit">应用筛选</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
