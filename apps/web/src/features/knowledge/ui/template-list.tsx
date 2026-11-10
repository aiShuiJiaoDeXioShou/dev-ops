import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { FileText, Link2, Plus, Search } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Tag } from '@/shared/ui/tag'
import { Pagination } from '@/shared/ui/pagination'
import { useToast } from '@/shared/ui/toast'
import { canWriteKnowledge } from '../api/mutations'
import { templateListQueryOptions } from '../api/queries'
import { copyText, downloadTextFile } from '../lib/files'
import { CapabilitiesHeader } from './capabilities-header'
import { TemplateDetailDialog } from './template-detail'
import { TemplateForm } from './template-form'

/** 团队 AGENTS.md 模板目录：原型式工具栏、卡片网格与详情弹窗。 */
export function TemplateList({ teamId }: { teamId: string }) {
  const { role } = useSession()
  const { showToast } = useToast()
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  const selected = params.get('template')
  const page = Number(params.get('page') ?? '1')
  const [createOpen, setCreateOpen] = useState(false)
  const canWrite = canWriteKnowledge(role)
  const filters = useMemo(() => ({ search: search || undefined, page, pageSize: 20 }), [search, page])
  const query = useQuery(templateListQueryOptions(teamId, filters))
  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'template' && key !== 'skill' && key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }
  const copyContent = async (templateId: string) => {
    try {
      const detail = await apiClient.getAgentTemplate(templateId)
      const copied = await copyText(detail.data.content)
      showToast(copied ? '已复制模板内容' : '浏览器未允许自动复制，请手动选择内容。', copied ? 'success' : 'info')
    } catch (cause: unknown) {
      showToast(describeRequestError(cause).description, 'error')
    }
  }
  const downloadTemplate = async (templateId: string) => {
    try {
      const detail = await apiClient.getAgentTemplate(templateId)
      downloadTextFile('AGENTS.md', detail.data.content)
    } catch (cause: unknown) {
      showToast(describeRequestError(cause).description, 'error')
    }
  }
  const copyLink = async (templateId: string) => {
    try {
      const result = await apiClient.createTemplateSnapshotLink(templateId)
      const copied = await copyText(`${window.location.origin}/capabilities/snapshots/${result.data.token}`)
      showToast(copied ? '已复制快照预览链接' : '复制失败，请手动复制链接。', copied ? 'success' : 'info')
    } catch (cause: unknown) {
      showToast(describeRequestError(cause).description, 'error')
    }
  }

  return (
    <>
      <CapabilitiesHeader
        active="templates"
        action={
          canWrite ? (
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              新建模板
            </Button>
          ) : undefined
        }
      />
      <div className="catalog">
        {query.isError ? (
          <PageError
            title="模板列表加载失败"
            description={describeRequestError(query.error).description}
            requestId={describeRequestError(query.error).requestId}
            onRetry={() => void query.refetch()}
          />
        ) : query.isPending ? (
          <DelayedPageSkeleton />
        ) : (
          <>
            <label className="search">
              <Search className="search-icon" aria-hidden="true" />
              <Input
                aria-label="搜索模板名称或分类"
                placeholder="搜索模板名称或分类"
                value={search}
                maxLength={200}
                className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
                onChange={(event) => updateParam('search', event.target.value)}
              />
            </label>
            {query.data.data.items.length === 0 ? (
              search ? (
                <EmptyState
                  mascot="project"
                  title="没有符合条件的模板"
                  description="换个关键词，或清除搜索后重新查看。"
                  action={
                    <Button type="button" variant="outline" onClick={() => setParams(new URLSearchParams())}>
                      清除搜索
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  mascot="project"
                  title="还没有 AGENTS.md 模板"
                  description="把项目的协作约定整理成模板，选用后供项目 Bot 作为协作约定使用。"
                  action={
                    canWrite ? (
                      <Button type="button" onClick={() => setCreateOpen(true)}>
                        新建模板
                      </Button>
                    ) : undefined
                  }
                />
              )
            ) : (
              <ul className="template-grid">
                {query.data.data.items.map((item) => (
                  <li key={item.id} className="template-card">
                    <div className="row spread">
                      <span className="skill-glyph">
                        <FileText className="size-5" aria-hidden="true" />
                      </span>
                      <Tag>{item.tag}</Tag>
                    </div>
                    <h3>
                      <Link className="skill-title" to={`?template=${encodeURIComponent(item.id)}`}>
                        {item.name}
                      </Link>
                    </h3>
                    <p>{item.description || '暂无说明'}</p>
                    <pre>{item.excerpt}</pre>
                    <div className="document-toolbar">
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => void copyContent(item.id)}
                      >
                        复制内容
                      </Button>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => void copyLink(item.id)}
                      >
                        <Link2 className="size-3.5" />
                        复制链接
                      </Button>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => void downloadTemplate(item.id)}
                      >
                        下载
                      </Button>
                    </div>
                    <div className="row spread">
                      <span className="text-xs text-muted-foreground">v{item.contentVersion}</span>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        onClick={() => updateParam('template', item.id)}
                      >
                        管理文件 →
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <Pagination
              page={page}
              pageSize={query.data.data.pageSize}
              total={query.data.data.total}
              onChange={(next) => updateParam('page', String(next))}
            />
          </>
        )}
      </div>
      {selected && (
        <TemplateDetailDialog teamId={teamId} templateId={selected} onClose={() => updateParam('template', '')} />
      )}
      {createOpen && <TemplateForm teamId={teamId} open={createOpen} onOpenChange={setCreateOpen} />}
    </>
  )
}
