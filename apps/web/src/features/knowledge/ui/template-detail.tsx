import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Download, Link2, Pencil, Plus } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import { formatDateTime } from '@/shared/lib/format'
import { canWriteKnowledge } from '../api/mutations'
import { templateActivitiesQueryOptions, templateQueryOptions, templateVersionsQueryOptions } from '../api/queries'
import { copyText, downloadTextFile } from '../lib/files'
import { ActivityTimeline } from './activity-timeline'
import { ProjectSelector } from './project-selector'
import { TemplateForm } from './template-form'
import { VersionHistory } from './version-history'

/**
 * 模板详情弹窗：对齐原型 AGENTS.md 详情对话框，包含预览、选用、复制与历史。
 * @param props.teamId 团队标识。
 * @param props.templateId 模板标识。
 * @param props.targetProjectId 从模板目录工具栏带入的目标项目。
 * @param props.onClose 关闭回调。
 */
export function TemplateDetailDialog({
  teamId,
  templateId,
  targetProjectId,
  onClose,
}: {
  teamId: string
  templateId: string
  targetProjectId?: string
  onClose: () => void
}) {
  const { role } = useSession()
  const { showToast } = useToast()
  const query = useQuery(templateQueryOptions(templateId))
  const versions = useQuery(templateVersionsQueryOptions(templateId))
  const activities = useQuery(templateActivitiesQueryOptions(templateId))
  const [editOpen, setEditOpen] = useState(false)
  const [duplicateOpen, setDuplicateOpen] = useState(false)
  const canWrite = canWriteKnowledge(role)

  const template = query.data?.data
  const copy = async () => {
    if (!template) return
    const copied = await copyText(template.content)
    showToast(copied ? '已复制模板正文' : '浏览器未允许自动复制，请手动选择内容。', copied ? 'success' : 'info')
  }
  const copyLink = async () => {
    if (!template) return
    try {
      const result = await apiClient.createTemplateSnapshotLink(template.id)
      const copied = await copyText(`${window.location.origin}/capabilities/snapshots/${result.data.token}`)
      showToast(copied ? '已复制快照预览链接' : '复制失败，请手动复制链接。', copied ? 'success' : 'info')
    } catch (cause: unknown) {
      showToast(describeRequestError(cause).description, 'error')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="knowledge-dialog">
        {query.isPending ? (
          <PageLoading message="模板加载中…" />
        ) : query.isError || !template ? (
          <PageError
            title="模板加载失败"
            description={describeRequestError(query.error).description}
            requestId={describeRequestError(query.error).requestId}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{template.name} · AGENTS.md</DialogTitle>
            </DialogHeader>
            <div className="row spread">
              <div className="row">
                <Tag>{template.tag}</Tag>
                <span className="text-xs text-muted-foreground">v{template.contentVersion}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(template.updatedAt)}</span>
              </div>
              {canWrite && (
                <div className="row">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil className="size-3.5" />
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => setDuplicateOpen(true)}
                  >
                    <Plus className="size-3.5" />
                    创建副本
                  </Button>
                </div>
              )}
            </div>
            {template.description && <p className="skill-description">{template.description}</p>}
            <div className="document-toolbar">
              <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
                <Copy className="size-4" />
                复制内容
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
                <Link2 className="size-4" />
                复制预览链接
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => downloadTextFile('AGENTS.md', template.content)}
              >
                <Download className="size-4" />
                下载 AGENTS.md
              </Button>
            </div>
            <pre className="skill-source">{template.content}</pre>
            <p className="text-xs text-muted-foreground">
              链接包含当前版本快照，仅可在能访问本机服务的环境打开，尚未发布到公网；模板选择不会覆盖远端仓库文件。
            </p>
            <ProjectSelector teamId={teamId} templateId={templateId} initialProjectId={targetProjectId} />
            <details className="space-y-3">
              <summary className="cursor-pointer text-sm font-medium">版本与变更</summary>
              <div className="mt-3 space-y-4">
                <VersionHistory
                  items={(versions.data?.data.items ?? []).map((item) => ({
                    id: item.id,
                    label: `v${item.contentVersion}`,
                    createdAt: item.createdAt,
                    createdByUserId: item.createdByUserId,
                  }))}
                  loadContent={async (versionId) =>
                    (await apiClient.getAgentTemplateVersion(templateId, versionId)).data.content
                  }
                />
                <ActivityTimeline items={activities.data?.data.items ?? []} />
              </div>
            </details>
          </>
        )}
        {editOpen && template && (
          <TemplateForm teamId={teamId} open={editOpen} onOpenChange={setEditOpen} template={template} />
        )}
        {duplicateOpen && template && (
          <TemplateForm
            teamId={teamId}
            open={duplicateOpen}
            onOpenChange={setDuplicateOpen}
            template={template}
            duplicate
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** 兼容旧命名，页面层统一使用详情弹窗。 */
export const TemplateDetailPane = TemplateDetailDialog
