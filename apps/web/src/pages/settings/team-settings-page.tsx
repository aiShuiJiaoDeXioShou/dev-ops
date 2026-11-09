import { useSession } from '@/features/identity/public'
import { CreateTeamForm, MemberManagement } from '@/features/identity/public'
import { EmptyState } from '@/shared/ui/page-state'

/** 团队设置页；成员管理仅对管理员开放。 */
export function Component() {
  const { currentTeam, role } = useSession()
  if (!currentTeam)
    return (
      <div className="space-y-6">
        <EmptyState
          title="还没有团队"
          description="请联系平台管理员创建团队并邀请你加入；平台管理员也可以在此创建团队。"
        />
        <CreateTeamForm />
      </div>
    )
  return (
    <section className="space-y-6">
      <header>
        <p className="text-sm text-muted-foreground">团队设置</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{currentTeam.name}</h1>
      </header>
      {role === 'admin' ? (
        <MemberManagement teamId={currentTeam.id} canManage />
      ) : (
        <EmptyState title="仅管理员可管理团队" description="当前角色可以继续使用项目、需求和 Bug 功能。" />
      )}
    </section>
  )
}

export default Component
