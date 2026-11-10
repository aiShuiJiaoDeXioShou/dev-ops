import { Download } from 'lucide-react'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { EmptyState, PageError, PageLoading } from '@/shared/ui/page-state'
import { formatBytes } from '../lib/format'
import { artifactStatusLabel, artifactStatusTone } from '../lib/status'
import type { PipelineRunArtifact } from '../model/types'
import { StatusLabel } from './status-label'

interface ArtifactListProps {
  /** 运行产物元数据。 */
  artifacts: PipelineRunArtifact[]
  /** 是否正在加载产物列表。 */
  isPending: boolean
  /** 加载失败说明；非空时展示错误与重试。 */
  errorDescription: string | null
  /** 请求标识，便于排障。 */
  requestId: string | null
  /** 重试产物查询。 */
  onRetry: () => void
  /** 当前用户是否可下载；服务端仍会再次鉴权。 */
  canDownload: boolean
}

/**
 * 运行产物列表。
 *
 * 下载使用服务端签发的受控地址（文件传输例外，不走 JSON 客户端）；
 * 不可下载的产物禁用操作并说明原因，不生成公开链接。
 * @param props 产物数据、加载状态与下载权限。
 * @returns 产物表格；无产物、加载中与失败分别展示对应状态。
 */
export function ArtifactList({
  artifacts,
  isPending,
  errorDescription,
  requestId,
  onRetry,
  canDownload,
}: ArtifactListProps) {
  return (
    <section aria-label="运行产物" className="space-y-3">
      <div className="section-heading">
        <h2>运行产物</h2>
        <span className="counter">{artifacts.length}</span>
      </div>
      {isPending ? (
        <DelayedLoading pending>
          <PageLoading message="产物加载中…" />
        </DelayedLoading>
      ) : errorDescription !== null ? (
        <PageError title="产物加载失败" description={errorDescription} requestId={requestId} onRetry={onRetry} />
      ) : artifacts.length === 0 ? (
        <EmptyState
          icon={<Download />}
          title="本次运行没有产物"
          description="workflow 使用 builtin:upload-artifact 成功收集文件后，产物会显示在这里。"
        />
      ) : (
        <div className="table-wrap">
          <Table aria-label="运行产物列表">
            <TableHeader>
              <TableRow>
                <TableHead>产物</TableHead>
                <TableHead>所属步骤</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>SHA-256</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {artifacts.map((artifact) => (
                <TableRow key={artifact.artifactId}>
                  <TableCell>
                    <strong>{artifact.name}</strong>
                  </TableCell>
                  <TableCell>第 {artifact.stepIndex + 1} 步</TableCell>
                  <TableCell>{formatBytes(artifact.sizeBytes)}</TableCell>
                  <TableCell>
                    <span className="mono" title={artifact.sha256}>
                      {artifact.sha256.slice(0, 12)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusLabel tone={artifactStatusTone(artifact.status)}>
                      {artifactStatusLabel(artifact.status)}
                    </StatusLabel>
                  </TableCell>
                  <TableCell>{formatDateTime(artifact.createdAt)}</TableCell>
                  <TableCell>
                    {artifact.status === 'available' && artifact.downloadUrl && canDownload ? (
                      <Button asChild variant="outline" size="sm">
                        <a href={artifact.downloadUrl} download={artifact.name}>
                          下载
                        </a>
                      </Button>
                    ) : (
                      <span className="small muted">{canDownload ? '暂不可下载' : '当前角色不可下载'}</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
