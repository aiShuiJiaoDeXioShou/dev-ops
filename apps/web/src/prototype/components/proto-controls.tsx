import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { PrototypeIcon } from '@/prototype/icons/icon'
import type { PrototypeIconName } from '@/prototype/icons/icon'
import { usePrototypeMenu } from '@/prototype/layout/prototype-shell'

interface ProtoButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 原型按钮样式：默认或 primary。 */
  variant?: 'default' | 'primary' | 'ghost'
}

/**
 * 渲染与原型 .btn 类一致的按钮，封装重复的类名与语义。
 * @param props 原生按钮属性、样式变体与内容。
 * @returns 原型样式的按钮；禁用状态沿用原生行为。
 */
export function ProtoButton({ variant = 'default', className, children, ...props }: ProtoButtonProps) {
  return (
    <button
      type="button"
      className={cn('btn', variant === 'primary' && 'primary', variant === 'ghost' && 'ghost', className)}
      {...props}
    >
      {children}
    </button>
  )
}

/**
 * 渲染原型图标按钮，保留可访问名称。
 * @param props.label 无障碍名称；props.icon 图标名；props.className 附加类名。
 * @returns 原型 .icon-btn 样式的按钮。
 */
export function ProtoIconButton({
  label,
  icon,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  icon: PrototypeIconName
}) {
  return (
    <button type="button" aria-label={label} className={cn('icon-btn', className)} {...props}>
      <PrototypeIcon name={icon} />
    </button>
  )
}

/**
 * 渲染原型页面头，包含移动端菜单按钮和隐藏标题。
 * @param props.title 页面标题；props.actions 右侧操作。
 * @returns 与 .page-head 一致的头图结构。
 */
export function ProtoPageHead({ title, actions }: { title: string; actions?: ReactNode }) {
  const { openMenu } = usePrototypeMenu()
  return (
    <header className="page-head">
      <div className="row">
        <button type="button" className="icon-btn mobile-menu" aria-label="展开导航" onClick={openMenu}>
          <PrototypeIcon name="menu" />
        </button>
        <h1 className="sr-only">{title}</h1>
        <span className="spacer" />
        {actions}
      </div>
    </header>
  )
}

/**
 * 渲染原型工作页头，用于能力、团队、运维等文档型页面。
 * @param props.title 页面标题；props.actions 右侧操作；props.children 标题下方内容。
 * @returns 与 .work-page-head 一致的头部结构。
 */
export function ProtoWorkPageHead({
  title,
  actions,
  children,
}: {
  title: string
  actions?: ReactNode
  children?: ReactNode
}) {
  const { openMenu } = usePrototypeMenu()
  return (
    <header className="work-page-head compact-page-head">
      <button type="button" className="icon-btn mobile-menu" aria-label="展开导航" onClick={openMenu}>
        <PrototypeIcon name="menu" />
      </button>
      <h1 className="sr-only">{title}</h1>
      <div className="row">{children}</div>
      {actions && <div className="row">{actions}</div>}
    </header>
  )
}

/**
 * 渲染原型搜索框。
 * @param props.label 无障碍名称；props.placeholder 占位文本；props.value 当前值；props.onChange 输入回调。
 * @returns 使用 .search 样式的搜索控件。
 */
export function ProtoSearch({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="search">
      <PrototypeIcon name="search" />
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

/**
 * 渲染原型表单字段容器。
 * @param props.label 字段名称；props.children 控件；props.full 是否占满两列。
 * @returns 使用 .field 样式的表单字段。
 */
export function ProtoField({ label, children, full = false }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={cn('field', full && 'full')}>
      {label}
      {children}
    </label>
  )
}

/**
 * 渲染原型空状态。
 * @param props.icon 图标名；props.title 标题；props.description 说明；props.action 操作。
 * @returns 使用 .empty 样式的空状态。
 */
export function ProtoEmpty({
  icon = 'search',
  title,
  description,
  action,
}: {
  icon?: PrototypeIconName
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="empty">
      <PrototypeIcon name={icon} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  )
}

/**
 * 渲染原型区块标题与操作。
 * @param props.title 标题；props.count 可选计数；props.actions 右侧操作。
 * @returns 使用 .section-heading 样式的标题行。
 */
export function ProtoSectionHeading({ title, count, actions }: { title: string; count?: number; actions?: ReactNode }) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {typeof count === 'number' && <span className="counter">{count}</span>}
      <span className="spacer" />
      {actions}
    </div>
  )
}

/**
 * 渲染原型输入框。
 * @param props 原生 input 属性。
 * @returns 由原型 .field input 样式控制的原生输入框。
 */
export function ProtoInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />
}
