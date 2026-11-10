import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Tag } from '@/shared/ui/tag'
import { projectAgentTemplateQueryOptions } from '../api/queries'

/**
 * 项目工作区展示当前选用的 AGENTS.md 模板；只读。
 * @param props.projectId 项目标识。
 */
export function AgentTemplateBadge({ projectId }: { projectId: string }) {
  const query = useQuery(projectAgentTemplateQueryOptions(projectId))
  const selection = query.data?.data.selection
  return (
    <Link
      to="/capabilities/templates"
      className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground"
      aria-label="查看项目的协作约定模板"
    >
      <Tag>协作约定</Tag>
      {selection ? (
        <span>
          {selection.templateName} · v{selection.contentVersion}
        </span>
      ) : (
        <span>未选用</span>
      )}
    </Link>
  )
}
