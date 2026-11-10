import type { ApiSuccessData } from '@dev-ops/api-client'
import { Tag } from '@/shared/ui/tag'
import { Button } from '@/shared/ui/controls/button'

type CodeReference = ApiSuccessData<'/api/v1/requirements/{requirementId}', 'get'>['linkedCodeReferences'][number]

/** 事项代码引用卡片；刷新失败由父级提示。 */
export function CodeReferenceCard({
  reference,
  onRefresh,
  refreshing,
}: {
  reference: CodeReference
  onRefresh: () => void
  refreshing?: boolean
}) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
      <a className="truncate text-primary hover:underline" href={reference.url ?? '#'} target="_blank" rel="noreferrer">
        {reference.title || reference.remoteId}
      </a>
      <div className="flex items-center gap-2">
        <Tag variant={reference.lastCheckStatus === 'ok' ? 'green' : 'red'}>{reference.lastCheckStatus}</Tag>
        <Button size="xs" variant="ghost" onClick={onRefresh} disabled={refreshing}>
          刷新
        </Button>
      </div>
    </li>
  )
}
