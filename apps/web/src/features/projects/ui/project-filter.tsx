import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Funnel } from 'lucide-react'
import { teamMembersQueryOptions } from '@/features/identity/api/team-queries'
import { Button } from '@/shared/ui/controls/button'
import { Checkbox } from '@/shared/ui/controls/checkbox'
import { Combobox } from '@/shared/ui/controls/combobox'
import { FormField } from '@/shared/ui/controls/form-field'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/controls/popover'
import { Select } from '@/shared/ui/controls/select'
import { projectRepositoryOptionsQueryOptions } from '../api/queries'
import {
  countProjectCriteria,
  EMPTY_PROJECT_CRITERIA,
  PROJECT_STATUS_LABELS,
  REPOSITORY_LINKED,
  REPOSITORY_UNLINKED,
  type ProjectCriteria,
} from '../model/filters'

/**
 * 组合项目状态、仓库和负责人条件，点击应用后才更新列表。
 * @param props 当前团队、用户、已应用条件和提交回调。关闭面板时丢弃未应用条件。
 * @returns 项目筛选的单一入口及带键盘支持的条件面板。
 */
export function ProjectFilter({
  teamId,
  currentUserId,
  value,
  onApply,
}: {
  teamId: string
  currentUserId: string
  value: ProjectCriteria
  onApply: (criteria: ProjectCriteria) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const statusId = useId()
  const repoId = useId()
  const ownerId = useId()
  const count = countProjectCriteria(value)
  const repositories = useQuery({ ...projectRepositoryOptionsQueryOptions(teamId), enabled: open })
  const members = useQuery({ ...teamMembersQueryOptions(teamId), enabled: open })
  const repositoryOptions = [
    { value: '', label: '全部仓库' },
    { value: REPOSITORY_LINKED, label: '已关联仓库' },
    { value: REPOSITORY_UNLINKED, label: '未关联仓库' },
    ...(repositories.data ?? []).map((repository) => ({
      value: repository.id,
      label: `${repository.namespace}/${repository.name} · ${repository.connectionName ?? repository.providerKey}`,
    })),
  ]
  if (draft.repository && !repositoryOptions.some((option) => option.value === draft.repository)) {
    repositoryOptions.push({
      value: draft.repository,
      label: repositories.isSuccess ? '所选仓库不可用' : '所选仓库',
    })
  }
  const otherMembers = (members.data?.data ?? []).filter((member) => member.userId !== currentUserId)
  const selectedMemberMissing =
    draft.ownerId && draft.ownerId !== currentUserId && !otherMembers.some((member) => member.userId === draft.ownerId)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value)
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          aria-label={count ? `筛选，已应用 ${count} 个条件` : '筛选'}
          className="project-filter-trigger gap-0 border-border bg-muted p-0"
        >
          <span className="flex h-full items-center gap-1 border-r border-border px-2" aria-hidden="true">
            <Funnel className="size-4" />
            <ChevronDown className="size-3 text-muted-foreground" />
          </span>
          <span className="flex items-center gap-1.5 px-2.5">
            筛选
            {count > 0 && <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary">{count}</span>}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} aria-label="项目筛选" className="project-filter-panel">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            setOpen(false)
            onApply(draft)
          }}
        >
          <div className="space-y-3">
            <FormField label="状态" htmlFor={statusId}>
              <Select
                className="w-full"
                id={statusId}
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value })}
              >
                <option value="">全部状态</option>
                {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="仓库" htmlFor={repoId} help={repositories.isFetching ? '正在加载仓库选项…' : undefined}>
              <Combobox
                id={repoId}
                aria-label="仓库"
                value={draft.repository}
                options={repositoryOptions}
                onValueChange={(repository) => setDraft({ ...draft, repository })}
                searchPlaceholder="搜索仓库"
                emptyMessage="没有匹配的仓库"
              />
              {repositories.isError && (
                <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                  仓库选项加载失败
                  <Button type="button" size="sm" variant="ghost" onClick={() => void repositories.refetch()}>
                    重试
                  </Button>
                </div>
              )}
            </FormField>
            <FormField label="负责人" htmlFor={ownerId} help={members.isFetching ? '正在加载成员选项…' : undefined}>
              <Select
                className="w-full"
                id={ownerId}
                value={draft.ownerId}
                onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}
              >
                <option value="">全部负责人</option>
                <option value={currentUserId}>我负责</option>
                {otherMembers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.name}
                  </option>
                ))}
                {selectedMemberMissing && <option value={draft.ownerId}>所选负责人</option>}
              </Select>
              {members.isError && (
                <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
                  成员选项加载失败
                  <Button type="button" size="sm" variant="ghost" onClick={() => void members.refetch()}>
                    重试
                  </Button>
                </div>
              )}
            </FormField>
            <label className="project-owner-filter-option flex cursor-pointer items-center gap-2 py-1 text-sm">
              <Checkbox
                checked={draft.ownerUnavailable}
                onCheckedChange={(checked) => setDraft({ ...draft, ownerUnavailable: checked === true })}
              />
              仅看负责人已失效
            </label>
          </div>
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              disabled={!countProjectCriteria(draft)}
              onClick={() => setDraft(EMPTY_PROJECT_CRITERIA)}
            >
              重置
            </Button>
            <Button type="submit">应用筛选</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
