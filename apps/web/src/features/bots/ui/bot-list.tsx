import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ellipsis, Plus, Search, SquareTerminal, UsersRound } from 'lucide-react'
import { Link, useSearchParams, useNavigate } from 'react-router'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { formatRelativeTime } from '@/shared/lib/format'
import { botListQueryOptions } from '../api/queries'
import { BotAvatar } from './bot-avatar'
import { BotForm } from './bot-form'
import { BotStatus } from './bot-status'

interface BotListProps {
  teamId: string
  userId: string
  canEdit: boolean
  canBindModel: boolean
  selectedId?: string
}

/**
 * 团队智能体目录，沿用原型的页签、搜索和表格。
 * @param props 当前团队和成员、创建与绑定权限、已选中的智能体。
 * @returns 可筛选的智能体目录和创建入口。
 */
export function BotList({ teamId, userId, canEdit, canBindModel, selectedId }: BotListProps) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [createOpen, setCreateOpen] = useState(false)
  const search = params.get('query') ?? ''
  const scope = params.get('ownerUserId') === userId ? 'mine' : 'all'
  const owner = params.get('ownerUserId') ?? undefined
  const cursor = params.get('cursor') ?? undefined
  const query = useQuery(botListQueryOptions(teamId, { query: search || undefined, ownerUserId: owner, cursor }))
  const openCreate = () => setCreateOpen(true)

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (key !== 'cursor') next.delete('cursor')
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: key !== 'cursor' })
  }

  const filtered = Boolean(search || owner || cursor)
  const items = query.data?.data.items ?? []
  const nextCursor = query.data?.data.nextCursor
  const newBot = (
    <Button type="button" className="new-agent-btn h-9 px-3" onClick={openCreate}>
      <Plus className="size-4" aria-hidden="true" />
      创建智能体
    </Button>
  )
  return (
    <>
      <header className="agent-page-header">
        <h1 className="sr-only">智能体</h1>
        <div className="agent-filters">
          <Tabs
            value={scope}
            className="w-full md:flex-1"
            onValueChange={(value) => setFilter('ownerUserId', value === 'mine' ? userId : '')}
          >
            <TabsList
              className="tabs w-full justify-start gap-6 rounded-none bg-transparent p-0"
              aria-label="智能体筛选"
            >
              <TabsTrigger variant="underline" value="all">
                全部智能体
              </TabsTrigger>
              <TabsTrigger variant="underline" value="mine">
                我负责的
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <label className="search">
            <Search aria-hidden="true" className="search-icon" />
            <Input
              value={search}
              maxLength={60}
              aria-label="搜索智能体"
              placeholder="搜索名称、职责或负责人"
              className="search-input"
              onChange={(event) => setFilter('query', event.target.value)}
            />
          </label>
          {canEdit && newBot}
        </div>
      </header>
      <div className="agent-catalog min-w-0">
        {query.isPending && <DelayedPageSkeleton />}
        {query.isError && (
          <PageError
            title="智能体列表加载失败"
            error={query.error}
            retrying={query.isFetching}
            onRetry={() => void query.refetch()}
          />
        )}
        {query.isSuccess &&
          items.length === 0 &&
          (filtered ? (
            <EmptyState
              title="没有找到智能体"
              description="试试其他名称、职责或负责人。"
              icon={<Search />}
              action={
                <Button variant="outline" onClick={() => setParams({})}>
                  清除筛选
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="还没有智能体"
              mascot="orbit"
              description={
                canEdit ? '创建一个智能体，为团队定义职责、模型与可用技能。' : '团队创建的智能体会显示在这里。'
              }
            />
          ))}
        {items.length > 0 && (
          <div className="table-wrap" aria-busy={query.isFetching}>
            <Table className="table agent-table" aria-label="智能体目录">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">智能体</TableHead>
                  <TableHead scope="col">状态</TableHead>
                  <TableHead scope="col">使用范围</TableHead>
                  <TableHead scope="col">运行环境</TableHead>
                  <TableHead scope="col">模型</TableHead>
                  <TableHead scope="col">最近活跃</TableHead>
                  <TableHead scope="col">
                    <span className="sr-only">操作</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((bot) => {
                  const detail = { pathname: `/capabilities/bots/${bot.id}`, search: params.toString() }
                  return (
                    <TableRow key={bot.id} className={bot.id === selectedId ? 'selected' : undefined}>
                      <TableCell>
                        <Link
                          className="agent-name focus-visible:ring-2 focus-visible:ring-ring"
                          to={detail}
                          aria-label={`查看${bot.name}详情`}
                        >
                          <BotAvatar avatarKey={bot.avatarKey} botId={bot.id} />
                          <span>
                            <strong>{bot.name}</strong>
                            <small>
                              {bot.responsibility}
                              {bot.ownerName && <span> · {bot.ownerName}</span>}
                            </small>
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <BotStatus value={bot.availability} />
                      </TableCell>
                      <TableCell>
                        <span className="scope-tag">
                          <UsersRound className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
                          独立 Bot
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="runtime-cell">
                          <SquareTerminal className="icon fill-none stroke-current stroke-2" aria-hidden="true" />
                          团队执行器
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="muted small">{bot.modelId ?? '未绑定'}</span>
                      </TableCell>
                      <TableCell>
                        <span className="quiet small">
                          {bot.lastActiveAt ? formatRelativeTime(bot.lastActiveAt) : '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          className="icon-btn"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`管理${bot.name}`}
                          onClick={() => navigate(detail)}
                        >
                          <Ellipsis aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
        {(cursor || nextCursor) && (
          <div className="mt-3 flex justify-end gap-2">
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
      {createOpen && (
        <BotForm
          teamId={teamId}
          defaultOwnerId={userId}
          canBindModel={canBindModel}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </>
  )
}
