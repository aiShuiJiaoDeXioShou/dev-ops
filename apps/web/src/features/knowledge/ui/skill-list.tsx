import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { ArrowUpRight, Layers, Plus, Search, SearchX } from 'lucide-react'
import { useSession } from '@/features/identity/public'
import { describeRequestError } from '@/shared/api/errors'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { PageSkeleton } from '@/shared/ui/page-skeleton'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { cn } from '@/shared/lib/utils'
import { canWriteKnowledge } from '../api/mutations'
import { skillListQueryOptions } from '../api/queries'
import { SKILL_CATEGORY_LABELS, SKILL_CATEGORY_OPTIONS } from '../model/labels'
import type { SkillListItem } from '../model/types'
import { CapabilitiesHeader } from './capabilities-header'
import { SkillDetailDialog } from './skill-detail'
import { SkillForm } from './skill-form'

/** 团队技能库：原型式页头、分类筛选、卡片网格与详情弹窗。 */
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
    setParams(next, { replace: true })
  }
  const filtered = Boolean(search || category)
  const headerAction = canWrite ? (
    <Button type="button" onClick={() => setCreateOpen(true)}>
      <Plus className="size-4" />
      发布 Skill
    </Button>
  ) : undefined

  return (
    <>
      <CapabilitiesHeader active="skills" action={headerAction} />
      <div className="content">
        <div className="catalog skills-catalog">
          {query.isError ? (
            <PageError
              title="技能列表加载失败"
              description={describeRequestError(query.error).description}
              requestId={describeRequestError(query.error).requestId}
              onRetry={() => void query.refetch()}
            />
          ) : query.isPending ? (
            <PageSkeleton />
          ) : (
            <>
              <div className="skill-toolbar">
                <div className="category-pills" role="group" aria-label="技能分类">
                  <Button
                    type="button"
                    variant="ghost"
                    className={cn('category-pill', !category && 'active')}
                    aria-pressed={!category}
                    onClick={() => updateParam('category', '')}
                  >
                    全部
                  </Button>
                  {SKILL_CATEGORY_OPTIONS.map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      variant="ghost"
                      className={cn('category-pill', category === value && 'active')}
                      aria-pressed={category === value}
                      onClick={() => updateParam('category', value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
                <label className="search">
                  <Search className="icon" aria-hidden="true" />
                  <Input
                    aria-label="搜索团队技能"
                    placeholder="搜索团队技能"
                    value={search}
                    maxLength={200}
                    className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                    onChange={(event) => updateParam('search', event.target.value)}
                  />
                </label>
              </div>
              {query.data.data.items.length === 0 ? (
                filtered ? (
                  <EmptyState
                    icon={<SearchX />}
                    title="没有符合条件的技能"
                    description="换个关键词或分类，或清除筛选后重新查看。"
                    action={
                      <Button type="button" variant="outline" onClick={() => setParams(new URLSearchParams())}>
                        清除筛选
                      </Button>
                    }
                  />
                ) : (
                  <EmptyState
                    mascot="prism"
                    title="还没有团队 Skill"
                    description="把团队固定的工作方法整理成技能包，让 Bot 与成员复用同一份指令和资源。"
                    action={
                      canWrite ? (
                        <Button type="button" onClick={() => setCreateOpen(true)}>
                          发布 Skill
                        </Button>
                      ) : undefined
                    }
                  />
                )
              ) : (
                <ul className="skill-grid">
                  {query.data.data.items.map((item) => (
                    <li key={item.id} className="skill-card">
                      <div className="row spread">
                        <span className="skill-glyph">
                          <Layers className="size-5" aria-hidden="true" />
                        </span>
                        <span className="skill-state">
                          <span className={cn('dot', item.enabled ? 'green' : '')} />
                          {item.enabled ? '已启用' : '已停用'}
                        </span>
                      </div>
                      <Link className="skill-title" to={`?skill=${encodeURIComponent(item.id)}`}>
                        {item.name}
                      </Link>
                      <p>{item.summary}</p>
                      <div className="skill-meta">
                        <span>{SKILL_CATEGORY_LABELS[item.category]}</span>
                        <span>v{item.contentVersion}</span>
                        <span className="spacer" />
                        <span>团队维护</span>
                      </div>
                      <div className="skill-card-footer">
                        <code>@skill/{item.identifier}</code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-primary"
                          aria-label={`查看技能 ${item.name}`}
                          onClick={() => updateParam('skill', item.id)}
                        >
                          <ArrowUpRight className="size-4" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
      {selected && <SkillDetailDialog teamId={teamId} skillId={selected} onClose={() => updateParam('skill', '')} />}
      {createOpen && <SkillForm teamId={teamId} open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  )
}
