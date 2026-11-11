import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { CheckIcon, ChevronDownIcon, XIcon } from 'lucide-react'
import { avatarToneClassName } from '@/shared/lib/avatar-tone'
import { cn } from '@/shared/lib/utils'
import { Button } from './button'

export type MemberRole = 'admin' | 'developer' | 'viewer'
export type MemberStatus = 'active' | 'disabled' | 'missing'

/** 候选成员；options 只传入 status='active' 的正常成员。 */
export interface MemberOption {
  userId: string
  name: string
  email: string
  role: MemberRole
  status: MemberStatus
  available: boolean
}

/**
 * 已选成员的展示详情。
 * 业务记录回填时只能提供姓名、状态与可用性，因此邮箱与角色缺省，避免伪造候选数据。
 */
export interface MemberSelectionDetail {
  userId: string
  name: string
  status: MemberStatus
  available: boolean
}

export interface MemberMultiSelectProps {
  /** 已选 userId，按加入顺序保存。 */
  values: string[]
  /** 已选集合变化回调；组件只做受控展示，不持久化。 */
  onValuesChange: (next: string[]) => void
  /** 候选成员，仅包含当前团队正常成员，顺序由调用方保证稳定。 */
  options: MemberOption[]
  /** 已选成员详情；可包含已停用/移出成员，用于展示失效标记。 */
  selectedDetails?: MemberSelectionDetail[]
  /** 最多可选人数，默认 20；达到上限后未选项禁用并提示。 */
  maxSelected?: number
  loading?: boolean
  /** 候选加载失败原因；非空时展示错误与重试。 */
  error?: string | null
  onRetry?: () => void
  /** 只读/无权限或提交中；禁用后不展开面板，标签不再提供移除按钮。 */
  disabled?: boolean
  placeholder?: string
  /** 外部字段标签的 id，用于 combobox 的可访问名称。 */
  labelId?: string
  /** 帮助或上限说明容器 id，用于 aria-describedby。 */
  describedBy?: string
}

const ROLE_LABELS: Record<MemberRole, string> = { admin: '管理员', developer: '开发者', viewer: '浏览者' }

/**
 * 取成员姓名首字作为头像占位；头像图片能力接入后替换此处，不改变标签结构。
 * @param name 成员姓名。
 * @returns 单个首字符；姓名为空时返回问号。
 */
function memberInitial(name: string): string {
  return name.trim().charAt(0) || '?'
}

/**
 * 飞书式成员多选控件：标签区 + 检索输入 + 候选列表（勾选态）。
 * 受控组件，不发起请求；loading/error/retry 由调用方传入。
 * @param props 已选集合、候选、上限、四态、只读与可访问性关联。
 * @returns 键盘可完成展开、检索、选中、移除与关闭的 combobox；Esc 关闭面板且焦点留在输入框。
 */
export function MemberMultiSelect({
  values,
  onValuesChange,
  options,
  selectedDetails = [],
  maxSelected = 20,
  loading = false,
  error = null,
  onRetry,
  disabled = false,
  placeholder = '搜索姓名或邮箱',
  labelId,
  describedBy,
}: MemberMultiSelectProps) {
  const generatedId = useId()
  const listboxId = `${generatedId}-listbox`
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)

  const keyword = query.trim().toLowerCase()
  const filteredOptions = options.filter(
    (option) => option.name.toLowerCase().includes(keyword) || option.email.toLowerCase().includes(keyword),
  )
  const activeIndex = filteredOptions.length === 0 ? -1 : Math.min(highlighted, filteredOptions.length - 1)
  const atLimit = values.length >= maxSelected
  const selectedSet = new Set(values)

  /**
   * 关闭面板并复位检索与高亮；不改变已选集合。
   */
  const closePanel = () => {
    setOpen(false)
    setQuery('')
    setHighlighted(0)
  }

  /**
   * 展开面板并复位高亮；只读状态不允许展开。
   */
  const openPanel = () => {
    if (disabled) return
    setOpen(true)
    setHighlighted(0)
  }

  /**
   * 切换成员选中态：已选则移除，未选且未达上限时追加。
   * @param option 目标候选项。
   */
  const toggleMember = (option: MemberOption) => {
    if (disabled) return
    if (selectedSet.has(option.userId)) {
      onValuesChange(values.filter((userId) => userId !== option.userId))
    } else if (option.available && !atLimit) {
      onValuesChange([...values, option.userId])
    }
    setQuery('')
    setHighlighted(0)
    inputRef.current?.focus()
  }

  /**
   * 移除已选成员并把焦点交还输入框。
   * @param userId 待移除成员 id。
   */
  const removeMember = (userId: string) => {
    onValuesChange(values.filter((value) => value !== userId))
    inputRef.current?.focus()
  }

  /**
   * 处理输入框键盘操作：方向键移动高亮、Enter/Space 选中、Backspace 移除末项、Esc 关闭。
   * @param event 输入框键盘事件。
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        openPanel()
        return
      }
      if (filteredOptions.length > 0) {
        setHighlighted((index) => (index + 1) % filteredOptions.length)
      }
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (!open) {
        openPanel()
        return
      }
      if (filteredOptions.length > 0) {
        setHighlighted((index) => (index - 1 + filteredOptions.length) % filteredOptions.length)
      }
      return
    }
    if (event.key === 'Enter') {
      if (!open) {
        openPanel()
        return
      }
      const option = filteredOptions[activeIndex]
      if (option) {
        event.preventDefault()
        toggleMember(option)
      }
      return
    }
    if (event.key === ' ') {
      // 检索词为空时空格用于选中，否则保留为姓名中的空格输入。
      if (query.length > 0) return
      if (!open) {
        openPanel()
        return
      }
      const option = filteredOptions[activeIndex]
      if (option) {
        event.preventDefault()
        toggleMember(option)
      }
      return
    }
    const lastSelectedUserId = values[values.length - 1]
    if (event.key === 'Backspace' && query.length === 0 && lastSelectedUserId) {
      event.preventDefault()
      removeMember(lastSelectedUserId)
      return
    }
    if (event.key === 'Escape' && open) {
      // 阻止冒泡与默认行为，避免同时关闭外层表单弹窗。
      event.preventDefault()
      event.stopPropagation()
      closePanel()
    }
  }

  /**
   * 渲染已选标签：头像占位 + 姓名 + 移除；失效成员额外标注。
   * @param userId 已选成员 id。
   * @returns 标签元素；找不到详情时以“未知成员”兜底，不丢弃历史数据。
   */
  const renderTag = (userId: string) => {
    const detail =
      selectedDetails.find((item) => item.userId === userId) ?? options.find((item) => item.userId === userId)
    const name = detail?.name ?? '未知成员'
    const invalid = detail ? !detail.available : true
    return (
      <span
        key={userId}
        data-slot="member-tag"
        className={cn(
          'inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pr-1 pl-0.5 text-xs',
          invalid
            ? 'border-destructive/40 bg-destructive/10 text-destructive'
            : 'border-border bg-secondary text-secondary-foreground',
        )}
      >
        <span
          aria-hidden="true"
          data-slot="member-tag-avatar"
          className={cn(
            'grid size-5 shrink-0 place-items-center rounded-full text-xs font-medium',
            avatarToneClassName(userId),
          )}
        >
          {memberInitial(name)}
        </span>
        <span className="max-w-40 truncate">{name}</span>
        {invalid && <span className="shrink-0">已失效</span>}
        {!disabled && (
          <button
            type="button"
            aria-label={`移除 ${name}`}
            className="grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            onClick={(event) => {
              event.stopPropagation()
              removeMember(userId)
            }}
          >
            <XIcon className="size-3" aria-hidden="true" />
          </button>
        )}
      </span>
    )
  }

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (next) openPanel()
        else closePanel()
      }}
    >
      <PopoverPrimitive.Anchor asChild>
        <div
          ref={containerRef}
          data-slot="member-multiselect"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-haspopup="listbox"
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-disabled={disabled || undefined}
          className={cn(
            'flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-lg border bg-background px-2 py-1 text-sm shadow-xs transition-[color,box-shadow]',
            open ? 'border-ring ring-3 ring-ring/50' : 'border-input',
            disabled && 'cursor-not-allowed opacity-50',
          )}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault()
              inputRef.current?.focus()
            }
          }}
        >
          {values.map((userId) => renderTag(userId))}
          <input
            ref={inputRef}
            data-slot="member-multiselect-input"
            value={query}
            disabled={disabled}
            placeholder={values.length === 0 ? placeholder : ''}
            aria-label={placeholder}
            aria-autocomplete="list"
            aria-controls={open ? listboxId : undefined}
            aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            className="h-7 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlighted(0)
              if (!open) openPanel()
            }}
            onFocus={openPanel}
            onKeyDown={handleKeyDown}
          />
          {maxSelected !== undefined && (
            <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
              已选 {values.length}/{maxSelected}
            </span>
          )}
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="member-multiselect-content"
          align="start"
          sideOffset={4}
          className="z-50 w-(--radix-popover-trigger-width) rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none"
          aria-label="候选成员"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target instanceof Node && containerRef.current?.contains(event.target)) {
              event.preventDefault()
            }
          }}
        >
          {loading ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">成员加载中…</p>
          ) : error ? (
            <div className="space-y-2 px-2 py-3">
              <p className="text-sm text-destructive">{error}</p>
              {onRetry && (
                <Button type="button" variant="outline" size="sm" onClick={onRetry}>
                  重试
                </Button>
              )}
            </div>
          ) : filteredOptions.length === 0 ? (
            keyword ? (
              <div className="space-y-2 px-2 py-3">
                <p className="text-sm text-muted-foreground">无匹配成员</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuery('')
                    setHighlighted(0)
                    inputRef.current?.focus()
                  }}
                >
                  清除检索
                </Button>
              </div>
            ) : (
              <p className="px-2 py-3 text-sm text-muted-foreground">暂无可选成员</p>
            )
          ) : (
            <>
              {atLimit && <p className="px-2 py-1.5 text-xs text-warning">最多选择 {maxSelected} 人</p>}
              <div
                id={listboxId}
                role="listbox"
                aria-label="候选成员"
                aria-multiselectable
                className="max-h-64 overflow-y-auto"
              >
                {filteredOptions.map((option, index) => {
                  const isSelected = selectedSet.has(option.userId)
                  const isDisabled = !option.available || (!isSelected && atLimit)
                  return (
                    <button
                      key={option.userId}
                      id={`${listboxId}-option-${index}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={isSelected}
                      aria-disabled={isDisabled || undefined}
                      disabled={isDisabled}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors',
                        index === activeIndex && 'bg-accent text-accent-foreground',
                        isSelected && 'font-medium',
                        isDisabled && 'cursor-not-allowed opacity-50',
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlighted(index)}
                      onClick={() => toggleMember(option)}
                    >
                      <span
                        aria-hidden="true"
                        data-slot="member-option-avatar"
                        className={cn(
                          'grid size-7 shrink-0 place-items-center rounded-full text-xs font-medium',
                          avatarToneClassName(option.userId),
                        )}
                      >
                        {memberInitial(option.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          {option.name}
                          {!option.available && <span className="ml-1 text-xs text-destructive">已失效</span>}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">{ROLE_LABELS[option.role]}</span>
                      </span>
                      {isSelected && <CheckIcon className="size-4 shrink-0 text-primary" aria-hidden="true" />}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
