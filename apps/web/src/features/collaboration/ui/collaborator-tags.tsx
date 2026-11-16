import { cn } from '@/shared/lib/utils'
import { UserAvatar } from '@/shared/ui/user-avatar'

/**
 * 显示事项的协作人员，保留历史人员及失效标记。
 * @param props.members 详情接口提供的协作人员列表。
 * @returns 头像和姓名标签，列表为空时显示「无」。
 */
export function CollaboratorTags({
  members,
}: {
  members: { userId: string; name: string; image?: string | null; available: boolean }[]
}) {
  if (members.length === 0) return <span>无</span>
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="协作人员">
      {members.map((member) => (
        <li
          key={member.userId}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border py-0.5 pr-2 pl-0.5 text-xs',
            member.available
              ? 'border-border bg-secondary text-secondary-foreground'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          <UserAvatar name={member.name} image={member.image} toneSeed={member.userId} className="size-5" />
          <span className="max-w-40 truncate">{member.name}</span>
          {!member.available && <span className="shrink-0">已失效</span>}
        </li>
      ))}
    </ul>
  )
}
