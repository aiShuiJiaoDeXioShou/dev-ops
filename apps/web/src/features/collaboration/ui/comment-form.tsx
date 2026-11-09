import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createIdempotencyKey, isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Textarea } from '@/shared/ui/controls/textarea'
import type { CollabTarget } from '../api/queries'

/** 追加评论；浏览者由服务端拒绝，表单保留未提交内容。 */
export function CommentForm({
  target,
  targetId,
  disabled,
}: {
  target: CollabTarget
  targetId: string
  disabled?: boolean
}) {
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: () =>
      target === 'requirement'
        ? apiClient.addRequirementComment(
            targetId,
            { bodyMarkdown: body.trim() },
            { idempotencyKey: createIdempotencyKey() },
          )
        : apiClient.addBugComment(targetId, { bodyMarkdown: body.trim() }, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: async () => {
      setBody('')
      await queryClient.invalidateQueries({ queryKey: ['collaboration', 'comments', target, targetId] })
    },
    onError: (cause: unknown) =>
      setError(isBusinessError(cause) ? describeRequestError(cause).description : '评论发送失败，内容已保留。'),
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!body.trim()) return setError('评论不能为空。')
    mutation.mutate()
  }
  return (
    <form className="space-y-2" onSubmit={submit}>
      <Textarea
        aria-label="追加评论"
        placeholder={disabled ? '当前角色为只读' : '输入评论…'}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={disabled || mutation.isPending}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={disabled || mutation.isPending}>
          {mutation.isPending ? '发送中…' : '发表评论'}
        </Button>
      </div>
    </form>
  )
}
