import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { PrototypeIcon } from '@/prototype/icons/icon'

interface PrototypeDialogProps {
  /** 是否打开。 */
  open: boolean
  /** 标题；原型中显示在 dialog header。 */
  title: string
  /** 关闭回调，Escape、点击关闭按钮或外部关闭时调用。 */
  onClose: () => void
  /** 对话框主体。 */
  children: ReactNode
  /** 是否展示关闭按钮。 */
  showCloseButton?: boolean
  /** 附加在 dialog 上的类名，用于原型中的大弹窗等尺寸变体。 */
  className?: string
}

/**
 * 使用原生 dialog 元素渲染原型对话框，保证与原型 styles.css 的 dialog 样式一致。
 * @param props 打开状态、标题、关闭回调和内容。
 * @returns 原生模态对话框；打开时由 showModal 管理焦点与遮罩。
 * @remarks 原生 dialog 的样式来自原型 CSS，避免 Radix 结构与原型不一致。
 */
export function PrototypeDialog({
  open,
  title,
  onClose,
  children,
  showCloseButton = true,
  className,
}: PrototypeDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={className}
      style={{ inset: 0, margin: 'auto' }}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={() => {
        if (open) onClose()
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        {showCloseButton && (
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            <PrototypeIcon name="close" />
          </button>
        )}
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  )
}
