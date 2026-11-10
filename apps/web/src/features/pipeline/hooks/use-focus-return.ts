import { useCallback, useRef } from 'react'

/**
 * 在对话框关闭后把焦点归还给触发元素。
 *
 * 不依赖 `document.activeElement`：macOS 上鼠标点击按钮不会聚焦按钮，
 * 因此由调用方显式传入触发元素（通常是按钮的 `event.currentTarget`）。
 * 归还动作放在下一帧，等对话框卸载完成后再聚焦，避免被 Radix 的焦点清理覆盖。
 * @returns capture 记录触发元素；restore 在关闭后聚焦并清空记录。
 */
export function useFocusReturn() {
  const elementRef = useRef<HTMLElement | null>(null)

  const capture = useCallback((element: HTMLElement | null) => {
    elementRef.current = element
  }, [])

  const restore = useCallback(() => {
    const element = elementRef.current
    elementRef.current = null
    if (!element) return
    requestAnimationFrame(() => {
      if (element.isConnected) element.focus()
    })
  }, [])

  return { capture, restore }
}
