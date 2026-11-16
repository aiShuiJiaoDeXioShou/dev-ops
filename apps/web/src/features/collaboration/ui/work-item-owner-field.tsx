import { useId } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { teamMembersQueryOptions } from '@/features/identity/api/team-queries'
import { toMemberOption } from '@/features/identity/model/team-member'
import { useSession } from '@/features/identity/model/session'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import type { MemberSelectionDetail } from '@/shared/ui/controls/member-multiselect'
import { MemberSelect } from '@/shared/ui/controls/member-select'
import { UserAvatar } from '@/shared/ui/user-avatar'
import { useToast } from '@/shared/ui/toast'

/**
 * 展示事项负责人；有编辑权时可直接在原位置搜索成员、指派或清空。
 * @param props 团队、字段标签、当前负责人及可选的保存回调。保存失败时保留候选供重试。
 * @returns 负责人属性行，支持头像和历史成员回填。
 */
export function WorkItemOwnerField({
  teamId,
  label,
  owner,
  onSave,
}: {
  teamId: string
  label: string
  owner: MemberSelectionDetail | null
  onSave?: (userId: string | null) => Promise<void>
}) {
  const id = useId()
  const { user } = useSession()
  const { showToast } = useToast()
  const members = useQuery({ ...teamMembersQueryOptions(teamId), enabled: Boolean(onSave && teamId) })
  const mutation = useMutation({
    mutationFn: async (userId: string | null) => onSave?.(userId),
    onSuccess: () => showToast('负责人已更新。', 'success'),
  })

  return (
    <div>
      <dt className="text-xs text-muted-foreground">{onSave ? <label htmlFor={id}>{label}</label> : label}</dt>
      <dd className="mt-1 min-w-0 text-sm">
        {onSave ? (
          <MemberSelect
            id={id}
            appearance="inline"
            value={owner?.userId ?? ''}
            selectedDetail={owner}
            options={(members.data?.data ?? []).map(toMemberOption).filter((member) => member.available)}
            currentUserId={user.id}
            loading={members.isPending}
            error={members.isError ? describeRequestError(members.error).description : null}
            onRetry={() => void members.refetch()}
            disabled={mutation.isPending}
            collisionBoundary={null}
            onValueChange={(value) => {
              const userId = value || null
              if (userId !== (owner?.userId ?? null)) mutation.mutate(userId)
            }}
          />
        ) : (
          <span className="flex min-h-8 items-center gap-2 wrap-anywhere">
            {owner && <UserAvatar name={owner.name} image={owner.image} toneSeed={owner.userId} className="size-6" />}
            {owner?.name ?? '未指定'}
            {owner?.available === false && <span className="text-xs text-destructive">已失效</span>}
          </span>
        )}
        {mutation.isPending && (
          <p role="status" className="text-xs text-muted-foreground">
            保存中…
          </p>
        )}
        {mutation.isError && (
          <div className="space-y-1" role="alert">
            <p className="text-xs text-destructive">{describeRequestError(mutation.error).description}</p>
            <Button variant="ghost" size="sm" type="button" onClick={() => mutation.mutate(mutation.variables ?? null)}>
              重试保存
            </Button>
          </div>
        )}
      </dd>
    </div>
  )
}
