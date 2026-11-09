import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export type ToastVariant = 'success' | 'error' | 'info'

interface ToastState {
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  showToast: (message: string, variant?: ToastVariant) => void
}
const ToastContext = createContext<ToastContextValue | null>(null)

/**
 * 根据提示类型渲染语义图标。
 * @param props.variant 成功、失败或普通提示。
 * @returns 与文字颜色一致的 16px 内联图标。
 */
function ToastIcon({ variant }: { variant: ToastVariant }) {
  if (variant === 'success') {
    return (
      <svg className="toast-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm3.78 5.22a.75.75 0 0 0-1.06 0L7 8.94 5.28 7.22a.75.75 0 0 0-1.06 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l4.25-4.25a.75.75 0 0 0 0-1.06Z" />
      </svg>
    )
  }
  if (variant === 'error') {
    return (
      <svg className="toast-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm0 3.5a.75.75 0 0 0-.75.75v4a.75.75 0 0 0 1.5 0v-4A.75.75 0 0 0 8 3.5Zm0 7.25a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
      </svg>
    )
  }
  return (
    <svg className="toast-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0Zm0 7a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 7Zm0-3.25a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
    </svg>
  )
}

/**
 * 提供底部临时提示；用于操作成功或失败等非字段级反馈。
 * @param props.children 应用内容。
 * @returns 带语义图标和 #toast 容器的上下文 Provider。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((message: string, variant: ToastVariant = 'info') => {
    setToast({ message, variant })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 3200)
  }, [])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        id="toast"
        className={toast ? 'visible' : undefined}
        data-variant={toast?.variant ?? 'info'}
        role="status"
        aria-live="polite"
      >
        {toast && (
          <>
            <ToastIcon variant={toast.variant} />
            <span>{toast.message}</span>
          </>
        )}
      </div>
    </ToastContext.Provider>
  )
}

/** 读取临时提示方法；独立组件测试或嵌入场景无 Provider 时丢弃提示，应用根始终提供。 */
export function useToast() {
  return useContext(ToastContext) ?? { showToast: () => undefined }
}
