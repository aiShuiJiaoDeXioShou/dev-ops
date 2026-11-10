import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import { Button } from '@/shared/ui/controls/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import { formatDateTime } from '@/shared/lib/format'
import { canWriteKnowledge, knowledgeMutations } from '../api/mutations'
import { templateActivitiesQueryOptions, templateQueryOptions, templateVersionsQueryOptions } from '../api/queries'
import { copyText, downloadTextFile } from '../lib/files'
import { ActivityTimeline } from './activity-timeline'
import { ProjectSelector } from './project-selector'
import { TemplateForm } from './template-form'
import { VersionHistory } from './version-history'

/** 模板详情：全文预览、复制下载、副本、选用与历史。 */
export function TemplateDetailPane({
  teamId,
  templateId,
  onClose,
}: {
  teamId: string
  templateId: string
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
  if (query.isPending) return <PageLoading message="模板加载中…" />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <PageError
        title="模板加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void query.refetch()}
      />
    )
  }
  const template = query.data.data
  const copy = async () => {
    const copied = await copyText(template.content)
    showToast(copied ? '已复制模板正文' : '浏览器未允许自动复制，请手动选择内容。', copied ? 'success' : 'info')
  }
  const copyLink = async () => {
    try {
      const result = await knowledgeMutations.createSnapshotLink(template.id)
      const url = `${window.location.origin}/capabilities/snapshots/${result.data.token}`
      const copied = await copyText(url)
      showToast(copied ? '已复制快照预览链接' : '复制失败，请手动复制链接。', copied ? 'success' : 'info')
    } catch (cause: unknown) {
      showToast(describeRequestError(cause).description, 'error')
    }
  }
  return (
    <aside className="details" aria-label="模板详情">
      <div className="detail-scroll space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Tag>{template.tag}</Tag>
              <span className="text-xs text-muted-foreground">v{template.contentVersion}</span>
            </div>
            <h2 className="mt-2 text-lg font-semibold">{template.name}</h2>
            {template.description && <p className="text-sm text-muted-foreground">{template.description}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </header>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            复制内容
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadTextFile('AGENTS.md', template.content)}>
            下载 AGENTS.md
          </Button>
          {canWrite && (
            <>
              <Button variant="outline" size="sm" onClick={() => void copyLink()}>
                复制预览链接
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                编辑
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDuplicateOpen(true)}>
                创建副本
              </Button>
            </>
          )}
        </div>
        <Tabs defaultValue="content">
          <TabsList className="bg-secondary">
            <TabsTrigger value="content">全文</TabsTrigger>
            <TabsTrigger value="versions">版本</TabsTrigger>
            <TabsTrigger value="activities">活动</TabsTrigger>
          </TabsList>
          <TabsContent value="content">
            <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-secondary p-3 text-xs leading-6 whitespace-pre-wrap">
              {template.content}
            </pre>
          </TabsContent>
          <TabsContent value="versions">
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
          </TabsContent>
          <TabsContent value="activities">
            <ActivityTimeline items={activities.data?.data.items ?? []} />
          </TabsContent>
        </Tabs>
        <ProjectSelector teamId={teamId} templateId={templateId} />
        <p className="text-xs text-muted-foreground">最近更新 {formatDateTime(template.updatedAt)}</p>
        {editOpen && <TemplateForm teamId={teamId} open={editOpen} onOpenChange={setEditOpen} template={template} />}
        {duplicateOpen && (
          <TemplateForm
            teamId={teamId}
            open={duplicateOpen}
            onOpenChange={setDuplicateOpen}
            template={template}
            duplicate
          />
        )}
      </div>
    </aside>
  )
}
