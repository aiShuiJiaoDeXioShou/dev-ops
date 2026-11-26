import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Check, Code2, Compass, Copy, FolderUp, Plus, Rocket, Search } from 'lucide-react'
import { DirectConversationPicker } from '@/features/conversations/ui/direct-conversation-picker'
import { useSession } from '@/features/identity/model/session'
import { describeRequestError } from '@/shared/api/errors'
import { isNestedInteractiveTarget } from '@/shared/lib/clickable'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { CardGridSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'
import { Pagination } from '@/shared/ui/pagination'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import { canWriteKnowledge } from '../api/mutations'
import { skillListQueryOptions } from '../api/queries'
import { copyText } from '../lib/files'
import { pickSkillDirectory, readSkillPackageDirectory } from '../lib/skill-package'
import { SKILL_CATEGORY_LABELS, SKILL_CATEGORY_OPTIONS } from '../model/labels'
import type { ImportedSkillPackage, SkillListItem } from '../model/types'
import { SkillDetailDrawer } from './skill-detail'
import { SkillForm } from './skill-form'

/** 按技能分类渲染语义图标，帮助在 Hub 卡片网格中快速辨识领域。 */
function SkillCategoryIcon({ category }: { category: SkillListItem['category'] }) {
  const Icon = category === 'engineering' ? Code2 : category === 'delivery' ? Rocket : Compass
  return (
    <span className={cn('skill-hub-glyph', `is-${category}`)} aria-hidden="true">
      <Icon className="size-4" />
    </span>
  )
}

/** 构造保留当前筛选条件并指向目标技能详情的查询串。 */
function buildSkillHref(params: URLSearchParams, skillId: string): string {
  const next = new URLSearchParams(params)
  next.set('skill', skillId)
  return `?${next.toString()}`
}

/**
 * 团队技能库 Hub：紧凑页头、分类/来源/状态多维筛选、指令优先卡片网格与右侧详情抽屉。
 * @param props.teamId 当前团队标识。
 */
export function SkillList({ teamId }: { teamId: string }) {
  const { role } = useSession()
  const { showToast } = useToast()
  const [params, setParams] = useSearchParams()
  const search = params.get('search') ?? ''
  const [searchInput, setSearchInput] = useState(search)
  const category = (params.get('category') ?? '') as SkillListItem['category'] | ''
  const sourceParam = params.get('source') ?? ''
  const source: SkillListItem['source'] | '' = sourceParam === 'platform' || sourceParam === 'team' ? sourceParam : ''
  const statusParam = params.get('status') ?? ''
  const enabledFilter = statusParam === 'enabled' ? true : statusParam === 'disabled' ? false : undefined
  const selected = params.get('skill')
  const page = Number(params.get('page') ?? '1')

  const [createOpen, setCreateOpen] = useState(false)
  const [importedDraft, setImportedDraft] = useState<ImportedSkillPackage | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [pickerSkill, setPickerSkill] = useState<SkillListItem | null>(null)
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const canWrite = canWriteKnowledge(role)

  const filters = useMemo(
    () => ({
      search: search || undefined,
      category: category || undefined,
      source: source || undefined,
      enabled: enabledFilter,
      page,
      pageSize: 20,
    }),
    [search, category, source, enabledFilter, page],
  )
  const query = useQuery(skillListQueryOptions(teamId, filters))

  useEffect(() => {
    setSearchInput(search)
  }, [search])

  useEffect(() => {
    if (searchInput === search) return
    // 输入防抖后再写 URL，避免逐字回写覆盖用户输入并触发多次查询。
    const timer = window.setTimeout(() => updateParam('search', searchInput), 350)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, search, params, setParams])

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'skill' && key !== 'page') next.delete('page')
    setParams(next, { replace: true })
  }

  const clearFilters = () => {
    setSearchInput('')
    setParams(new URLSearchParams(), { replace: true })
  }

  const handleImportDirectory = async () => {
    const fileList = await pickSkillDirectory()
    if (!fileList || fileList.length === 0) return
    try {
      const imported = await readSkillPackageDirectory(fileList)
      setImportedDraft(imported)
      setCreateOpen(true)
      showToast(`已解析技能包：${imported.body.length} 字符正文，${imported.files.length} 个资源文件`, 'success')
    } catch (cause: unknown) {
      showToast(cause instanceof Error ? cause.message : '技能包导入失败。', 'error')
    }
  }

  const handleCopyCommand = async (item: SkillListItem) => {
    const command = `@skill/${item.identifier}`
    const ok = await copyText(command)
    if (ok) {
      setCopiedId(item.id)
      window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1400)
    }
    showToast(ok ? `已复制 ${command}` : '浏览器未允许自动复制，请手动选择内容。', ok ? 'success' : 'info')
  }

  const filtered = Boolean(search || category || source || statusParam)
  const items = query.data?.data.items ?? []
  const total = query.data?.data.total ?? 0
  const platformSkill = items.find((item) => item.id === selected && item.source === 'platform')

  return (
    <div className="cap-hub-page">
      <header className="cap-hub-head">
        <div className="cap-hub-title-group">
          <div className="cap-hub-title-row">
            <h1 className="cap-hub-title">技能库</h1>
            {query.isSuccess && <span className="cap-hub-count">{total}</span>}
          </div>
          <p className="cap-hub-subtitle">
            沉淀团队可复用的指令与脚本包，在会话中通过 <code>@skill/标识</code> 调用。
          </p>
        </div>
        {canWrite && (
          <div className="cap-hub-actions">
            <Button type="button" variant="outline" size="sm" onClick={() => void handleImportDirectory()}>
              <FolderUp className="size-4" aria-hidden="true" />
              导入目录
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setImportedDraft(null)
                setCreateOpen(true)
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              发布 Skill
            </Button>
          </div>
        )}
      </header>

      <div className="cap-hub-toolbar">
        <div className="cap-hub-filters">
          <div className="cap-hub-pills" role="group" aria-label="技能分类">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn('cap-hub-pill', !category && 'active')}
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
                size="sm"
                className={cn('cap-hub-pill', category === value && 'active')}
                aria-pressed={category === value}
                onClick={() => updateParam('category', value)}
              >
                {label}
              </Button>
            ))}
          </div>
          <Select
            aria-label="筛选技能来源"
            className="cap-hub-select"
            value={source}
            onChange={(event) => updateParam('source', event.target.value)}
          >
            <option value="">全部来源</option>
            <option value="platform">平台内置</option>
            <option value="team">团队维护</option>
          </Select>
          <Select
            aria-label="筛选技能状态"
            className="cap-hub-select"
            value={statusParam}
            onChange={(event) => updateParam('status', event.target.value)}
          >
            <option value="">全部状态</option>
            <option value="enabled">仅已启用</option>
            <option value="disabled">仅已停用</option>
          </Select>
        </div>
        <label className="cap-hub-search">
          <Search className="search-icon" aria-hidden="true" />
          <Input
            type="search"
            aria-label="搜索团队技能"
            placeholder="搜索名称、标识或摘要"
            value={searchInput}
            maxLength={200}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </label>
      </div>

      {query.isError ? (
        <PageError
          title="技能列表加载失败"
          description={describeRequestError(query.error).description}
          requestId={describeRequestError(query.error).requestId}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <CardGridSkeleton count={6} iconShape="square" lines={2} label="技能库加载中" />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState
            mascot="prism"
            title="没有符合条件的技能"
            description="换个关键词、来源或分类，或清除筛选后重新查看。"
            action={
              <Button type="button" variant="outline" onClick={clearFilters}>
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
                <Button
                  type="button"
                  onClick={() => {
                    setImportedDraft(null)
                    setCreateOpen(true)
                  }}
                >
                  发布 Skill
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <ul className="skill-hub-grid" aria-busy={query.isFetching}>
            {items.map((item) => {
              const isCopied = copiedId === item.id
              const fileCount = item.fileCount ?? 0
              return (
                <li key={item.id} className={cn('skill-hub-card', !item.enabled && 'is-disabled')}>
                  <div
                    className="skill-hub-card-main"
                    onClick={(event) => {
                      if (isNestedInteractiveTarget(event.target)) return
                      updateParam('skill', item.id)
                    }}
                  >
                    <div className="skill-hub-card-top">
                      <SkillCategoryIcon category={item.category} />
                      <div className="skill-hub-head-text">
                        <div className="skill-hub-title-line">
                          <Link className="skill-hub-name" to={buildSkillHref(params, item.id)}>
                            {item.name}
                          </Link>
                          <Tag variant={item.source === 'platform' ? 'blue' : 'neutral'}>
                            {item.source === 'platform' ? '平台内置' : '团队维护'}
                          </Tag>
                          {item.conflictsWithPlatform && <Tag variant="red">同名冲突</Tag>}
                        </div>
                        <div className="skill-hub-meta">
                          <span>{SKILL_CATEGORY_LABELS[item.category]}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">v{item.contentVersion}</span>
                          {fileCount > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{fileCount} 个资源文件</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className={cn('skill-hub-dot', item.enabled && 'is-enabled')} aria-hidden="true" />
                            {item.enabled ? '已启用' : '已停用'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <p className="skill-hub-summary">{item.summary}</p>
                  </div>

                  <div className="skill-hub-foot">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn('skill-hub-cmd-btn', isCopied && 'is-copied')}
                      aria-label={`复制调用指令 @skill/${item.identifier}`}
                      onClick={() => void handleCopyCommand(item)}
                    >
                      {isCopied ? (
                        <Check className="size-3.5 shrink-0" aria-hidden="true" />
                      ) : (
                        <Copy className="size-3.5 shrink-0" aria-hidden="true" />
                      )}
                      <code>{isCopied ? '已复制' : `@skill/${item.identifier}`}</code>
                    </Button>
                    <div className="skill-hub-foot-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        aria-label={`查看技能 ${item.name}`}
                        onClick={() => updateParam('skill', item.id)}
                      >
                        详情
                      </Button>
                      {canWrite && item.enabled && item.source === 'team' && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          aria-label={`使用技能 ${item.name}`}
                          onClick={(event) => {
                            pickerTriggerRef.current = event.currentTarget
                            setPickerSkill(item)
                          }}
                        >
                          使用
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          <Pagination
            page={page}
            pageSize={query.data.data.pageSize}
            total={total}
            onChange={(next) => updateParam('page', String(next))}
          />
        </>
      )}

      {selected && !query.isPending && (
        <SkillDetailDrawer
          teamId={teamId}
          skillId={selected}
          platformSkill={platformSkill}
          onClose={() => updateParam('skill', '')}
        />
      )}

      {pickerSkill && (
        <DirectConversationPicker
          teamId={teamId}
          skill={pickerSkill}
          onClose={() => setPickerSkill(null)}
          onRestoreFocus={() => pickerTriggerRef.current?.focus()}
        />
      )}

      {createOpen && (
        <SkillForm
          teamId={teamId}
          open={createOpen}
          initialImported={importedDraft}
          onOpenChange={(open) => {
            setCreateOpen(open)
            if (!open) setImportedDraft(null)
          }}
        />
      )}
    </div>
  )
}
