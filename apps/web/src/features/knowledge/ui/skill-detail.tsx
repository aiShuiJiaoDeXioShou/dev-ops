import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Code2,
  Compass,
  Copy,
  Download,
  FileCode2,
  PackageOpen,
  Pencil,
  Power,
  Rocket,
  ShieldCheck,
} from 'lucide-react'
import { DirectConversationPicker } from '@/features/conversations/ui/direct-conversation-picker'
import { useSession } from '@/features/identity/model/session'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Markdown } from '@/shared/lib/markdown'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/shared/ui/controls/alert-dialog'
import { Button } from '@/shared/ui/controls/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'
import { WorkItemDetailSheet } from '@/shared/ui/controls/work-item-detail-sheet'
import { DetailSheetSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { Tag } from '@/shared/ui/tag'
import { useToast } from '@/shared/ui/toast'
import { canWriteKnowledge } from '../api/mutations'
import { skillActivitiesQueryOptions, skillQueryOptions, skillVersionsQueryOptions } from '../api/queries'
import { copyText, downloadTextFile } from '../lib/files'
import {
  base64ToBytes,
  blobFromBytes,
  createSkillPackageZip,
  downloadBlob,
  formatFileSize,
  generateSkillMarkdown,
  skillFileSize,
} from '../lib/skill-package'
import { SKILL_CATEGORY_LABELS } from '../model/labels'
import type { SkillDetail, SkillFile, SkillListItem } from '../model/types'
import { ActivityTimeline } from './activity-timeline'
import { SkillEditorFields } from './skill-form'
import { VersionHistory } from './version-history'

/** 按技能分类渲染语义图标。 */
function SkillCategoryGlyph({ category }: { category: SkillListItem['category'] }) {
  const Icon = category === 'engineering' ? Code2 : category === 'delivery' ? Rocket : Compass
  return (
    <span className={cn('skill-hub-glyph', `is-${category}`)} aria-hidden="true">
      <Icon className="size-4" />
    </span>
  )
}

/** 下载单个技能资源文件。 */
function downloadSingleFile(file: SkillFile) {
  const name = file.path.split('/').pop() ?? 'file'
  if (file.encoding === 'base64') {
    downloadBlob(name, blobFromBytes(base64ToBytes(file.content)))
  } else {
    downloadTextFile(name, file.content)
  }
}

/**
 * 技能详情抽屉：统一呈现平台内置与团队技能，支持 SKILL.md 渲染/源码切换、文件树在线预览、版本历史与同抽屉内联编辑。
 * @param props.teamId 团队标识。
 * @param props.skillId 技能标识。
 * @param props.platformSkill 平台内置技能列表项；传入时直接渲染只读内置视图，不发详情请求。
 * @param props.onClose 关闭抽屉回调。
 */
export function SkillDetailDrawer({
  teamId,
  skillId,
  platformSkill,
  onClose,
}: {
  teamId: string
  skillId: string
  platformSkill?: SkillListItem
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { role } = useSession()
  const { showToast } = useToast()
  const isPlatform = Boolean(platformSkill)
  const query = useQuery({ ...skillQueryOptions(skillId), enabled: Boolean(skillId) && !isPlatform })
  const versions = useQuery({ ...skillVersionsQueryOptions(skillId), enabled: Boolean(skillId) && !isPlatform })
  const activities = useQuery({ ...skillActivitiesQueryOptions(skillId), enabled: Boolean(skillId) && !isPlatform })

  const [editing, setEditing] = useState(false)
  const [docMode, setDocMode] = useState<'rendered' | 'raw'>('rendered')
  const [activeTab, setActiveTab] = useState('doc')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [copiedCmd, setCopiedCmd] = useState(false)
  const [botPickerOpen, setBotPickerOpen] = useState(false)
  const useInBotButtonRef = useRef<HTMLButtonElement>(null)
  const canWrite = canWriteKnowledge(role)

  const teamSkill = query.data?.data
  const displaySkill = platformSkill ?? teamSkill
  const files = teamSkill?.files ?? []
  const selectedFile = files.find((item) => item.path === selectedFilePath) ?? files[0]

  useEffect(() => {
    setEditing(false)
    setActiveTab('doc')
    setDocMode('rendered')
    setSelectedFilePath(null)
  }, [skillId])

  const toggle = useMutation({
    mutationFn: async (skill: SkillDetail) =>
      skill.enabled
        ? apiClient.disableSkill(skill.id, { version: skill.version })
        : apiClient.enableSkill(skill.id, { version: skill.version }),
    onSuccess: async (response) => {
      await queryClient.invalidateQueries({ queryKey: ['knowledge', 'skills'] })
      showToast(response.data.enabled ? '技能已启用' : '技能已停用', 'success')
    },
    onError: (cause: unknown) => showToast(describeRequestError(cause).description, 'error'),
  })

  const copyCommand = async (identifier: string) => {
    const command = `@skill/${identifier}`
    const ok = await copyText(command)
    if (ok) {
      setCopiedCmd(true)
      window.setTimeout(() => setCopiedCmd(false), 1400)
    }
    showToast(ok ? `已复制 ${command}` : '浏览器未允许自动复制，请手动选择内容。', ok ? 'success' : 'info')
  }

  const copyMarkdown = async () => {
    if (!displaySkill) return
    const raw = generateSkillMarkdown(displaySkill.identifier, displaySkill.summary, displaySkill.content ?? '')
    const ok = await copyText(raw)
    showToast(ok ? '已复制 SKILL.md' : '浏览器未允许自动复制，请手动选择内容。', ok ? 'success' : 'info')
  }

  const downloadMarkdown = () => {
    if (!displaySkill) return
    downloadTextFile(
      'SKILL.md',
      generateSkillMarkdown(displaySkill.identifier, displaySkill.summary, displaySkill.content ?? ''),
    )
  }

  const downloadPackage = () => {
    if (!teamSkill) return
    downloadBlob(
      `${teamSkill.identifier}.zip`,
      createSkillPackageZip(
        { identifier: teamSkill.identifier, summary: teamSkill.summary, content: teamSkill.content },
        teamSkill.files,
      ),
    )
    showToast('已开始下载技能包', 'success')
  }

  const copyFileContent = async (file: SkillFile) => {
    const ok = await copyText(file.content)
    showToast(ok ? `已复制 ${file.path}` : '浏览器未允许自动复制，请手动选择内容。', ok ? 'success' : 'info')
  }

  const heading = displaySkill ? (
    <div className="skill-detail-header">
      <div className="skill-detail-identity">
        <SkillCategoryGlyph category={displaySkill.category} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="skill-hub-title-line">
            <h2 className="m-0 text-base font-semibold text-foreground">{displaySkill.name}</h2>
            <Tag variant={isPlatform ? 'blue' : 'neutral'}>{isPlatform ? '平台内置' : '团队维护'}</Tag>
            <Tag>{SKILL_CATEGORY_LABELS[displaySkill.category]}</Tag>
            <span className="font-mono text-xs text-muted-foreground">v{displaySkill.contentVersion}</span>
            <Tag variant={displaySkill.enabled ? 'green' : 'neutral'}>{displaySkill.enabled ? '已启用' : '已停用'}</Tag>
            {displaySkill.conflictsWithPlatform && <Tag variant="red">与平台同名</Tag>}
          </div>
          <p className="m-0 text-sm text-muted-foreground">{displaySkill.summary}</p>
        </div>
      </div>

      {!editing && (
        <div className="skill-detail-actions">
          {!isPlatform && canWrite && teamSkill && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" aria-hidden="true" />
                编辑
              </Button>
              {teamSkill.enabled ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" size="sm" disabled={toggle.isPending}>
                      <Power className="size-3.5" aria-hidden="true" />
                      停用
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>停用技能「{teamSkill.name}」？</AlertDialogTitle>
                      <AlertDialogDescription>
                        停用后，已绑定此技能的智能体在新运行中将不再加载该技能；你可以随时重新启用。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction onClick={() => toggle.mutate(teamSkill)}>确认停用</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(teamSkill)}
                >
                  <Power className="size-3.5" aria-hidden="true" />
                  启用
                </Button>
              )}
            </>
          )}
          {!isPlatform && canWrite && teamSkill?.enabled && (
            <Button ref={useInBotButtonRef} type="button" size="sm" onClick={() => setBotPickerOpen(true)}>
              在 Bots 中使用
            </Button>
          )}
        </div>
      )}
    </div>
  ) : undefined

  return (
    <>
      <WorkItemDetailSheet label={editing ? '编辑技能' : '技能详情'} heading={heading} onClose={onClose}>
        {!isPlatform && query.isPending ? (
          <DetailSheetSkeleton propertyRows={3} label="技能详情加载中" />
        ) : !isPlatform && (query.isError || !teamSkill) ? (
          <PageError
            title="技能加载失败"
            description={describeRequestError(query.error).description}
            requestId={describeRequestError(query.error).requestId}
            onRetry={() => void query.refetch()}
          />
        ) : displaySkill && editing && teamSkill ? (
          <SkillEditorFields
            teamId={teamId}
            skill={teamSkill}
            onCancel={() => setEditing(false)}
            onSaved={() => setEditing(false)}
          />
        ) : (
          displaySkill && (
            <div className="space-y-5">
              {displaySkill.conflictsWithPlatform && (
                <p className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
                  此团队技能与平台内置 Skill 同名，运行时将优先使用平台内置版本。
                </p>
              )}
              {isPlatform && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
                  <ShieldCheck className="size-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>平台内置只读技能默认对所有团队智能体可用，在会话中输入下方调用指令即可引用。</span>
                </div>
              )}

              <div className="skill-install-bar">
                <div className="skill-install-cmd">
                  <span className="text-xs text-muted-foreground">调用指令</span>
                  <code>@skill/{displaySkill.identifier}</code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => void copyCommand(displaySkill.identifier)}
                  >
                    {copiedCmd ? (
                      <Check className="size-3.5" aria-hidden="true" />
                    ) : (
                      <Copy className="size-3.5" aria-hidden="true" />
                    )}
                    {copiedCmd ? '已复制' : '复制'}
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => void copyMarkdown()}>
                    <Copy className="size-3.5" aria-hidden="true" />
                    复制 SKILL.md
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={downloadMarkdown}>
                    <Download className="size-3.5" aria-hidden="true" />
                    下载 SKILL.md
                  </Button>
                  {!isPlatform && (
                    <Button type="button" variant="outline" size="sm" onClick={downloadPackage}>
                      <PackageOpen className="size-3.5" aria-hidden="true" />
                      下载技能包
                    </Button>
                  )}
                </div>
              </div>

              <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2">
                  <TabsList className="h-auto gap-4 rounded-none bg-transparent p-0">
                    <TabsTrigger variant="underline" value="doc">
                      SKILL.md 文档
                    </TabsTrigger>
                    {!isPlatform && (
                      <TabsTrigger variant="underline" value="files">
                        资源文件（{files.length}）
                      </TabsTrigger>
                    )}
                    {!isPlatform && (
                      <TabsTrigger variant="underline" value="history">
                        版本与动态
                      </TabsTrigger>
                    )}
                  </TabsList>
                  {activeTab === 'doc' && (
                    <div className="cap-hub-pills" role="group" aria-label="文档查看方式">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn('cap-hub-pill', docMode === 'rendered' && 'active')}
                        aria-pressed={docMode === 'rendered'}
                        onClick={() => setDocMode('rendered')}
                      >
                        预览
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={cn('cap-hub-pill', docMode === 'raw' && 'active')}
                        aria-pressed={docMode === 'raw'}
                        onClick={() => setDocMode('raw')}
                      >
                        源码
                      </Button>
                    </div>
                  )}
                </div>

                <TabsContent value="doc" className="mt-0">
                  {docMode === 'rendered' ? (
                    <div className="skill-md-preview">
                      <Markdown>{displaySkill.content ?? ''}</Markdown>
                    </div>
                  ) : (
                    <pre className="skill-source-pre font-mono">
                      {generateSkillMarkdown(displaySkill.identifier, displaySkill.summary, displaySkill.content ?? '')}
                    </pre>
                  )}
                </TabsContent>

                {!isPlatform && (
                  <TabsContent value="files" className="mt-0 space-y-3">
                    {files.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        这个技能目前只包含 SKILL.md；可在编辑时添加 scripts、references 或 assets 资源文件。
                      </div>
                    ) : (
                      <div className="skill-file-browser">
                        <div className="skill-file-tree" role="list" aria-label="技能资源文件">
                          {files.map((file) => {
                            const isActive = selectedFile?.path === file.path
                            return (
                              <div
                                key={file.path}
                                role="listitem"
                                className={cn('skill-file-tree-row', isActive && 'is-active')}
                              >
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="skill-file-tree-btn"
                                  onClick={() => setSelectedFilePath(file.path)}
                                >
                                  <FileCode2 className="size-3.5 shrink-0" aria-hidden="true" />
                                  <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                                </Button>
                                <span className="shrink-0 pr-1 text-xs text-muted-foreground">
                                  {formatFileSize(skillFileSize(file))}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                        {selectedFile && (
                          <div className="skill-file-preview">
                            <div className="skill-file-preview-head">
                              <code className="min-w-0 truncate text-xs font-medium">{selectedFile.path}</code>
                              <div className="flex shrink-0 items-center gap-1.5">
                                {selectedFile.encoding === 'utf8' && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void copyFileContent(selectedFile)}
                                  >
                                    <Copy className="size-3.5" aria-hidden="true" />
                                    复制
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  aria-label={`下载 ${selectedFile.path}`}
                                  onClick={() => downloadSingleFile(selectedFile)}
                                >
                                  <Download className="size-3.5" aria-hidden="true" />
                                  下载
                                </Button>
                              </div>
                            </div>
                            <pre className="skill-file-preview-body font-mono">
                              {selectedFile.encoding === 'utf8'
                                ? selectedFile.content
                                : `二进制文件（${formatFileSize(selectedFile.sizeBytes)}），请点击右上角下载查看。`}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </TabsContent>
                )}

                {!isPlatform && (
                  <TabsContent value="history" className="mt-0 space-y-6">
                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold">内容版本</h3>
                      <VersionHistory
                        items={(versions.data?.data.items ?? []).map((item) => ({
                          id: item.id,
                          label: `v${item.contentVersion}`,
                          createdAt: item.createdAt,
                          createdByUserId: item.createdByUserId,
                        }))}
                        loadContent={async (versionId) =>
                          (await apiClient.getSkillVersion(skillId, versionId)).data.content
                        }
                      />
                    </section>
                    <section className="space-y-3">
                      <h3 className="text-sm font-semibold">变更活动</h3>
                      <ActivityTimeline items={activities.data?.data.items ?? []} />
                    </section>
                  </TabsContent>
                )}
              </Tabs>

              {!isPlatform && teamSkill && (
                <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                  最近更新 {formatDateTime(teamSkill.updatedAt)} · 共 {files.length} 个资源文件（
                  {formatFileSize(files.reduce((total, file) => total + skillFileSize(file), 0))}）
                </p>
              )}
            </div>
          )
        )}
      </WorkItemDetailSheet>

      {botPickerOpen && canWrite && teamSkill?.enabled && (
        <DirectConversationPicker
          teamId={teamId}
          skill={teamSkill}
          onClose={() => setBotPickerOpen(false)}
          onRestoreFocus={() => useInBotButtonRef.current?.focus()}
        />
      )}
    </>
  )
}

/** 兼容旧命名，统一使用右侧详情抽屉。 */
export const SkillDetailDialog = SkillDetailDrawer
/** 兼容旧命名，统一使用右侧详情抽屉。 */
export const SkillDetailPane = SkillDetailDrawer
