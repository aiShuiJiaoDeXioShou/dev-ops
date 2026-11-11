import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { isNestedInteractiveTarget } from '@/shared/lib/clickable'
import { projectRepositoriesQueryOptions } from '@/features/code/public'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { FormField } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { LogSheet } from '@/shared/ui/log-sheet'
import { StatusBadge } from '@/shared/ui/status-badge'
import { formatDateTime } from '@/shared/lib/format'
import { codeChangesQueryOptions, toolCapabilitiesQueryOptions, toolInvocationsQueryOptions } from '../api/queries'

const CODE_CHANGE_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
}

/** 代码变更状态到统一状态色。 */
const CODE_CHANGE_STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  queued: 'warning',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

/** 写能力调用名称到可读业务名。 */
const CAPABILITY_LABELS: Record<string, string> = {
  code_change: '代码变更',
  create_pull_request: '创建 PR',
  create_issue: '创建 Issue',
  add_comment: '添加评论',
}

/** 写能力调用状态到统一状态色。 */
const INVOCATION_STATUS_TONES: Record<string, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  queued: 'warning',
  running: 'info',
  succeeded: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

interface CodeChangeForm {
  repositoryId: string
  baseRef: string
  branchName: string
  commitMessage: string
  validationWorkflowPath: string
  patch: string
}

/** 计算补丁 SHA-256；服务端会重新校验，前端计算只用于提交前自检。 */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

const INITIAL_FORM: CodeChangeForm = {
  repositoryId: '',
  baseRef: 'main',
  branchName: '',
  commitMessage: '',
  validationWorkflowPath: '.devops/workflows/validate.yml',
  patch: '',
}

/**
 * 项目代码变更区块：展示写能力授权状态与代码变更，并允许发起受控修改与创建 PR。
 * @param props 项目标识与当前仓库标识。
 * @returns 代码变更区块；未授权时说明原因，不渲染假入口。
 */
export function CodeChangeSection({ projectId, repositoryId }: { projectId: string; repositoryId: string }) {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const capabilities = useQuery(toolCapabilitiesQueryOptions(projectId))
  const changes = useQuery(codeChangesQueryOptions(projectId))
  const invocations = useQuery(toolInvocationsQueryOptions(projectId))
  const repositories = useQuery(projectRepositoriesQueryOptions(projectId))
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CodeChangeForm>({ ...INITIAL_FORM, repositoryId })
  const [diff, setDiff] = useState<{ id: string; content: string; truncated: boolean } | null>(null)
  const [invocationsOpen, setInvocationsOpen] = useState(false)

  const granted = new Set(
    (capabilities.data?.data.capabilities ?? []).filter((item) => item.granted).map((item) => item.capability),
  )
  const canChange = granted.has('code_change')
  const canCreatePullRequest = granted.has('create_pull_request')

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['tools', 'code-changes', projectId] })
  }

  const createChange = useMutation({
    mutationFn: async () =>
      apiClient.createCodeChange(projectId, {
        repositoryId: form.repositoryId,
        baseRef: form.baseRef,
        branchName: form.branchName,
        commitMessage: form.commitMessage,
        patch: form.patch,
        patchSha256: await sha256Hex(form.patch),
        validationWorkflowPath: form.validationWorkflowPath,
      }),
    onSuccess: async () => {
      setCreateOpen(false)
      setForm({ ...INITIAL_FORM, repositoryId })
      await invalidate()
      showToast('代码修改已排队执行', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const createPullRequest = useMutation({
    mutationFn: (codeChangeId: string) =>
      apiClient.createCodeChangePullRequest(codeChangeId, { title: `代码修改 ${codeChangeId.slice(0, 8)}` }),
    onSuccess: async () => {
      await invalidate()
      showToast('PR 已创建', 'success')
    },
    onError: (error: unknown) => showToast(describeRequestError(error).description, 'error'),
  })

  const showDiff = async (codeChangeId: string) => {
    try {
      const result = await apiClient.getCodeChangeDiff(codeChangeId)
      setDiff({ id: codeChangeId, content: result.data.content, truncated: result.data.truncated })
    } catch (error) {
      showToast(describeRequestError(error).description, 'error')
    }
  }

  const items = changes.data?.data.items ?? []

  return (
    <section className="space-y-3">
      <div className="section-heading">
        <h2>代码变更</h2>
        <span className="spacer" />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="查看写能力调用记录"
          title="写能力调用记录"
          onClick={() => setInvocationsOpen(true)}
        >
          <History className="size-4" aria-hidden="true" />
        </Button>
        {canChange ? (
          <Button type="button" size="sm" onClick={() => setCreateOpen(true)}>
            发起代码变更
          </Button>
        ) : (
          <span className="small quiet">未获得代码修改授权，请联系管理员</span>
        )}
      </div>
      {changes.isPending ? (
        <p className="small quiet">代码变更加载中…</p>
      ) : changes.isError ? (
        <div className="inline-error" role="alert">
          <span>代码变更读取失败：{describeRequestError(changes.error).description}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void changes.refetch()}>
            重新加载
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="small quiet">还没有代码变更。</p>
      ) : (
        <ul className="code-change-list">
          {items.map((change) => (
            <li
              key={change.id}
              className="code-change-card clickable-card"
              onClick={(event) => {
                if (isNestedInteractiveTarget(event.target)) return
                void showDiff(change.id)
              }}
            >
              <div className="code-change-head">
                <div className="code-change-branch">
                  <strong>{change.branchName}</strong>
                  <span className="quiet">← {change.baseRef}</span>
                </div>
                <StatusBadge tone={CODE_CHANGE_STATUS_TONES[change.status] ?? 'neutral'}>
                  {CODE_CHANGE_STATUS_LABELS[change.status] ?? change.status}
                </StatusBadge>
              </div>
              <p className="code-change-message">{change.commitMessage}</p>
              <div className="code-change-meta">
                <span>补丁 {Math.ceil(change.patchSizeBytes / 1024)} KB</span>
                {change.pipelineRunId ? <span>流水线运行 {change.pipelineRunId.slice(0, 8)}</span> : null}
              </div>
              {change.errorMessage ? (
                <p className="code-change-error" role="alert">
                  {change.errorMessage}
                </p>
              ) : null}
              <div className="code-change-actions">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation()
                    void showDiff(change.id)
                  }}
                >
                  查看差异
                </Button>
                {change.pullRequest ? (
                  <a className="text-btn" href={change.pullRequest.url ?? '#'} target="_blank" rel="noreferrer">
                    PR #{change.pullRequest.number}
                  </a>
                ) : change.status === 'succeeded' && canCreatePullRequest ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      createPullRequest.mutate(change.id)
                    }}
                    disabled={createPullRequest.isPending}
                  >
                    创建 PR
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <LogSheet
        open={invocationsOpen}
        onOpenChange={setInvocationsOpen}
        title="写能力调用记录"
        description="CLI 与 Bot 对当前项目发起的写操作，最近 5 条"
        footer={<p className="small muted">调用记录只保留摘要；敏感参数不会出现在这里。</p>}
      >
        {invocations.isPending ? (
          <p className="small quiet">调用记录加载中…</p>
        ) : invocations.isError ? (
          <div className="inline-error" role="alert">
            <span>调用记录读取失败：{describeRequestError(invocations.error).description}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void invocations.refetch()}>
              重新加载
            </Button>
          </div>
        ) : (invocations.data?.data.items ?? []).length === 0 ? (
          <p className="small quiet">还没有写能力调用记录。</p>
        ) : (
          <ul className="invocation-list invocation-list-panel">
            {(invocations.data?.data.items ?? []).slice(0, 5).map((item) => (
              <li key={item.id} className="invocation-row">
                <div className="invocation-main">
                  <StatusBadge tone={INVOCATION_STATUS_TONES[item.status] ?? 'neutral'}>
                    {CODE_CHANGE_STATUS_LABELS[item.status] ?? item.status}
                  </StatusBadge>
                  <strong>{CAPABILITY_LABELS[item.capability] ?? item.capability}</strong>
                  <span className="quiet">· {item.channel === 'cli' ? 'CLI' : item.channel}</span>
                </div>
                <time className="invocation-time" dateTime={item.createdAt}>
                  {formatDateTime(item.createdAt)}
                </time>
                {item.errorMessage ? (
                  <p className="invocation-error">
                    {item.errorCode ? `${item.errorCode}：` : ''}
                    {item.errorMessage}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </LogSheet>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发起受控代码修改</DialogTitle>
          </DialogHeader>
          <p className="small quiet">补丁在平台执行节点应用并校验，成功后推送工作分支；不会直接修改默认分支。</p>
          <div className="space-y-4">
            <FormField label="仓库" required>
              <Select
                value={form.repositoryId}
                onChange={(event) => setForm({ ...form, repositoryId: event.target.value })}
              >
                <option value="">请选择仓库</option>
                {(repositories.data?.data ?? []).map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repository.namespace}/{repository.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="基线分支或标签" required>
              <Input value={form.baseRef} onChange={(event) => setForm({ ...form, baseRef: event.target.value })} />
            </FormField>
            <FormField label="工作分支" required>
              <Input
                value={form.branchName}
                onChange={(event) => setForm({ ...form, branchName: event.target.value })}
                placeholder="feature/login-fix"
              />
            </FormField>
            <FormField label="提交信息" required>
              <Input
                value={form.commitMessage}
                onChange={(event) => setForm({ ...form, commitMessage: event.target.value })}
              />
            </FormField>
            <FormField label="校验工作流" required help="仓库内 .devops/workflows/ 下的工作流路径">
              <Input
                value={form.validationWorkflowPath}
                onChange={(event) => setForm({ ...form, validationWorkflowPath: event.target.value })}
              />
            </FormField>
            <FormField label="补丁（unified diff）" required>
              <Textarea
                value={form.patch}
                onChange={(event) => setForm({ ...form, patch: event.target.value })}
                rows={8}
                placeholder="diff --git a/src/a.ts b/src/a.ts ..."
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              onClick={() => createChange.mutate()}
              disabled={
                createChange.isPending ||
                !form.repositoryId ||
                !form.baseRef ||
                !form.branchName ||
                !form.commitMessage ||
                !form.patch.trim()
              }
            >
              {createChange.isPending ? '提交中…' : '开始修改'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={diff !== null} onOpenChange={(open) => (!open ? setDiff(null) : undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>代码差异</DialogTitle>
          </DialogHeader>
          <pre className="diff-preview">{diff?.content}</pre>
          {diff?.truncated ? <p className="small quiet">差异较大，仅展示前缀。</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDiff(null)}>
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
