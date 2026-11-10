import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import { Button } from '@/shared/ui/controls/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import { formatDateTime } from '@/shared/lib/format'
import { canWriteKnowledge } from '../api/mutations'
import { skillActivitiesQueryOptions, skillQueryOptions, skillVersionsQueryOptions } from '../api/queries'
import { copyText, downloadTextFile, skillMarkdown } from '../lib/files'
import { SKILL_CATEGORY_LABELS } from '../model/labels'
import type { SkillDetail } from '../model/types'
import { ActivityTimeline } from './activity-timeline'
import { SkillForm } from './skill-form'
import { VersionHistory } from './version-history'

/** 技能详情面板：正文、复制下载、启停与历史记录。 */
export function SkillDetailPane({
  teamId,
  skillId,
  onClose,
}: {
  teamId: string
  skillId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { role } = useSession()
  const { showToast } = useToast()
  const query = useQuery(skillQueryOptions(skillId))
  const versions = useQuery(skillVersionsQueryOptions(skillId))
  const activities = useQuery(skillActivitiesQueryOptions(skillId))
  const [editOpen, setEditOpen] = useState(false)
  const canWrite = canWriteKnowledge(role)
  const toggle = useMutation({
    mutationFn: async (skill: SkillDetail) =>
      skill.enabled
        ? apiClient.disableSkill(skill.id, { version: skill.version })
        : apiClient.enableSkill(skill.id, { version: skill.version }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge', 'skills'] })
    },
    onError: (cause: unknown) => showToast(describeRequestError(cause).description, 'error'),
  })
  if (query.isPending) return <PageLoading message="技能加载中…" />
  if (query.isError) {
    const described = describeRequestError(query.error)
    return (
      <PageError
        title="技能加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void query.refetch()}
      />
    )
  }
  const skill = query.data.data
  const copy = async () => {
    const copied = await copyText(skillMarkdown(skill.name, skill.content))
    showToast(copied ? '已复制 SKILL.md 内容' : '浏览器未允许自动复制，请手动选择内容。', copied ? 'success' : 'info')
  }
  return (
    <aside className="details" aria-label="技能详情">
      <div className="detail-scroll space-y-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Tag variant={skill.enabled ? 'green' : 'neutral'}>{skill.enabled ? '已启用' : '已停用'}</Tag>
              <Tag>{SKILL_CATEGORY_LABELS[skill.category]}</Tag>
              <span className="text-xs text-muted-foreground">v{skill.contentVersion}</span>
            </div>
            <h2 className="mt-2 text-lg font-semibold">{skill.name}</h2>
            <p className="text-xs text-muted-foreground">@skill/{skill.identifier}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </header>
        <p className="text-sm text-muted-foreground">{skill.summary}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            复制内容
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => downloadTextFile('SKILL.md', skillMarkdown(skill.name, skill.content))}
          >
            下载 SKILL.md
          </Button>
          {canWrite && (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                编辑
              </Button>
              <Button variant="outline" size="sm" disabled={toggle.isPending} onClick={() => toggle.mutate(skill)}>
                {skill.enabled ? '停用' : '启用'}
              </Button>
            </>
          )}
        </div>
        <Tabs defaultValue="content">
          <TabsList className="bg-secondary">
            <TabsTrigger value="content">指令</TabsTrigger>
            <TabsTrigger value="versions">版本</TabsTrigger>
            <TabsTrigger value="activities">活动</TabsTrigger>
          </TabsList>
          <TabsContent value="content">
            <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-secondary p-3 text-xs leading-6 whitespace-pre-wrap">
              {skill.content}
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
              loadContent={async (versionId) => (await apiClient.getSkillVersion(skillId, versionId)).data.content}
            />
          </TabsContent>
          <TabsContent value="activities">
            <ActivityTimeline items={activities.data?.data.items ?? []} />
          </TabsContent>
        </Tabs>
        <p className="text-xs text-muted-foreground">最近更新 {formatDateTime(skill.updatedAt)}</p>
        {editOpen && <SkillForm teamId={teamId} open={editOpen} onOpenChange={setEditOpen} skill={skill} />}
      </div>
    </aside>
  )
}
