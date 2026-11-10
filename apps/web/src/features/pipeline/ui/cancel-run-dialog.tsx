import { useState } from 'react'
import { Button } from '@/shared/ui/controls/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/controls/alert-dialog'
import { Textarea } from '@/shared/ui/controls/textarea'

interface CancelRunDialogProps {
  /** 是否打开。 */
  open: boolean
  /** 打开状态变化；Esc 关闭后焦点回到触发按钮。 */
  onOpenChange: (open: boolean) => void
  /** 取消中的反馈文案，用于说明不可撤回的已发生副作用。 */
  runLabel: string
  /** 是否正在提交取消请求。 */
  isPending: boolean
  /** 确认取消；reason 可为空，用于审计说明。 */
  onConfirm: (reason: string) => void
}

/**
 * 取消运行二次确认对话框。
 *
 * 取消是尽力而为：已发生的外部副作用无法撤回，因此文案明确说明最终可能进入中断状态。
 * 取消按钮样式使用危险操作语义，默认焦点不落在确认按钮上。
 * @param props 打开状态、运行标识、提交状态与确认回调。
 * @returns 取消确认对话框；未打开时不渲染内容。
 */
export function CancelRunDialog({ open, onOpenChange, runLabel, isPending, onConfirm }: CancelRunDialogProps) {
  const [reason, setReason] = useState('')

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>取消这次运行？</AlertDialogTitle>
          <AlertDialogDescription>
            将请求取消 {runLabel}。节点确认后运行进入“已取消”；节点未响应时最终可能标记为“已中断”。
            已发生的镜像推送、文件上传等外部副作用无法撤回。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label className="block space-y-1.5 text-sm font-medium">
          取消原因（可选，写入审计）
          <Textarea
            value={reason}
            rows={3}
            maxLength={1000}
            disabled={isPending}
            placeholder="例如：验证环境恢复，本次运行不再需要"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={isPending}>
              返回
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button type="button" variant="destructive" disabled={isPending} onClick={() => onConfirm(reason.trim())}>
              {isPending ? '取消中…' : '确认取消'}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
