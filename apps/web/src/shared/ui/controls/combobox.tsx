import { useId, useRef, useState } from 'react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { Button } from './button'
import { Input } from './input'

export interface ComboboxOption {
  value: string
  label: string
}

interface ComboboxProps {
  id?: string
  value: string
  onValueChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  'aria-label'?: string
  className?: string
}

/**
 * 带搜索框的下拉选择器；搜索框位于展开面板顶部，适用于仓库等长列表。
 * @param props 当前值、选项、占位文案与禁用状态；选项由调用方过滤前的完整列表提供。
 * @returns 键盘可操作的 combobox；方向键移动高亮，Enter 选择，Esc 关闭并归还焦点。
 */
export function Combobox({
  id,
  value,
  onValueChange,
  options,
  placeholder = '请选择',
  searchPlaceholder = '搜索',
  emptyMessage = '没有匹配项',
  disabled = false,
  'aria-label': ariaLabel,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const generatedId = useId()
  const triggerId = id ?? `${generatedId}-trigger`
  const valueId = `${generatedId}-value`
  const listboxId = `${generatedId}-listbox`
  const selected = options.find((option) => option.value === value)
  const keyword = query.trim().toLowerCase()
  const filteredOptions = options.filter((option) => option.label.toLowerCase().includes(keyword))

  const close = () => {
    setOpen(false)
    setQuery('')
    setHighlighted(0)
  }
  const select = (option: ComboboxOption) => {
    onValueChange(option.value)
    close()
  }
  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close()
          return
        }
        setOpen(true)
        setQuery('')
        setHighlighted(0)
      }}
    >
      <PopoverPrimitive.Trigger asChild>
        <Button
          id={triggerId}
          type="button"
          variant="outline"
          role="combobox"
          {...(ariaLabel ? { 'aria-label': ariaLabel } : { 'aria-labelledby': valueId })}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          disabled={disabled}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span id={valueId} className={cn('truncate', selected ? undefined : 'text-muted-foreground')}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          sideOffset={4}
          className="combobox-content z-50 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            searchRef.current?.focus()
          }}
        >
          <Input
            ref={searchRef}
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            aria-autocomplete="list"
            aria-controls={listboxId}
            onChange={(event) => {
              setQuery(event.target.value)
              setHighlighted(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlighted((index) => Math.min(index + 1, filteredOptions.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlighted((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                const option = filteredOptions[highlighted]
                if (option) select(option)
              }
            }}
          />
          <div id={listboxId} role="listbox" aria-label={ariaLabel} className="combobox-list mt-2">
            {filteredOptions.length === 0 ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">{emptyMessage}</p>
            ) : (
              filteredOptions.map((option, index) => {
                const isSelected = option.value === value
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors',
                      index === highlighted && 'bg-accent text-accent-foreground',
                      isSelected && 'font-medium',
                    )}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => select(option)}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected && <CheckIcon className="ml-auto size-4 shrink-0" aria-hidden="true" />}
                  </button>
                )
              })
            )}
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
