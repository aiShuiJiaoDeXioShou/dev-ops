import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot, Plus, Search } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { teamMembersQueryOptions } from '@/features/identity/api/team-queries'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { botListQueryOptions } from '../api/queries'
import { BotForm } from './bot-form'
import { BotStatus } from './bot-status'

interface BotListProps {
  teamId: string
  userId: string
  canEdit: boolean
}

/** 团队 Bot 目录，保留团队内的搜索、负责人和分页位置。 */
export function BotList({ teamId, userId, canEdit }: BotListProps) {
  const [params, setParams] = useSearchParams()
  const [createOpen, setCreateOpen] = useState(false)
  const search = params.get('query') ?? ''
  const owner = params.get('ownerUserId') ?? ''
  const cursor = params.get('cursor') ?? undefined
  const query = useQuery(
    botListQueryOptions(teamId, { query: search || undefined, ownerUserId: owner || undefined, cursor }),
  )
  const members = useQuery(teamMembersQueryOptions(teamId))
  const openCreate = () => setCreateOpen(true)

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (key !== 'cursor') next.delete('cursor')
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: key !== 'cursor' })
  }

  const hasFilter = Boolean(search || owner)
  const items = query.data?.data.items ?? []
  const nextCursor = query.data?.data.nextCursor
  return (
    <>
      <header className="page-head skills-header">
        <h1>智能体</h1>
        {canEdit && (
          <Button type="button" onClick={openCreate}>
            <Plus className="size-4" aria-hidden="true" /> 创建 Bot
          </Button>
        )}
      </header>
      <div className="catalog skills-catalog">
        <div className="filters flex flex-wrap gap-3">
          <label className="search">
            <Search aria-hidden="true" className="search-icon" />
            <Input
              value={search}
              maxLength={60}
              aria-label="搜索 Bot"
              placeholder="搜索 Bot"
              className="search-input"
              onChange={(event) => setFilter('query', event.target.value)}
            />
          </label>
          <Select
            aria-label="按负责人筛选"
            disabled={members.isPending || members.isError}
            value={owner}
            onChange={(event) => setFilter('ownerUserId', event.target.value)}
          >
            <option value="">全部负责人</option>
            {members.data?.data.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </Select>
          {members.isError && (
            <Button type="button" variant="outline" onClick={() => void members.refetch()}>
              重试加载负责人
            </Button>
          )}
        </div>
        {query.isPending ? <DelayedPageSkeleton /> : null}
        {query.isError && (
          <PageError
            title="Bot 列表加载失败"
            error={query.error}
            retrying={query.isFetching}
            onRetry={() => void query.refetch()}
          />
        )}
        {query.isSuccess &&
          items.length === 0 &&
          (hasFilter || cursor ? (
            <EmptyState
              title="没有符合条件的 Bot"
              icon={<Search />}
              action={
                <Button variant="outline" onClick={() => setParams({})}>
                  清除筛选
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="还没有 Bot"
              mascot="orbit"
              description={canEdit ? '创建团队 Bot，为它分配职责和负责人。' : '团队发布 Bot 后，会显示在这里。'}
            />
          ))}
        {items.length > 0 && (
          <ul className="skill-grid" aria-busy={query.isFetching}>
            {items.map((bot) => (
              <li key={bot.id} className="skill-card">
                <div className="row spread">
                  <span className="skill-glyph">
                    <Bot className="size-5" aria-hidden="true" />
                  </span>
                  <BotStatus value={bot.availability} />
                </div>
                <Link className="skill-title break-words" to={{ pathname: bot.id, search: params.toString() }}>
                  {bot.name}
                </Link>
                <p className="break-words">{bot.responsibility}</p>
                <div className="skill-meta">
                  <span>负责人 {bot.ownerName ?? '未找到成员'}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {(cursor || nextCursor) && (
          <div className="flex justify-end gap-2">
            {cursor && (
              <Button type="button" variant="outline" onClick={() => setFilter('cursor', '')}>
                回到第一页
              </Button>
            )}
            {nextCursor && (
              <Button
                type="button"
                variant="outline"
                disabled={query.isFetching}
                onClick={() => setFilter('cursor', nextCursor)}
              >
                下一页
              </Button>
            )}
          </div>
        )}
      </div>
      {createOpen && <BotForm teamId={teamId} defaultOwnerId={userId} onClose={() => setCreateOpen(false)} />}
    </>
  )
}
