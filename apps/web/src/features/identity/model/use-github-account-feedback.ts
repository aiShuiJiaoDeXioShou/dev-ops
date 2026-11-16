import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'
import { useToast } from '@/shared/ui/toast'

/**
 * 展示 GitHub 绑定回跳的一次性通知，随后从地址栏移除结果参数。
 * @returns 无返回值。
 */
export function useGitHubAccountFeedback(): void {
  const [params, setParams] = useSearchParams()
  const { showToast } = useToast()
  const result = params.get('githubAccount')
  const handled = useRef(false)
  useEffect(() => {
    if (!result || handled.current) return
    handled.current = true
    if (result === 'connected') showToast('GitHub 账号已绑定。', 'success')
    if (result === 'failed') showToast('GitHub 授权未完成，请重试。', 'error')
    if (result === 'conflict') showToast('此 GitHub 账号已经绑定到其他 DevOps 用户。', 'error')
    const next = new URLSearchParams(params)
    next.delete('githubAccount')
    setParams(next, { replace: true })
  }, [params, result, setParams, showToast])
}
