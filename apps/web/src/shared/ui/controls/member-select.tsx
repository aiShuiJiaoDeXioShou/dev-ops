import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { Popover } from 'radix-ui'
import { avatarToneClassName, memberInitial } from '@/shared/lib/avatar-tone'
import { cn } from '@/shared/lib/utils'
import { Button } from './button'
import { Input } from './input'
import type { MemberOption, MemberSelectionDetail } from './member-multiselect'

interface MemberSelectProps {
  id: string
  value: string
  /** 更新表单中的成员 ID，空字符串表示未指定。 */
  onValueChange: (value: string) => void
  options: MemberOption[]
  /** 用于候选加载前以及历史负责人不在候选列表时的回填。 */
  selectedDetail?: MemberSelectionDetail | null
  currentUserId: string
  loading: boolean
  error: string | null
  onRetry: () => void
  disabled: boolean
  /** 表单可滚动字段区，弹层在其范围内翻转，避免挡住固定操作栏。 */
  collisionBoundary: HTMLElement | null
}

const optionClassName =
  'h-auto min-h-11 w-full justify-start gap-2 rounded-md px-2 py-1.5 text-left font-normal hover:bg-accent'

/**
 * 在原字段位置展开成员搜索，选中或清空后收起并归还焦点。
 * @param props 字段标签关联、表单值、团队候选、回填详情及加载、失败和禁用状态。
 * @returns 受控人员单选框，检索词和高亮仅影响当前展开的候选，选择由表单统一保存。
 */
export function MemberSelect({
  id,
  value,
  onValueChange,
  options,
  selectedDetail,
  currentUserId,
  loading,
  error,
  onRetry,
  disabled,
  collisionBoundary,
}: MemberSelectProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listboxRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState<number | null>(null)

  const listboxId = `${id}-listbox`
  const valueId = `${id}-value`
  const keyword = query.trim().toLowerCase()
  const matches = options.filter(
    (member) => member.name.toLowerCase().includes(keyword) || member.email.toLowerCase().includes(keyword),
  )
  const selectedIndex = matches.findIndex((member) => member.userId === value)
  const selected =
    options.find((member) => member.userId === value) ?? (selectedDetail?.userId === value ? selectedDetail : null)
  const selectedName = selected?.name ?? '未知成员'
  const unavailable = selected?.available === false
  const canClear = value !== '' && !keyword
  const optionCount = matches.length + Number(canClear)
  const initialIndex = selectedIndex >= 0 || matches.length === 0 ? selectedIndex : 0
  const activeIndex = highlighted !== null && highlighted < optionCount ? highlighted : initialIndex
  const canResetSearch = !loading && keyword !== '' && matches.length === 0
  const emptyMessage = keyword ? '无匹配成员' : '暂无可选成员'
  const status = error ?? (matches.length === 0 && (loading ? '成员加载中…' : emptyMessage))

  const revealOption = useCallback((index: number) => {
    if (index >= 0) listboxRef.current?.children.item(index)?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  useEffect(() => {
    if (!open || disabled || keyword || selectedIndex < 0) return
    // 候选异步加载后也要定位已选项，等浮层算完可用高度再滚动。
    const frame = requestAnimationFrame(() => revealOption(selectedIndex))
    return () => cancelAnimationFrame(frame)
  }, [open, disabled, keyword, selectedIndex, revealOption])

  const changeQuery = (next: string) => {
    setQuery(next)
    setHighlighted(null)
    listboxRef.current?.parentElement?.scrollTo?.({ top: 0 })
  }

  const changeOpen = (next: boolean) => {
    setOpen(next)
    setQuery('')
    setHighlighted(null)
  }

  const choose = (next: string) => {
    if (disabled) return
    onValueChange(next)
    changeOpen(false)
  }

  const handleSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
    if (event.key === 'Enter') {
      // 在检索框里按回车只处理候选，避免无匹配时提交整个表单。
      event.preventDefault()
      const member = matches[activeIndex]
      if (member) choose(member.userId)
      else if (canClear && activeIndex === matches.length) choose('')
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    if (optionCount === 0) return
    const offset = event.key === 'ArrowDown' ? 1 : -1
    const startIndex = activeIndex < 0 && offset < 0 ? 0 : activeIndex
    const nextIndex = (startIndex + offset + optionCount) % optionCount
    setHighlighted(nextIndex)
    revealOption(nextIndex)
  }

  return (
    <Popover.Root open={open && !disabled} onOpenChange={changeOpen}>
      <Popover.Anchor asChild>
        <div ref={anchorRef} className="relative min-w-0">
          {open && !disabled ? (
            <>
              <Input
                id={id}
                ref={searchRef}
                role="combobox"
                type="text"
                className={cn('h-11', (error || canResetSearch) && 'pr-24')}
                placeholder="搜索姓名或邮箱"
                value={query}
                autoFocus
                autoComplete="off"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={activeIndex < 0 ? undefined : `${listboxId}-${activeIndex}`}
                onChange={(event) => changeQuery(event.target.value)}
                onKeyDown={handleSearchKey}
              />
              {(error || canResetSearch) && (
                <Button
                  type="button"
                  data-slot="member-select-search-action"
                  variant="ghost"
                  size="sm"
                  className="absolute top-1/2 right-1 h-10 -translate-y-1/2 px-2 text-xs"
                  disabled={loading}
                  onClick={() => {
                    searchRef.current?.focus()
                    if (error) onRetry()
                    else changeQuery('')
                  }}
                >
                  {error ? '重试' : '清除搜索'}
                </Button>
              )}
            </>
          ) : (
            <Popover.Trigger asChild>
              <Button
                id={id}
                type="button"
                variant="outline"
                aria-haspopup="listbox"
                aria-describedby={valueId}
                className="h-11 w-full min-w-0 justify-between border-input px-3 font-normal shadow-xs dark:bg-background"
                disabled={disabled}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                  event.preventDefault()
                  changeOpen(true)
                }}
              >
                <span id={valueId} className="min-w-0">
                  {value ? (
                    <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-secondary py-0.5 pr-2 pl-0.5">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'grid size-5 shrink-0 place-items-center rounded-full text-xs font-medium',
                          avatarToneClassName(value),
                        )}
                      >
                        {memberInitial(selectedName)}
                      </span>
                      <span className="truncate">{selectedName}</span>
                      {unavailable && <span className="shrink-0 text-xs text-destructive">已失效</span>}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">未指定</span>
                  )}
                </span>
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Button>
            </Popover.Trigger>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          role="presentation"
          align="start"
          sideOffset={4}
          collisionBoundary={collisionBoundary}
          collisionPadding={8}
          hideWhenDetached
          className="z-50 w-(--radix-popover-trigger-width) overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
          style={{ maxHeight: 'min(16rem, var(--radix-popover-content-available-height, 16rem))' }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && anchorRef.current?.contains(event.target)) event.preventDefault()
          }}
          onEscapeKeyDown={(event) => {
            if (event.isComposing || event.keyCode === 229) event.preventDefault()
          }}
        >
          {status && (
            <p role="status" className={cn('px-2 py-2 text-sm', error ? 'text-destructive' : 'text-muted-foreground')}>
              {status}
            </p>
          )}
          <div id={listboxId} ref={listboxRef} role="listbox" aria-label="候选成员">
            {matches.map((member, index) => (
              <Button
                key={member.userId}
                id={`${listboxId}-${index}`}
                type="button"
                variant="ghost"
                role="option"
                aria-selected={member.userId === value}
                tabIndex={-1}
                className={cn(optionClassName, activeIndex === index && 'bg-accent')}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={(event) => {
                  if (event.pointerType === 'mouse') setHighlighted(index)
                }}
                onClick={() => choose(member.userId)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-full text-xs font-medium',
                    avatarToneClassName(member.userId),
                  )}
                >
                  {memberInitial(member.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1">
                    <span className="truncate">{member.name}</span>
                    {member.userId === currentUserId && (
                      <span className="shrink-0 text-xs text-muted-foreground">· 我</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{member.email}</span>
                </span>
                {member.userId === value && <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />}
              </Button>
            ))}
            {canClear && (
              <Button
                id={`${listboxId}-${matches.length}`}
                type="button"
                variant="ghost"
                role="option"
                aria-selected={false}
                tabIndex={-1}
                className={cn(
                  'pointer-coarse:min-h-11 mt-1 h-8 w-full justify-start rounded-md border-t border-border px-2 font-normal text-muted-foreground',
                  activeIndex === matches.length && 'bg-accent text-accent-foreground',
                )}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={(event) => {
                  if (event.pointerType === 'mouse') setHighlighted(matches.length)
                }}
                onClick={() => choose('')}
              >
                清除选择
              </Button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
