import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { projectListQueryOptions } from '@/features/projects/public'
import { canWriteKnowledge, knowledgeMutations } from '../api/mutations'
import { useSession } from '@/features/identity/public'
import { projectAgentTemplateQueryOptions } from '../api/queries'
import { Button } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import { useToast } from '@/shared/ui/toast'

/**
 * 为当前模板选择目标项目并选用/切换/取消选用。
 * @param props.teamId 当前团队标识。
 * @param props.templateId 当前模板标识。
 */
export function ProjectSelector({ teamId, templateId }: { teamId: string; templateId: string }) {
  const { role } = useSession()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const projects = useQuery(projectListQueryOptions(teamId, { page: 1, pageSize: 100 }))
  const [projectId, setProjectId] = useState('')
  const activeProjectId = projectId || projects.data?.data.items[0]?.id || ''
  const selection = useQuery({
    ...projectAgentTemplateQueryOptions(activeProjectId),
    enabled: Boolean(activeProjectId),
  })
  const canWrite = canWriteKnowledge(role)
  const current = selection.data?.data
  const isSelected = current?.selection?.templateId === templateId
  const mutate = useMutation({
    mutationFn: async (action: 'apply' | 'clear') => {
      if (action === 'clear') {
        return knowledgeMutations.clearProjectTemplate(activeProjectId, { version: current?.version ?? 1 })
      }
      return knowledgeMutations.applyProjectTemplate(activeProjectId, {
        templateId,
        version: current?.version ?? 0,
      })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge', 'project-template'] })
      showToast('项目模板选用已更新', 'success')
    },
    onError: (cause: unknown) => showToast(describeRequestError(cause).description, 'error'),
  })
  if (!canWrite) {
    return (
      <p className="text-xs text-muted-foreground">
        {current?.selection ? `当前项目选用：${current.selection.templateName}` : '当前项目未选用模板'}
      </p>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-medium">项目协作约定</p>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          className="w-56"
          aria-label="目标项目"
          value={activeProjectId}
          onChange={(event) => setProjectId(event.target.value)}
        >
          {(projects.data?.data.items ?? []).map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </Select>
        <Button disabled={!activeProjectId || mutate.isPending || isSelected} onClick={() => mutate.mutate('apply')}>
          {isSelected ? '项目已选用' : '应用到项目'}
        </Button>
        {current?.selection && (
          <Button variant="outline" disabled={mutate.isPending} onClick={() => mutate.mutate('clear')}>
            取消选用
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {current?.selection
          ? `当前选用：${current.selection.templateName} v${current.selection.contentVersion}`
          : '当前项目未选用模板'}
      </p>
      <p className="text-xs text-muted-foreground">只建立平台内协作约定，不写入远端仓库。</p>
    </div>
  )
}
