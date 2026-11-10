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

interface ConfirmActionDialogProps {
  /** 是否打开。 */
  open: boolean
  /** 打开状态变化；Esc 关闭后焦点回到触发按钮。 */
  onOpenChange: (open: boolean) => void
  /** 确认框标题。 */
  title: string
  /** 说明操作对象、后果与可恢复性。 */
  description: string
  /** 确认按钮文案。 */
  confirmLabel: string
  /** 提交中按钮文案。 */
  pendingLabel: string
  /** 是否正在提交。 */
  isPending: boolean
  /** 确认回调；调用方负责 mutation 与错误提示。 */
  onConfirm: () => void
}

/**
 * 通用危险操作二次确认框。
 *
 * 用于停用节点、撤销旧令牌等不可自动恢复的动作；默认焦点不落在危险按钮上。
 * @param props 标题、说明、按钮文案与确认回调。
 * @returns 二次确认对话框；未打开时不渲染内容。
 */
export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  isPending,
  onConfirm,
}: ConfirmActionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="outline" disabled={isPending}>
              返回
            </Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button type="button" variant="destructive" disabled={isPending} onClick={onConfirm}>
              {isPending ? pendingLabel : confirmLabel}
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
