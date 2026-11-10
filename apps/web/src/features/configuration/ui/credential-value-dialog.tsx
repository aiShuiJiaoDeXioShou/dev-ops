import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ApiSuccessData } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'

/** 查看明文接口返回的明文、版本与查看时间。 */
export type RevealedCredentialValue = ApiSuccessData<'/api/v1/credentials/{credentialId}/reveal-value', 'post'>

/** 明文展示时长（秒）；到期后自动隐藏，避免敏感信息长期留在页面上。 */
const REVEAL_VISIBLE_SECONDS = 30

interface CredentialValueDialogProps {
  open: boolean
  credentialId: string
  onOpenChange: (open: boolean) => void
  onRevealed: (value: RevealedCredentialValue) => void
}

/**
 * 渲染查看明文前的登录密码二次确认对话框。
 * 成功后把明文交给父组件并清空密码；失败保留弹窗、清空输入并展示错误说明；
 * 关闭或卸载时取消未完成请求，避免对话框关闭后仍收到明文。
 * @param props 打开状态、凭据标识、打开状态回调与查看成功回调。
 * @returns 密码输入对话框；关闭后不残留密码与错误。
 */
function CredentialValueDialog({ open, credentialId, onOpenChange, onRevealed }: CredentialValueDialogProps) {
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)

  // 组件卸载（例如切换选中凭据）时取消未完成请求，避免卸载后继续写状态。
  useEffect(() => () => activeRequest.current?.abort(), [])

  const clearSensitiveState = () => {
    activeRequest.current?.abort()
    activeRequest.current = null
    setPassword('')
    setErrorMessage('')
    setIsSubmitting(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) clearSensitiveState()
    onOpenChange(nextOpen)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    if (!password) {
      setErrorMessage('请输入当前登录密码。')
      return
    }
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setIsSubmitting(true)
    setErrorMessage('')
    try {
      const result = await apiClient.revealCredentialValue(credentialId, { password }, { signal: controller.signal })
      // 弹窗已关闭或已发起新请求时丢弃结果，避免泄漏明文或展示过期错误。
      if (activeRequest.current !== controller) return
      activeRequest.current = null
      setPassword('')
      setIsSubmitting(false)
      onRevealed(result.data)
      onOpenChange(false)
    } catch (error) {
      if (activeRequest.current !== controller) return
      activeRequest.current = null
      setIsSubmitting(false)
      setErrorMessage(describeRequestError(error).description)
      setPassword('')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form className="space-y-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>查看凭据值</DialogTitle>
            <DialogDescription>
              明文属于敏感信息。请输入当前登录密码确认身份，查看结果将在 {REVEAL_VISIBLE_SECONDS} 秒后自动隐藏。
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-sm font-medium">
            当前登录密码
            <Input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              disabled={isSubmitting}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={errorMessage ? true : undefined}
              aria-describedby={errorMessage ? 'credential-reveal-error' : undefined}
            />
          </label>
          {errorMessage ? (
            <p id="credential-reveal-error" role="alert" className="text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? '验证中…' : '确认查看'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface CredentialValueRevealProps {
  credentialId: string
  maskedValue: string
  canReveal: boolean
}

/**
 * 渲染详情面板中的掩码/明文区域。
 * 有权限的角色可通过登录密码确认查看明文；明文只保存在组件内存中，
 * 30 秒倒计时归零、点击「立即隐藏」或组件卸载时立即清除。
 * @param props 凭据标识、掩码值以及当前角色是否允许查看明文。
 * @returns 掩码行或带倒计时的明文卡片。
 */
export function CredentialValueReveal({ credentialId, maskedValue, canReveal }: CredentialValueRevealProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [revealed, setRevealed] = useState<RevealedCredentialValue | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState(REVEAL_VISIBLE_SECONDS)

  // 倒计时每秒刷新；按真实时间计算剩余秒数，避免后台标签页计时器被节流后延迟隐藏。
  useEffect(() => {
    if (!revealed) return
    const revealedAtMs = Date.now()
    const timer = window.setInterval(() => {
      const secondsLeft = Math.max(REVEAL_VISIBLE_SECONDS - Math.floor((Date.now() - revealedAtMs) / 1000), 0)
      if (secondsLeft === 0) {
        window.clearInterval(timer)
        setRemainingSeconds(REVEAL_VISIBLE_SECONDS)
        setRevealed(null)
        return
      }
      setRemainingSeconds(secondsLeft)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [revealed])

  const hideValue = () => {
    setRevealed(null)
    setRemainingSeconds(REVEAL_VISIBLE_SECONDS)
  }

  const handleRevealed = (value: RevealedCredentialValue) => {
    setRevealed(value)
    setRemainingSeconds(REVEAL_VISIBLE_SECONDS)
  }

  return (
    <>
      {revealed ? (
        <div className="vault-secret vault-secret-revealed">
          <p className="vault-secret-meta">
            明文 · v{revealed.version} · 查看于 {formatDateTime(revealed.revealedAt)} · {remainingSeconds} 秒后自动隐藏
          </p>
          <Button type="button" variant="outline" size="sm" onClick={hideValue}>
            立即隐藏
          </Button>
          <code className="vault-secret-value">{revealed.value}</code>
        </div>
      ) : (
        <div className="vault-secret">
          <span className="muted small">掩码 {maskedValue}</span>
          {canReveal ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
              查看凭据值
            </Button>
          ) : null}
        </div>
      )}
      {canReveal ? (
        <CredentialValueDialog
          open={dialogOpen}
          credentialId={credentialId}
          onOpenChange={setDialogOpen}
          onRevealed={handleRevealed}
        />
      ) : null}
    </>
  )
}
