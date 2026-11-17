import { createPortal } from 'react-dom'
import { useNavigate, useOutletContext, useParams, useLocation } from 'react-router'
import { BotDetail } from '@/features/bots/ui/bot-detail'
import { BotList } from '@/features/bots/ui/bot-list'
import { useSession } from '@/features/identity/model/session'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState } from '@/shared/ui/page-state'

/** 智能体目录及右侧详情栏，团队切换时使用新团队权限。 */
export function Component() {
  const { botId } = useParams()
  const { search } = useLocation()
  const detailHost = useOutletContext<HTMLDivElement | null>()
  const navigate = useNavigate()
  const { user, currentTeam, role, isReady } = useSession()
  if (!isReady) return <DelayedPageSkeleton />
  if (!currentTeam)
    return <EmptyState mascot="group" title="尚未选择团队" description="加入团队后即可查看团队的智能体。" />
  const canEdit = role === 'admin' || role === 'developer'
  return (
    <>
      <BotList key={currentTeam.id} teamId={currentTeam.id} userId={user.id} canEdit={canEdit} selectedId={botId} />
      {detailHost &&
        botId &&
        createPortal(
          <BotDetail
            key={`${currentTeam.id}:${botId}`}
            botId={botId}
            teamId={currentTeam.id}
            userId={user.id}
            canEdit={canEdit}
            canBindModel={role === 'admin'}
            onClose={() => navigate({ pathname: '/capabilities/bots', search }, { replace: true })}
          />,
          detailHost,
        )}
    </>
  )
}
