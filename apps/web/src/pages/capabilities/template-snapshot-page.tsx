import { useEffect } from 'react'
import { useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { describeRequestError } from '@/shared/api/errors'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { Button } from '@/shared/ui/controls/button'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import { copyText, downloadTextFile, templateSnapshotQueryOptions } from '@/features/knowledge/public'

/** 模板快照只读预览页；不进入能力页签，链接仍要求登录与团队权限。 */
export function Component() {
  const { token = '' } = useParams()
  const { showToast } = useToast()
  const query = useQuery(templateSnapshotQueryOptions(token))
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'
    meta.content = 'no-referrer'
    document.head.appendChild(meta)
    return () => {
      meta.remove()
    }
  }, [])
  if (query.isPending)
    return (
      <DelayedLoading pending>
        <PageLoading message="快照加载中…" />
      </DelayedLoading>
    )
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <PageError
        title="快照不可用"
        description={`${described.description} 链接可能已失效，或你不在该团队中。`}
        requestId={described.requestId}
        onRetry={() => void query.refetch()}
      />
    )
  }
  const snapshot = query.data.data
  const copy = async () => {
    const copied = await copyText(snapshot.content)
    showToast(copied ? '已复制快照内容' : '浏览器未允许自动复制，请手动选择内容。', copied ? 'success' : 'info')
  }
  return (
    <div className="content">
      <article className="space-y-4">
        <header className="space-y-2">
          <div className="flex items-center gap-2">
            <Tag>{snapshot.tag}</Tag>
            <span className="text-xs text-muted-foreground">v{snapshot.contentVersion} 快照</span>
          </div>
          <h2 className="text-lg font-semibold">{snapshot.templateName} · AGENTS.md</h2>
        </header>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            复制内容
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadTextFile('AGENTS.md', snapshot.content)}>
            下载 AGENTS.md
          </Button>
        </div>
        <pre className="overflow-auto rounded-lg border border-border bg-secondary p-4 text-xs leading-6 whitespace-pre-wrap">
          {snapshot.content}
        </pre>
        <p className="text-xs text-muted-foreground">分享时的版本快照，仅当前团队成员可访问；只读且不会自动过期。</p>
      </article>
    </div>
  )
}

export default Component
