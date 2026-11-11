import { useId, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

export interface FormFieldProps {
  /** 字段标签，始终可见，不允许用 placeholder 代替。 */
  label: ReactNode
  /** 原生控件的 id；设置后 label 与控件自动关联。 */
  htmlFor?: string
  /** 复合控件（如成员多选）的标签元素 id，供控件通过 aria-labelledby 引用。 */
  labelId?: string
  /** 是否必填；标记同时提供星号与读屏文本，不只靠颜色表达。 */
  required?: boolean
  /** 帮助文案，常驻字段下方；用于解释格式、上限或数据来源。 */
  help?: ReactNode
  /** 字段级错误；非空时以 role="alert" 展示并贴上控件。 */
  error?: string | null
  /** 帮助与错误容器的 id；需要 aria-describedby 时由调用方与控件共用。 */
  messageId?: string
  className?: string
  children: ReactNode
}

interface FormSectionProps {
  /** 分组名称；仅用于读屏与结构语义，视觉上以 24px 组间距区分。 */
  title: string
  className?: string
  children: ReactNode
}

interface FormGridProps {
  className?: string
  children: ReactNode
}

/**
 * 渲染统一的表单字段结构：标签 → 控件 → 帮助/错误。
 * @param props 标签文本、关联 id、必填/帮助/错误状态与字段内容。
 * @returns 字段容器；标签、必填标记、帮助与 role="alert" 的错误均使用语义 token。
 */
export function FormField({
  label,
  htmlFor,
  labelId,
  required = false,
  help,
  error,
  messageId,
  className,
  children,
}: FormFieldProps) {
  const generatedId = useId()
  const resolvedMessageId = messageId ?? `${generatedId}-message`
  const labelContent = (
    <span className="inline-flex items-baseline gap-0.5">
      <span>{label}</span>
      {required && (
        <>
          <span className="text-destructive" aria-hidden="true">
            *
          </span>
          <span className="sr-only">（必填）</span>
        </>
      )}
    </span>
  )
  const labelClassName = 'text-sm font-medium text-foreground'
  return (
    <div data-slot="form-field" className={cn('space-y-1.5', className)}>
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClassName}>
          {labelContent}
        </label>
      ) : (
        <div id={labelId} className={labelClassName}>
          {labelContent}
        </div>
      )}
      {children}
      {(help || error) && (
        <div id={resolvedMessageId} className="space-y-1">
          {help && <p className="text-xs text-muted-foreground">{help}</p>}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 渲染表单内的一组字段，保持组内 16px、组间由父容器 24px 控制。
 * @param props 分组名称与字段内容。
 * @returns 具备结构语义的 section；名称仅暴露给读屏，不额外占用视觉空间。
 */
export function FormSection({ title, className, children }: FormSectionProps) {
  return (
    <section data-slot="form-section" aria-label={title} className={cn('space-y-4', className)}>
      {children}
    </section>
  )
}

/**
 * 渲染短字段双列布局；窄屏下自动回落为单列，避免横向溢出。
 * @param props 两列字段与可选类名。
 * @returns 640px 以上双列、以下单列的网格容器。
 */
export function FormGrid({ className, children }: FormGridProps) {
  return (
    <div data-slot="form-grid" className={cn('grid gap-4 sm:grid-cols-2', className)}>
      {children}
    </div>
  )
}
