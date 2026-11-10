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
import { Tag } from '@/shared/ui/tag'
import { formatDateTime } from '@/shared/lib/format'
import { canWriteKnowledge } from '../api/mutations'
import { templateListQueryOptions } from '../api/queries'
import { TemplateDetailPane } from './template-detail'
import { TemplateForm } from './template-form'

/** 团队 AGENTS.md 模板目录。 */
export function TemplateList({ teamId }: { teamId: string }) {
  const { role } = useSession()
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  const tag = params.get('tag') ?? ''
  const selected = params.get('template')
  const page = Number(params.get('page') ?? '1')
  const [createOpen, setCreateOpen] = useState(false)
  const canWrite = canWriteKnowledge(role)
  const filters = useMemo(
    () => ({ search: search || undefined, tag: tag || undefined, page, pageSize: 20 }),
    [search, tag, page],
  )
  const query = useQuery(templateListQueryOptions(teamId, filters))
  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'template') next.delete('page')
    setParams(next)
  }
  if (query.isPending) return <PageSkeleton />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <PageError
        title="模板列表加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void query.refetch()}
      />
    )
  }
  const data = query.data.data
  const filtered = Boolean(search || tag)
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      <section className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">AGENTS.md 模板</h2>
          <span className="text-sm text-muted-foreground">{data.total}</span>
          <span className="flex-1" />
          {canWrite && (
            <Button onClick={() => setCreateOpen(true)}>
              <span aria-hidden="true">＋</span>
              新建模板
            </Button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            className="w-64"
            aria-label="搜索模板"
            placeholder="搜索模板名称或分类"
            value={search}
            maxLength={200}
            onChange={(event) => updateParam('search', event.target.value)}
          />
          <Input
            className="w-40"
            aria-label="分类筛选"
            placeholder="分类标签"
            value={tag}
            maxLength={30}
            onChange={(event) => updateParam('tag', event.target.value)}
          />
        </div>
        {data.items.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title={filtered ? '没有符合条件的模板' : '还没有 AGENTS.md 模板'}
            description={
              filtered
                ? '换个关键词或分类，或清除筛选后重新查看。'
                : '新建模板，把项目的协作约定沉淀为可复用的平台模板。'
            }
            action={
              filtered ? (
                <Button variant="outline" onClick={() => setParams(new URLSearchParams())}>
                  清除筛选
                </Button>
              ) : canWrite ? (
                <Button onClick={() => setCreateOpen(true)}>新建模板</Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {data.items.map((item) => (
              <li key={item.id} className="rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <Tag>{item.tag}</Tag>
                  <span className="flex-1" />
                  <span className="text-xs text-muted-foreground">v{item.contentVersion}</span>
                </div>
                <Button
                  variant="link"
                  className="mt-2 h-auto p-0 text-left"
                  onClick={() => updateParam('template', item.id)}
                >
                  {item.name}
                </Button>
                <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description || '暂无说明'}</p>
                <p className="mt-3 text-xs text-muted-foreground">更新于 {formatDateTime(item.updatedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {selected && (
        <TemplateDetailPane teamId={teamId} templateId={selected} onClose={() => updateParam('template', '')} />
      )}
      {createOpen && <TemplateForm teamId={teamId} open={createOpen} onOpenChange={setCreateOpen} />}
    </div>
  )
}
