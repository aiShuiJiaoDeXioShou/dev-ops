import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { isBusinessError, type ApiBody } from '@dev-ops/api-client'
import { useLocation, useSearchParams } from 'react-router'
import { useGitHubAccountFeedback } from '@/features/identity/model/use-github-account-feedback'
import { GitHubAccountButton } from '@/features/identity/ui/github-account'
import { useProjectRole } from '@/features/projects/model/use-project-role'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'

type Action = ApiBody<'/api/v1/projects/{projectId}/repositories/{repositoryId}/github-action', 'post'>
interface Intent {
  repositoryId: string
  label: string
  action: Action
}

function restoreIntent(key: string): Intent | null {
  try {
    const saved = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    if (!saved) return null
    const data: unknown = JSON.parse(saved)
    if (
      typeof data !== 'object' ||
      data === null ||
      !('repositoryId' in data) ||
      typeof data.repositoryId !== 'string' ||
      !('label' in data) ||
      typeof data.label !== 'string' ||
      !('expiresAt' in data) ||
      typeof data.expiresAt !== 'number' ||
      data.expiresAt <= Date.now() ||
      !('action' in data) ||
      typeof data.action !== 'object' ||
      data.action === null ||
      !('action' in data.action)
    )
      return null
    const { repositoryId, label, action } = data
    if (action.action === 'create_pull_request') return { repositoryId, label, action: { action: action.action } }
    if (
      action.action === 'edit_file' &&
      'branch' in action &&
      typeof action.branch === 'string' &&
      'path' in action &&
      typeof action.path === 'string'
    ) {
      return { repositoryId, label, action: { action: action.action, branch: action.branch, path: action.path } }
    }
    return null
  } catch {
    // 浏览器禁用会话存储时仍可绑定，返回页面后可再次点击操作。
    return null
  }
}

/**
 * 对当前项目成员校验 GitHub 写操作，在 GitHub 页面继续编辑或创建 PR。
 * @param props 项目标识和当前仓库操作；没有可用文件时不显示编辑按钮。
 * @returns 操作入口与可重试提示；个人绑定回跳后重新校验原操作。
 */
export function GitHubWriteAction({ projectId, intent }: { projectId: string; intent: Intent | null }) {
  const role = useProjectRole()
  const canWrite = role === 'admin' || role === 'developer'
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const [returnResult] = useState(() => searchParams.get('githubAccount'))
  const resumed = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [prompt, setPrompt] = useState<{ error: unknown; intent: Intent } | null>(null)
  const storageKey = `dev-ops.github-action:${pathname}`
  const { mutate, isPending } = useMutation({
    mutationFn: (requested: Intent) =>
      apiClient.openGitHubRepositoryAction(projectId, requested.repositoryId, requested.action),
    onSuccess: ({ data }) => window.location.assign(data.url),
    onError: (error, requested) => setPrompt({ error, intent: requested }),
  })
  useGitHubAccountFeedback()

  useEffect(() => {
    if (!returnResult || resumed.current || !canWrite) return
    resumed.current = true
    const recovered = restoreIntent(storageKey)
    if (returnResult === 'connected' && recovered) mutate(recovered)
  }, [canWrite, mutate, returnResult, storageKey])

  if (!canWrite) return null
  const requiresAccount = isBusinessError(prompt?.error, 'GITHUB_ACCOUNT_REQUIRED')
  const deniesAction = isBusinessError(prompt?.error, 'GITHUB_REPOSITORY_FORBIDDEN')
  const authorize = (requested: Intent) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ ...requested, expiresAt: Date.now() + 10 * 60_000 }))
    } catch {
      // 无法保存恢复数据时，授权仍可独立完成。
      setPrompt(null)
    }
  }

  return (
    <>
      {intent && (
        <Button
          ref={triggerRef}
          type="button"
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => mutate(intent)}
        >
          {isPending ? '检查权限中…' : intent.action.action === 'edit_file' ? '编辑代码' : '创建 PR'}
        </Button>
      )}
      <Dialog
        open={prompt !== null}
        onOpenChange={(open) => {
          if (!open && !isPending) setPrompt(null)
        }}
      >
        {prompt && (
          <DialogContent
            onCloseAutoFocus={(event) => {
              if (triggerRef.current) {
                event.preventDefault()
                triggerRef.current.focus()
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {requiresAccount
                  ? '需要绑定 GitHub 账号'
                  : deniesAction
                    ? 'GitHub 仓库权限不足'
                    : 'GitHub 权限检查失败'}
              </DialogTitle>
              <DialogDescription className="wrap-anywhere">
                {requiresAccount
                  ? `绑定或重新授权 GitHub 后，将继续检查 ${prompt.intent.label} 的操作权限。`
                  : deniesAction
                    ? `请向 ${prompt.intent.label} 的仓库管理员申请此操作所需的权限。授权后可以重新检查。`
                    : describeRequestError(prompt.error).description}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              {(requiresAccount || deniesAction) && (
                <GitHubAccountButton
                  label={requiresAccount ? '绑定 GitHub 账号' : '更换 GitHub 账号'}
                  disabled={isPending}
                  beforeRedirect={() => authorize(prompt.intent)}
                />
              )}
              {!requiresAccount && (
                <Button type="button" disabled={isPending} onClick={() => mutate(prompt.intent)}>
                  {isPending ? '检查中…' : '重新检查'}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
