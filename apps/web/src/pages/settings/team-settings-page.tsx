import { useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { PrototypeIcon } from '@/prototype/icons/icon'
import { CreateTeamDialog, MemberManagement, TeamProfileForm, useSession } from '@/features/identity/public'
import { EmptyState } from '@/shared/ui/page-state'

/** 团队设置页；成员管理仅对管理员开放。 */
export function Component() {
  const { currentTeam, role } = useSession()
  const [createOpen, setCreateOpen] = useState(false)
  if (!currentTeam) {
    return (
      <div className="catalog empty-page">
        <h1 className="sr-only">团队管理</h1>
        <EmptyState
          mascot="group"
          title="还没有加入团队"
          description="团队空间会承载项目、需求、Bug 和成员协作。请让平台管理员邀请你加入，或由平台管理员直接创建一个新团队。"
          action={
            <button type="button" className="btn primary" onClick={() => setCreateOpen(true)}>
              <PrototypeIcon name="plus" />
              创建团队
            </button>
          }
        />
        <CreateTeamDialog open={createOpen} onOpenChange={setCreateOpen} />
      </div>
    )
  }
  return (
    <div className="catalog team-admin">
      <h1 className="sr-only">团队管理</h1>
      <TeamProfileForm />
      {role === 'admin' ? (
        <MemberManagement teamId={currentTeam.id} canManage />
      ) : (
        <EmptyState
          icon={<ShieldAlert />}
          title="仅管理员可管理团队"
          description="当前角色可以继续使用项目、需求和 Bug 功能。如需调整成员或角色，请联系团队管理员。"
        />
      )}
    </div>
  )
}

export default Component
