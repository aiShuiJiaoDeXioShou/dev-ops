import { useMutation, useQuery } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { useLocation } from 'react-router'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'

/**
 * 从当前页面发起个人 GitHub 授权。
 * @param props 按钮文案、禁用状态及可选的页面恢复数据保存回调。
 * @returns 跳转入口与就地错误说明；授权完成后返回当前页面。
 */
export function GitHubAccountButton({
  label,
  disabled,
  beforeRedirect,
}: {
  label: string
  disabled?: boolean
  beforeRedirect?: () => void
}) {
  const { pathname } = useLocation()
  const mutation = useMutation({
    mutationFn: () => apiClient.authorizeGitHubAccount({ returnTo: pathname.replace(/\/$/, '') }),
    onSuccess: ({ data }) => {
      beforeRedirect?.()
      window.location.assign(data.authorizationUrl)
    },
  })
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        disabled={disabled || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? '正在前往 GitHub…' : label}
      </Button>
      {mutation.isError && (
        <p role="alert" className="small text-destructive">
          {isBusinessError(mutation.error, 'PRECONDITION_FAILED')
            ? 'GitHub 个人绑定尚未配置，请联系平台管理员。'
            : describeRequestError(mutation.error).description}
        </p>
      )}
    </div>
  )
}

/**
 * 显示当前用户的 GitHub 绑定情况。
 * @returns 包含授权或更换入口的资料区块。
 */
export function GitHubAccountSection() {
  const account = useQuery({
    queryKey: ['identity', 'github-account'],
    queryFn: ({ signal }) => apiClient.getGitHubAccount({ signal }),
  })
  const login = account.data?.data.login
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">GitHub 账号</p>
        {account.isPending ? (
          <p role="status" className="small quiet">
            正在检查绑定状态…
          </p>
        ) : account.isError ? (
          <p role="alert" className="small text-destructive">
            GitHub 账号读取失败。
          </p>
        ) : (
          <p className="small quiet wrap-anywhere">
            {login ? `已绑定 @${login}` : account.data.data.enabled ? '未绑定' : '平台尚未配置 GitHub 个人绑定。'}
          </p>
        )}
      </div>
      {account.isError ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={account.isFetching}
          onClick={() => void account.refetch()}
        >
          重新检查
        </Button>
      ) : (
        <GitHubAccountButton
          label={login ? '更换 GitHub 账号' : '绑定 GitHub 账号'}
          disabled={!account.data?.data.enabled}
        />
      )}
    </div>
  )
}
