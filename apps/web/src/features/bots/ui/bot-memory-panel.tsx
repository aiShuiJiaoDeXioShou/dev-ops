import { useInfiniteQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { describeRequestError } from '@/shared/api/errors'
import { Button, buttonVariants } from '@/shared/ui/controls/button'
import { Tag } from '@/shared/ui/tag'
import { botMemoryOptions } from '../api/memories'
import type { BotView } from '../api/queries'

const PREVIEW_COUNT = 3

/**
 * 在会话侧栏概览指定 Bot 的可见记忆，完整的新增、编辑与删除在记忆页完成。
 * @param props 当前 Bot。
 * @returns 记忆条数、最近几条预览与跳转到已预选该 Bot 的记忆页入口；加载失败可重试。
 */
export function BotMemoryPanel({ bot }: { bot: BotView }) {
  const list = useInfiniteQuery(botMemoryOptions(bot.teamId, { botId: bot.id }))
  const firstPage = list.data?.pages[0]?.data
  const memories = firstPage?.items ?? []
  const hasMore = Boolean(firstPage?.nextCursor)
  const essentialCount = memories.filter((memory) => memory.essential).length
  return (
    <section className="settings-section" aria-label={`${bot.name}的长期记忆`}>
      <div className="settings-section-row">
        <h4>长期记忆</h4>
        <Link
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          to={`/capabilities/memory?botId=${encodeURIComponent(bot.id)}`}
        >
          管理记忆
        </Link>
      </div>
      {list.isPending && (
        <p className="settings-scope-note" role="status">
          正在加载记忆…
        </p>
      )}
      {list.isError && (
        <div className="grid gap-2">
          <p className="field-error" role="alert">
            {describeRequestError(list.error).description}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={() => void list.refetch()}>
            重试加载记忆
          </Button>
        </div>
      )}
      {list.isSuccess && !memories.length && <p className="settings-scope-note">还没有记忆</p>}
      {memories.length > 0 && (
        <>
          <p className="settings-scope-note">
            {hasMore ? `${memories.length} 条以上` : `共 ${memories.length} 条`}
            {essentialCount ? `，其中 ${essentialCount} 条常驻` : ''}
          </p>
          <ul className="settings-memory-preview">
            {memories.slice(0, PREVIEW_COUNT).map((memory) => (
              <li key={memory.id}>
                <Tag>{memory.scope === 'user' ? '用户画像' : 'Bot 笔记'}</Tag>
                <span>{memory.content}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
