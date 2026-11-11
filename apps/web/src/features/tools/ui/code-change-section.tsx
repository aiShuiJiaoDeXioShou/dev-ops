import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { isNestedInteractiveTarget } from '@/shared/lib/clickable'
import { projectRepositoriesQueryOptions } from '@/features/code/public'
import { Badge } from '@/shared/ui/controls/badge'
import { Button } from '@/shared/ui/controls/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/controls/dialog'
import { FormField } from '@/shared/ui/controls/form-field'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { Textarea } from '@/shared/ui/controls/textarea'
import { useToast } from '@/shared/ui/toast'
import { codeChangesQueryOptions, toolCapabilitiesQueryOptions, toolInvocationsQueryOptions } from '../api/queries'

const CODE_CHANGE_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
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
        <p className="small">代码变更读取失败：{describeRequestError(changes.error).description}</p>
      ) : items.length === 0 ? (
        <p className="small quiet">还没有代码变更。</p>
      ) : (
        <ul className="space-y-2">
          {items.map((change) => (
            <li
              key={change.id}
              className="event-card clickable-card"
              onClick={(event) => {
                if (isNestedInteractiveTarget(event.target)) return
                void showDiff(change.id)
              }}
            >
              <div className="row spread flex-wrap">
                <span>
                  <strong>{change.branchName}</strong>
                  <span className="small quiet">
                    {' '}
                    ← {change.baseRef} · {change.commitMessage}
                  </span>
                </span>
                <Badge variant={change.status === 'failed' ? 'destructive' : 'secondary'}>
                  {CODE_CHANGE_STATUS_LABELS[change.status] ?? change.status}
                </Badge>
              </div>
              <div className="row flex-wrap gap-2">
                <span className="small quiet">补丁 {Math.ceil(change.patchSizeBytes / 1024)} KB</span>
                {change.pipelineRunId ? (
                  <span className="small quiet">运行 {change.pipelineRunId.slice(0, 8)}</span>
                ) : null}
                <Button type="button" variant="ghost" size="sm" onClick={() => void showDiff(change.id)}>
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
                    onClick={() => createPullRequest.mutate(change.id)}
                    disabled={createPullRequest.isPending}
                  >
                    创建 PR
                  </Button>
                ) : null}
              </div>
              {change.errorMessage ? <p className="small">{change.errorMessage}</p> : null}
            </li>
          ))}
        </ul>
      )}

      <section className="space-y-2">
        <h3>最近写能力调用</h3>
        {(invocations.data?.data.items ?? []).length === 0 ? (
          <p className="small quiet">还没有写能力调用记录。</p>
        ) : (
          <ul className="space-y-1">
            {(invocations.data?.data.items ?? []).slice(0, 5).map((item) => (
              <li key={item.id} className="small">
                <span className="quiet">{new Date(item.createdAt).toLocaleString()}</span> · {item.capability} ·{' '}
                {item.status}
                {item.errorMessage ? ` · ${item.errorMessage}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

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
