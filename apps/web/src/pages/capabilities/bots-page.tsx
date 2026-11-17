import { useParams } from 'react-router'
import { BotDetail } from '@/features/bots/ui/bot-detail'
import { BotList } from '@/features/bots/ui/bot-list'
import { useSession } from '@/features/identity/model/session'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState } from '@/shared/ui/page-state'

/** 智能体目录及详情，团队切换后用新团队权限重新加载。 */
export function Component() {
  const { botId } = useParams()
  const { user, currentTeam, role, isReady } = useSession()
  if (!isReady) return <DelayedPageSkeleton />
  if (!currentTeam)
    return <EmptyState mascot="group" title="尚未选择团队" description="加入团队后即可查看团队的 Bot。" />
  const canEdit = role === 'admin' || role === 'developer'
  if (botId)
    return (
      <BotDetail
        key={`${currentTeam.id}:${botId}`}
        botId={botId}
        teamId={currentTeam.id}
        userId={user.id}
        canEdit={canEdit}
      />
    )
  return <BotList key={currentTeam.id} teamId={currentTeam.id} userId={user.id} canEdit={canEdit} />
}
