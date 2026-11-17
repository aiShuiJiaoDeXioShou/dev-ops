import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isBusinessError, type ApiBody, type ApiSuccessData } from '@dev-ops/api-client'
import { Ellipsis, Plus } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/controls/dropdown-menu'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { useToast } from '@/shared/ui/toast'
import {
  isWorkflowStage,
  planNodes,
  WORK_ITEM_NODE_LIMIT,
  type PlanningKind,
} from '@/features/collaboration/model/work-item-plan'
import { projectQueryOptions } from '../api/queries'

type Project = ApiSuccessData<'/api/v1/projects/{projectId}', 'get'>
type TemplateUpdate = NonNullable<ApiBody<'/api/v1/projects/{projectId}/update', 'post'>['workItemTemplate']>
type WorkItemTemplate = TemplateUpdate['nodes']
type TemplateDraft = { nodes: WorkItemTemplate; version: number }

/**
 * 编辑项目内需求和 Bug 的默认流程。每次保存只更新选中的模板。
 * @param props 项目详情与当前用户是否只有读取权限。
 * @returns 节点名称和顺序的模板编辑区，版本冲突时保留草稿。
 */
export function ProjectWorkItemTemplates({ project, readOnly }: { project: Project; readOnly: boolean }) {
  const [kind, setKind] = useState<PlanningKind>('requirement')
  const [drafts, setDrafts] = useState<Partial<Record<PlanningKind, TemplateDraft>>>({})
  const [newNodeId, setNewNodeId] = useState('')
  const newNodeInput = useRef<HTMLInputElement>(null)
  const client = useQueryClient()
  const { showToast } = useToast()
  const projectKey = projectQueryOptions(project.id).queryKey
  const saved = project.workItemTemplates?.[kind] ?? planNodes(kind).map(({ id, title }) => ({ id, title }))
  const draft = drafts[kind]
  const nodes = draft?.nodes ?? saved
  const hasConflict = draft !== undefined && draft.version !== project.version
  const mutation = useMutation({
    mutationFn: ({ kind, nodes, version }: TemplateDraft & { kind: PlanningKind }) =>
      apiClient.updateProject(project.id, { version, workItemTemplate: { kind, nodes } }),
    onSuccess: async (result, { kind: savedKind, version }) => {
      await client.cancelQueries({ queryKey: projectKey })
      client.setQueryData(projectKey, result)
      setDrafts((current) => {
        const other = savedKind === 'requirement' ? 'bug' : 'requirement'
        const otherDraft = current[other]
        if (!otherDraft) return {}
        return {
          [other]: otherDraft.version === version ? { ...otherDraft, version: result.data.version } : otherDraft,
        }
      })
      showToast('流程模板已保存。', 'success')
      await client.invalidateQueries({ queryKey: ['projects', 'list', project.teamId] })
    },
    onError: async (cause) => {
      if (isBusinessError(cause) && cause.serverCode === 'VERSION_CONFLICT') {
        await client.invalidateQueries({ queryKey: projectKey })
      }
    },
  })
  useEffect(() => {
    if (newNodeId) newNodeInput.current?.focus()
  }, [newNodeId])

  const changeNodes = (next: WorkItemTemplate) => {
    setDrafts((current) => ({
      ...current,
      [kind]: { nodes: next, version: current[kind]?.version ?? project.version },
    }))
  }
  const move = (index: number, direction: -1 | 1) => {
    const node = nodes[index]
    if (!node) return
    const reordered = [...nodes]
    reordered.splice(index, 1)
    reordered.splice(index + direction, 0, node)
    changeNodes(reordered)
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!draft || readOnly || hasConflict || mutation.isPending || nodes.some(({ title }) => !title.trim())) return
    mutation.mutate({ ...draft, kind })
  }
  const discard = () => {
    setDrafts((current) => ({ ...current, [kind]: undefined }))
    mutation.reset()
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select
          aria-label="事项类型"
          value={kind}
          disabled={mutation.isPending}
          onChange={(event) => {
            setKind(event.target.value === 'bug' ? 'bug' : 'requirement')
            mutation.reset()
          }}
          className="w-auto"
        >
          <option value="requirement">需求模板</option>
          <option value="bug">Bug 模板</option>
        </Select>
        {!readOnly && (
          <Button
            type="button"
            variant="outline"
            className="work-item-template-step"
            disabled={nodes.length >= WORK_ITEM_NODE_LIMIT || mutation.isPending}
            onClick={() => {
              const id = crypto.randomUUID()
              changeNodes([...nodes, { id, title: '' }])
              setNewNodeId(id)
            }}
          >
            <Plus aria-hidden="true" />
            新增节点
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        新建事项使用当前模板。默认节点可改名，自定义节点可调整位置或移除。
      </p>
      <ol className="divide-y divide-border rounded-lg border border-border" aria-label="模板节点顺序">
        {nodes.map((node, index) => {
          const builtIn = isWorkflowStage(kind, node.id)
          const label = node.title || '新节点'
          return (
            <li key={node.id} className="flex items-center gap-2 px-2 py-1.5">
              {readOnly ? (
                <span className="min-w-0 text-sm wrap-anywhere">{node.title}</span>
              ) : (
                <Input
                  ref={newNodeId === node.id ? newNodeInput : undefined}
                  aria-label={'节点 ' + (index + 1) + ' 名称'}
                  value={node.title}
                  placeholder="节点名称"
                  required
                  maxLength={120}
                  disabled={mutation.isPending}
                  className="work-item-template-step min-w-0 flex-1"
                  onChange={(event) =>
                    changeNodes(
                      nodes.map((entry) => (entry.id === node.id ? { ...entry, title: event.target.value } : entry)),
                    )
                  }
                />
              )}
              {!readOnly && !builtIn && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="work-item-icon-button min-w-12! px-0!"
                      aria-label={label + ' 节点操作'}
                      disabled={mutation.isPending}
                    >
                      <Ellipsis aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={index === 0} onSelect={() => move(index, -1)}>
                      前移
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={index === nodes.length - 1} onSelect={() => move(index, 1)}>
                      后移
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => changeNodes(nodes.filter((entry) => entry.id !== node.id))}
                    >
                      移除节点
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          )
        })}
      </ol>
      {readOnly && <p className="text-sm text-muted-foreground">当前权限仅可查看模板。</p>}
      {(hasConflict || mutation.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {hasConflict
            ? '项目设置已更新。载入最新模板后可以继续编辑。'
            : describeRequestError(mutation.error).description}
        </p>
      )}
      {!readOnly && (
        <div className="form-actions">
          {draft && (
            <Button type="button" variant="outline" onClick={discard} disabled={mutation.isPending}>
              {hasConflict ? '放弃草稿并载入' : '撤销编辑'}
            </Button>
          )}
          <Button
            type="submit"
            disabled={!draft || hasConflict || mutation.isPending || nodes.some(({ title }) => !title.trim())}
          >
            {mutation.isPending ? '保存中…' : '保存模板'}
          </Button>
        </div>
      )}
    </form>
  )
}
