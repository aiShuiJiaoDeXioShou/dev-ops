import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/controls/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/controls/alert'
import { Button } from '@/shared/ui/controls/button'

export interface StorageBucketConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  pendingLabel: string
  isPending: boolean
  /** 服务端拒绝原因；如桶仍被附件引用时保留弹窗并就地说明。 */
  errorDescription: string | null
  /** 删除等不可逆操作使用危险按钮；默认操作使用主色按钮。 */
  destructive?: boolean
  onConfirm: () => void
}

/**
 * 储存桶危险操作二次确认。
 * 取消按钮在 DOM 首位并作为初始焦点；确认中禁用重复提交，失败保留弹窗并显示原因。
 * @param props 标题、影响说明、确认文案、进行中状态与错误说明。
 * @returns 二次确认弹窗；确认后由调用方执行变更。
 */
export function StorageBucketConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  isPending,
  errorDescription,
  destructive = false,
  onConfirm,
}: StorageBucketConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {errorDescription && (
          <Alert variant="destructive">
            <AlertTitle>操作未完成</AlertTitle>
            <AlertDescription>{errorDescription}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>取消</AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={isPending}
            onClick={onConfirm}
          >
            {isPending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
