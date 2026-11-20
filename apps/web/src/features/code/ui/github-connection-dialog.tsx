import { useRef, useState } from 'react'
import { RequestError } from '@dev-ops/api-client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
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
  DialogTrigger,
} from '@/shared/ui/controls/dialog'
import { Select } from '@/shared/ui/controls/select'
import { useToast } from '@/shared/ui/toast'

/**
 * 让团队管理员连接已有的 GitHub App 安装，或前往 GitHub 新建安装。
 * @param props 团队标识及绑定成功后刷新关联列表的回调。
 * @returns 带有安装发现、选择和错误恢复状态的连接弹窗。
 */
export function GitHubConnectionDialog({ teamId, onConnected }: { teamId: string; onConnected: () => Promise<void> }) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [installationId, setInstallationId] = useState('')
  const { showToast } = useToast()
  const installations = useQuery({
    queryKey: ['code', 'github-installations', teamId],
    queryFn: ({ signal }) => apiClient.discoverGitHubInstallations(teamId, { signal }),
    enabled: open,
    retry: false,
  })
  const createConnection = useMutation({
    mutationFn: (id?: number) =>
      apiClient.createGitConnection(teamId, { providerKey: 'github', name: 'GitHub', installationId: id }),
    onSuccess: async (result) => {
      if ('authorizationUrl' in result.data) {
        window.location.assign(result.data.authorizationUrl)
        return
      }
      await onConnected()
      setOpen(false)
      showToast('GitHub 已连接，已同步授权仓库。', 'success')
    },
  })
  const choices = installations.data?.data ?? []
  const selected = choices.find((item) => String(item.id) === installationId)
  const needsAccount =
    installations.error instanceof RequestError && installations.error.serverCode === 'GITHUB_ACCOUNT_REQUIRED'
  const error = createConnection.error ?? installations.error
  const loadingInstallations = installations.isFetching && !installations.data
  const pending = createConnection.isPending

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (next) {
          setInstallationId('')
          createConnection.reset()
        }
        setOpen(next)
      }}
    >
      <DialogTrigger asChild>
        <Button ref={trigger} type="button" variant="outline" size="sm" className="max-md:min-h-11">
          添加 GitHub 连接
        </Button>
      </DialogTrigger>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          trigger.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>添加 GitHub 连接</DialogTitle>
          <DialogDescription>选择已有的 GitHub App 安装，将其授权仓库同步到当前团队。</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (selected && !pending) createConnection.mutate(selected.id)
          }}
        >
          {loadingInstallations && <p role="status">正在读取 GitHub App 安装…</p>}
          {installations.isSuccess && choices.length === 0 && <p>当前 GitHub 账号没有可绑定的安装。</p>}
          {choices.length > 0 && (
            <label className="field">
              GitHub App 安装
              <Select
                value={selected ? installationId : ''}
                onChange={(event) => setInstallationId(event.target.value)}
                disabled={pending}
              >
                <option value="">选择账号或组织</option>
                {choices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.login}
                  </option>
                ))}
              </Select>
            </label>
          )}
          {error && (
            <div className="space-y-2">
              <p role="alert" className="field-error">
                {describeRequestError(error).description}
              </p>
              {needsAccount && <Link to="/settings/profile">打开个人设置</Link>}
              {installations.isError && !needsAccount && (
                <Button type="button" variant="outline" disabled={pending} onClick={() => void installations.refetch()}>
                  重试读取安装
                </Button>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => createConnection.mutate(undefined)}
            >
              {pending && createConnection.variables === undefined ? '跳转中…' : '新建 GitHub App 安装'}
            </Button>
            <Button type="submit" disabled={!selected || pending}>
              {pending && createConnection.variables !== undefined ? '绑定中…' : '绑定并同步'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
