import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, PackageOpen, Pencil, Power } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { useSession } from '@/features/identity/public'
import { DelayedLoading } from '@/shared/ui/delayed-loading'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { PageError, PageLoading } from '@/shared/ui/page-state'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import { formatDateTime } from '@/shared/lib/format'
import { canWriteKnowledge } from '../api/mutations'
import { skillActivitiesQueryOptions, skillQueryOptions, skillVersionsQueryOptions } from '../api/queries'
import {
  base64ToBytes,
  blobFromBytes,
  createSkillPackageZip,
  downloadBlob,
  formatFileSize,
  generateSkillMarkdown,
  skillFileSize,
} from '../lib/skill-package'
import { copyText, downloadTextFile } from '../lib/files'
import { SKILL_CATEGORY_LABELS } from '../model/labels'
import type { SkillDetail } from '../model/types'
import { ActivityTimeline } from './activity-timeline'
import { SkillForm } from './skill-form'
import { VersionHistory } from './version-history'

/**
 * 技能详情弹窗：对齐原型详情对话框，展示 SKILL.md、资源文件、操作与历史。
 * @param props.teamId 团队标识。
 * @param props.skillId 技能标识。
 * @param props.onClose 关闭回调。
 */
export function SkillDetailDialog({
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

  const skill = query.data?.data
  const copyMarkdown = async () => {
    if (!skill) return
    const copied = await copyText(generateSkillMarkdown(skill.identifier, skill.summary, skill.content))
    showToast(copied ? '已复制 SKILL.md' : '浏览器未允许自动复制，请手动选择内容。', copied ? 'success' : 'info')
  }
  const downloadMarkdown = () => {
    if (!skill) return
    downloadTextFile('SKILL.md', generateSkillMarkdown(skill.identifier, skill.summary, skill.content))
  }
  const downloadPackage = () => {
    if (!skill) return
    downloadBlob(
      `${skill.identifier}.zip`,
      createSkillPackageZip(
        { identifier: skill.identifier, summary: skill.summary, content: skill.content },
        skill.files,
      ),
    )
    showToast('已开始下载技能包', 'success')
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="knowledge-dialog">
        {query.isPending ? (
          <DelayedLoading pending>
            <PageLoading message="技能加载中…" />
          </DelayedLoading>
        ) : query.isError || !skill ? (
          <PageError
            title="技能加载失败"
            description={describeRequestError(query.error).description}
            requestId={describeRequestError(query.error).requestId}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{skill.name}</DialogTitle>
            </DialogHeader>
            <div className="row spread">
              <div className="row">
                <Tag>{SKILL_CATEGORY_LABELS[skill.category]}</Tag>
                <span className="text-xs text-muted-foreground">v{skill.contentVersion}</span>
                <span className="text-xs text-muted-foreground">团队维护</span>
              </div>
              <Tag variant={skill.enabled ? 'green' : 'neutral'}>{skill.enabled ? '已启用' : '已停用'}</Tag>
            </div>
            <p className="skill-description">{skill.summary}</p>
            <div className="document-toolbar">
              <Button type="button" variant="outline" size="sm" onClick={() => void copyMarkdown()}>
                <Copy className="size-4" />
                复制 SKILL.md
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={downloadMarkdown}>
                <Download className="size-4" />
                下载 SKILL.md
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={downloadPackage}>
                <PackageOpen className="size-4" />
                下载技能包
              </Button>
            </div>
            <div className="file-head">
              <span>SKILL.md</span>
              <code>@skill/{skill.identifier}</code>
            </div>
            <pre className="skill-source">{skill.content}</pre>
            <section className="space-y-2">
              <div className="row spread">
                <h3 className="text-sm font-semibold">资源文件</h3>
                <span className="text-xs text-muted-foreground">
                  {skill.files.length} 个 ·{' '}
                  {formatFileSize(skill.files.reduce((total, file) => total + skillFileSize(file), 0))}
                </span>
              </div>
              {skill.files.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  这个技能只有 SKILL.md；可在编辑时添加 scripts、references 或 assets。
                </p>
              ) : (
                <ul className="space-y-2">
                  {skill.files.map((file) => (
                    <li key={file.path} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                      <code className="min-w-0 flex-1 truncate text-xs">{file.path}</code>
                      <span className="text-xs text-muted-foreground">{formatFileSize(file.sizeBytes)}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`下载 ${file.path}`}
                        onClick={() => {
                          if (file.encoding === 'base64') {
                            downloadBlob(
                              file.path.split('/').pop() ?? 'file',
                              blobFromBytes(base64ToBytes(file.content)),
                            )
                          } else {
                            downloadTextFile(file.path.split('/').pop() ?? 'file', file.content)
                          }
                        }}
                      >
                        <Download className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="row">
              {canWrite && (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                    <Pencil className="size-4" />
                    编辑
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={toggle.isPending}
                    onClick={() => toggle.mutate(skill)}
                  >
                    <Power className="size-4" />
                    {skill.enabled ? '停用' : '启用'}
                  </Button>
                </>
              )}
              <span className="flex-1" />
              <Button type="button" disabled title="Bot 协作上线后可用">
                在 bots 中使用
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">最近更新 {formatDateTime(skill.updatedAt)}</p>
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
                  loadContent={async (versionId) => (await apiClient.getSkillVersion(skillId, versionId)).data.content}
                />
                <ActivityTimeline items={activities.data?.data.items ?? []} />
              </div>
            </details>
          </>
        )}
        {editOpen && skill && <SkillForm teamId={teamId} open={editOpen} onOpenChange={setEditOpen} skill={skill} />}
      </DialogContent>
    </Dialog>
  )
}

/** 兼容旧命名，页面层统一使用详情弹窗。 */
export const SkillDetailPane = SkillDetailDialog
