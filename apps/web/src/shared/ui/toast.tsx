import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

interface ToastContextValue {
  showToast: (message: string) => void
}
const ToastContext = createContext<ToastContextValue | null>(null)

/**
 * 提供底部临时提示；用于操作成功或失败等非字段级反馈。
 * @param props.children 应用内容。
 * @returns 带 #toast 容器的上下文 Provider。
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((next: string) => {
    setMessage(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), 3200)
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
      <div id="toast" className={message ? 'visible' : undefined} role="status" aria-live="polite">
        {message && (
          <>
            <span className="dot" />
            {message}
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
