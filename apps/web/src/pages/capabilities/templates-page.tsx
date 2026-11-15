import { EmptyState } from '@/shared/ui/page-state'
import { useSession } from '@/features/identity/model/session'
import { TemplateList } from '@/features/knowledge/ui/template-list'

/** 能力—AGENTS.md 模板页面。 */
export function Component() {
  const { currentTeam } = useSession()
  if (!currentTeam) {
    return <EmptyState mascot="group" title="尚未选择团队" description="加入团队后即可管理 AGENTS.md 模板。" />
  }
  return <TemplateList teamId={currentTeam.id} />
}

export default Component
