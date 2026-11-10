import { useState } from 'react'
import { Button } from '@/shared/ui/controls/button'
import { formatDateTime } from '@/shared/lib/format'

/** 版本历史条目；技能与模板共用展示结构。 */
export interface VersionHistoryItem {
  id: string
  label: string
  createdAt: string
  createdByUserId: string
}

/**
 * 展示只读版本历史，按需加载某个历史版本正文。
 * @param props.items 版本条目。
 * @param props.loadContent 读取历史版本正文。
 * @param props.emptyText 无版本时的说明。
 */
export function VersionHistory({
  items,
  loadContent,
  emptyText = '暂无历史版本',
}: {
  items: VersionHistoryItem[]
  loadContent: (versionId: string) => Promise<string>
  emptyText?: string
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [error, setError] = useState('')
  const load = async (versionId: string) => {
    setLoadingId(versionId)
    setError('')
    try {
      setContent(await loadContent(versionId))
    } catch {
      setError('历史版本加载失败，请稍后重试。')
      setContent('')
    } finally {
      setLoadingId(null)
    }
  }
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>
  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(item.createdAt)} · {item.createdByUserId.slice(0, 8)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load(item.id)} disabled={loadingId === item.id}>
              {loadingId === item.id ? '加载中…' : '查看正文'}
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {content && (
        <pre className="max-h-72 overflow-auto rounded-lg border border-border bg-secondary p-3 text-xs leading-6 whitespace-pre-wrap">
          {content}
        </pre>
      )}
    </div>
  )
}
