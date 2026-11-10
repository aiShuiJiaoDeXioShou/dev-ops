import { useEffect, useId, useState } from 'react'
import { Copy } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/controls/alert'
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
import { formatDateTime } from '@/shared/lib/format'
import { useToast } from '@/shared/ui/toast'

interface NodeTokenDialogProps {
  /** 是否打开。 */
  open: boolean
  /** 打开状态变化；关闭即视为确认已保存令牌。 */
  onOpenChange: (open: boolean) => void
  /** 弹窗标题，例如“节点注册令牌”。 */
  title: string
  /** 令牌用途说明。 */
  description: string
  /** 一次性令牌明文；只在本次弹窗展示。 */
  token: string
  /** 令牌过期时间；无过期时间时为空。 */
  expiresAt: string | null
}

/**
 * 一次性令牌展示弹窗。
 *
 * 令牌只在创建或轮换成功后展示一次，关闭后无法再次查看；
 * 提供复制按钮并提示立即妥善保存，不写入任何持久化存储。
 * @param props 令牌、过期时间与说明文案。
 * @returns 令牌弹窗；未打开时不渲染内容。
 */
export function NodeTokenDialog({ open, onOpenChange, title, description, token, expiresAt }: NodeTokenDialogProps) {
  const fieldId = useId()
  const { showToast } = useToast()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) setCopied(false)
  }, [open])

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      showToast('令牌已复制，请妥善保存。', 'success')
    } catch {
      showToast('浏览器拒绝剪贴板权限，请手动复制令牌。', 'error')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Alert variant="destructive">
          <AlertTitle>令牌只显示一次</AlertTitle>
          <AlertDescription>
            关闭弹窗后无法再次查看。请现在复制并交给节点 Agent 配置，不要写入仓库或日志。
          </AlertDescription>
        </Alert>

        <label className="block space-y-1.5 text-sm font-medium" htmlFor={`${fieldId}-token`}>
          令牌
          <Input
            id={`${fieldId}-token`}
            value={token}
            readOnly
            autoFocus
            className="mono"
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        {expiresAt && <p className="small quiet">过期时间：{formatDateTime(expiresAt)}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => void copyToken()}>
            <Copy aria-hidden="true" />
            {copied ? '已复制' : '复制令牌'}
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            我已保存，关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
