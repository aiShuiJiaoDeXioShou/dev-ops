import { useId, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/controls/alert-dialog'
import { Button } from '@/shared/ui/controls/button'
import { FormField } from '@/shared/ui/controls/form-field'
import { Textarea } from '@/shared/ui/controls/textarea'

/**
 * 确认移除事项关联或引用，记录原因并保留失败时的输入。
 * @param props 操作对象、说明、执行回调以及关闭后可聚焦的入口。
 * @returns 需填写原因的确认弹窗，提交成功后关闭。
 */
export function RemoveWorkItemRelation({
  title,
  description,
  onRemove,
  onClose,
  focusTarget,
}: {
  title: string
  description: string
  onRemove: (reason: string) => Promise<void>
  onClose: () => void
  focusTarget: () => HTMLElement | null
}) {
  const [reason, setReason] = useState('')
  const id = useId()
  const mutation = useMutation({ mutationFn: onRemove, onSuccess: onClose })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (reason.trim() && !mutation.isPending) mutation.mutate(reason.trim())
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          const target = focusTarget()
          if (!target?.isConnected) return
          event.preventDefault()
          target.focus({ preventScroll: true })
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <FormField label="移除原因" htmlFor={id} required>
            <Textarea
              id={id}
              value={reason}
              maxLength={2000}
              required
              onChange={(event) => setReason(event.target.value)}
            />
          </FormField>
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {describeRequestError(mutation.error).description}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>取消</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={mutation.isPending || !reason.trim()}>
              {mutation.isPending ? '移除中…' : '移除'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
