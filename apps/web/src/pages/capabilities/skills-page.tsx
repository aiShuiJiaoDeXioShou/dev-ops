import { EmptyState } from '@/shared/ui/page-state'
import { useSession } from '@/features/identity/public'
import { SkillList } from '@/features/knowledge/public'

/** 能力—技能库页面。 */
export function Component() {
  const { currentTeam } = useSession()
  if (!currentTeam) {
    return <EmptyState title="尚未选择团队" description="加入团队后即可管理团队 Skills。" />
  }
  return <SkillList teamId={currentTeam.id} />
}

export default Component
