import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { SearchX } from 'lucide-react'
import { useSession } from '@/features/identity/public'
import { describeRequestError } from '@/shared/api/errors'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Tag } from '@/shared/ui/tag'
import { formatDateTime } from '@/shared/lib/format'
import { canWriteKnowledge } from '../api/mutations'
import { skillListQueryOptions } from '../api/queries'
import { SKILL_CATEGORY_LABELS, SKILL_CATEGORY_OPTIONS } from '../model/labels'
import type { SkillListItem } from '../model/types'
import { SkillDetailPane } from './skill-detail'
import { SkillForm } from './skill-form'

/** 团队技能库：筛选、列表与详情面板。 */
export function SkillList({ teamId }: { teamId: string }) {
  const { role } = useSession()
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  const category = (params.get('category') ?? '') as SkillListItem['category'] | ''
  const selected = params.get('skill')
  const page = Number(params.get('page') ?? '1')
  const [createOpen, setCreateOpen] = useState(false)
  const canWrite = canWriteKnowledge(role)
  const filters = useMemo(
    () => ({ search: search || undefined, category: category || undefined, page, pageSize: 20 }),
    [search, category, page],
  )
  const query = useQuery(skillListQueryOptions(teamId, filters))
  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'skill') next.delete('page')
    setParams(next)
  }
  if (query.isPending) return <PageSkeleton />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <PageError
        title="技能列表加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void query.refetch()}
      />
    )
  }
  const data = query.data.data
  const filtered = Boolean(search || category)
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <section className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">技能库</h2>
          <span className="text-sm text-muted-foreground">{data.total}</span>
          <span className="flex-1" />
          {canWrite && (
            <Button onClick={() => setCreateOpen(true)}>
              <span aria-hidden="true">＋</span>
              发布 Skill
            </Button>
          )}
        </div>
        {(!filtered || data.total > 0) && (
          <div className="flex flex-wrap gap-2">
            <Select
              className="w-40"
              aria-label="技能分类"
              value={category}
              onChange={(event) => updateParam('category', event.target.value)}
            >
              <option value="">全部分类</option>
              {SKILL_CATEGORY_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Input
              className="w-64"
              aria-label="搜索技能"
              placeholder="搜索名称、调用标识或简述"
              value={search}
              maxLength={200}
              onChange={(event) => updateParam('search', event.target.value)}
            />
          </div>
        )}
        {data.items.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={filtered ? '没有符合条件的技能' : '还没有团队 Skill'}
            description={
              filtered
                ? '换个关键词或分类，或清除筛选后重新查看。'
                : '发布第一个 Skill，把团队的固定做法沉淀为可复用指令。'
            }
            action={
              filtered ? (
                <Button variant="outline" onClick={() => setParams(new URLSearchParams())}>
                  清除筛选
                </Button>
              ) : canWrite ? (
                <Button onClick={() => setCreateOpen(true)}>发布 Skill</Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {data.items.map((item) => (
              <li key={item.id} className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <Tag variant={item.enabled ? 'green' : 'neutral'}>{item.enabled ? '已启用' : '已停用'}</Tag>
                  <Tag>{SKILL_CATEGORY_LABELS[item.category]}</Tag>
                  <span className="flex-1" />
                  <span className="text-xs text-muted-foreground">v{item.contentVersion}</span>
                </div>
                <Button
                  variant="link"
                  className="mt-2 h-auto p-0 text-left"
                  onClick={() => updateParam('skill', item.id)}
                >
                  {item.name}
                </Button>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.summary}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <code className="text-xs">@skill/{item.identifier}</code>
                  <span className="text-xs text-muted-foreground">{formatDateTime(item.updatedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {selected && <SkillDetailPane teamId={teamId} skillId={selected} onClose={() => updateParam('skill', '')} />}
      {createOpen && <SkillForm teamId={teamId} open={createOpen} onOpenChange={setCreateOpen} />}
    </div>
  )
}
