import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isBusinessError } from '@dev-ops/api-client'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/controls/table'
import { Tag, type TagVariant } from '@/shared/ui/tag'
import { DelayedPageLoading, EmptyState, PageError } from '@/shared/ui/page-state'
import { useToast } from '@/shared/ui/toast'
import { apiTokensQueryOptions, type ApiTokenMetadata } from '../api/tokens'

const STATUS_LABELS: Record<ApiTokenMetadata['status'], { label: string; variant: TagVariant }> = {
  active: { label: '有效', variant: 'green' },
  expired: { label: '已过期', variant: 'neutral' },
  revoked: { label: '已撤销', variant: 'red' },
}

function tokenError(cause: unknown): string {
  if (isBusinessError(cause)) return describeRequestError(cause).description
  return '操作失败，请稍后重试。'
}

/** 个人页面 API Token 管理：创建、一次性明文展示与撤销。 */
export function ApiTokenSection() {
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const tokens = useQuery(apiTokensQueryOptions)
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('90')
  const [createError, setCreateError] = useState('')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ApiTokenMetadata | null>(null)
  const [revokeError, setRevokeError] = useState('')

  const create = useMutation({
    mutationFn: () => apiClient.createApiToken({ name: name.trim(), expiresInDays: Number(expiresInDays) }),
    onSuccess: async (result) => {
      setCreatedToken(result.data.token)
      setCreateOpen(false)
      setName('')
      setExpiresInDays('90')
      setCreateError('')
      await queryClient.invalidateQueries({ queryKey: apiTokensQueryOptions.queryKey })
    },
    onError: (cause: unknown) => {
      const message = tokenError(cause)
      setCreateError(message)
      showToast(message, 'error')
    },
  })

  const revoke = useMutation({
    mutationFn: (tokenId: string) => apiClient.revokeApiToken(tokenId),
    onSuccess: async () => {
      setRevokeTarget(null)
      setRevokeError('')
      await queryClient.invalidateQueries({ queryKey: apiTokensQueryOptions.queryKey })
      showToast('API Token 已撤销。', 'success')
    },
    onError: (cause: unknown) => {
      const message = tokenError(cause)
      setRevokeError(message)
      showToast(message, 'error')
    },
  })

  const submitCreate = (event: FormEvent) => {
    event.preventDefault()
    setCreateError('')
    const trimmed = name.trim()
    const days = Number(expiresInDays)
    if (!trimmed) return setCreateError('请填写 Token 名称。')
    if (trimmed.length > 120) return setCreateError('Token 名称不能超过 120 个字符。')
    if (!Number.isInteger(days) || days < 1 || days > 365) return setCreateError('有效期必须是 1-365 天。')
    create.mutate()
  }

  const copyCreatedToken = async () => {
    if (!createdToken) return
    try {
      await navigator.clipboard.writeText(createdToken)
      showToast('已复制到剪贴板。', 'success')
    } catch {
      showToast('复制失败，请手动选择并复制。', 'error')
    }
  }

  if (tokens.isPending) return <DelayedPageLoading message="正在加载 API Token…" />
  if (tokens.isError) {
    const described = describeRequestError(tokens.error)
    return (
      <PageError
        title="API Token 加载失败"
        description={described.description}
        requestId={described.requestId}
        onRetry={() => void tokens.refetch()}
      />
    )
  }

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="api-token-title">
      <div className="section-heading flex-wrap items-start gap-3">
        <div>
          <h2 id="api-token-title" className="text-lg font-semibold">
            API Token
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            供 `devops` 命令和自动化工具使用。Token 只显示一次，请妥善保存。
          </p>
        </div>
        <span className="spacer" />
        <Button type="button" onClick={() => setCreateOpen(true)}>
          新建 Token
        </Button>
      </div>

      {tokens.data.data.items.length === 0 ? (
        <EmptyState
          title="还没有 API Token"
          description="创建一个 Token 后，可在终端执行 devops config set token 保存并调用平台。"
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              新建 Token
            </Button>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead className="hidden md:table-cell">前缀</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="hidden md:table-cell">创建时间</TableHead>
                <TableHead>到期时间</TableHead>
                <TableHead className="hidden md:table-cell">最后使用</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.data.data.items.map((token) => {
                const status = STATUS_LABELS[token.status]
                return (
                  <TableRow key={token.id}>
                    <TableCell className="font-medium">{token.name}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                      {token.tokenPrefix}…
                    </TableCell>
                    <TableCell>
                      <Tag variant={status.variant}>{status.label}</Tag>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {formatDateTime(token.createdAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(token.expiresAt)}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {formatDateTime(token.lastUsedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={token.status === 'revoked' || revoke.isPending}
                        onClick={() => {
                          setRevokeError('')
                          setRevokeTarget(token)
                        }}
                      >
                        撤销
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建 API Token</DialogTitle>
            <DialogDescription>为 Token 设置名称和有效期。创建后完整 Token 只显示一次。</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={submitCreate} noValidate>
            <label className="block space-y-1.5 text-sm font-medium">
              Token 名称
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                placeholder="例如：local-cli 或 ci-read"
                autoFocus
              />
            </label>
            <label className="block space-y-1.5 text-sm font-medium">
              有效期（天）
              <Input
                type="number"
                min={1}
                max={365}
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
              />
            </label>
            {createError && (
              <p role="alert" className="text-sm text-destructive">
                {createError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? '创建中…' : '创建 Token'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={createdToken !== null} onOpenChange={(open) => !open && setCreatedToken(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Token 已创建</DialogTitle>
            <DialogDescription>请立即复制并妥善保存。关闭后将无法再次查看完整 Token。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input readOnly value={createdToken ?? ''} aria-label="新建的 API Token" className="font-mono text-xs" />
            <Button type="button" variant="outline" onClick={() => void copyCreatedToken()}>
              复制 Token
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => setCreatedToken(null)}>
              我已保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>撤销 API Token</DialogTitle>
            <DialogDescription>
              撤销后使用该 Token 的 CLI/自动化请求会立即失败，且不可恢复。确认撤销「{revokeTarget?.name}」？
            </DialogDescription>
          </DialogHeader>
          {revokeError && (
            <p role="alert" className="text-sm text-destructive">
              {revokeError}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRevokeTarget(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revoke.isPending}
              onClick={() => revokeTarget && revoke.mutate(revokeTarget.id)}
            >
              {revoke.isPending ? '撤销中…' : '确认撤销'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
