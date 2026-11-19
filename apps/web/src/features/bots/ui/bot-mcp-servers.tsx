import { useId, useState, type ReactNode } from 'react'
import { createIdempotencyKey, type ApiSuccessData } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Checkbox } from '@/shared/ui/controls/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/controls/dialog'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'
import { botChoicesOptions } from '../api/queries'

type Server = ApiSuccessData<'/api/v1/teams/{teamId}/bot-mcp-servers', 'get'>['items'][number]
const serversKey = ['bot-mcp-servers']

function ServerDialog({ teamId, server, children }: { teamId: string; server?: Server; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {open && <ServerFields teamId={teamId} server={server} close={() => setOpen(false)} />}
    </Dialog>
  )
}

function ServerFields({ teamId, server, close }: { teamId: string; server?: Server; close: () => void }) {
  const client = useQueryClient()
  const formId = useId()
  const [name, setName] = useState(server?.name ?? '')
  const [url, setUrl] = useState(server?.url ?? '')
  const [credentialId, setCredentialId] = useState(server?.credentialId ?? '')
  const [exposure, setExposure] = useState<'direct' | 'deferred'>(server?.exposure ?? 'deferred')
  const [botIds, setBotIds] = useState(server?.botIds ?? [])
  const [remove, setRemove] = useState(false)
  const bots = useInfiniteQuery(botChoicesOptions(teamId))
  const botChoices = bots.data?.pages.flatMap(({ data }) => data.items) ?? []
  const credentials = useInfiniteQuery({
    initialPageParam: 1,
    queryKey: ['bot-mcp-credentials', teamId],
    queryFn: ({ pageParam, signal }) =>
      apiClient.listCredentials(
        teamId,
        {
          kind: 'api_key',
          status: 'active',
          page: pageParam,
          pageSize: 50,
        },
        { signal },
      ),
    getNextPageParam: ({ data }) => (data.page * data.pageSize < data.total ? data.page + 1 : undefined),
  })
  const choices = credentials.data?.pages.flatMap(({ data }) => data.items) ?? []
  const save = useMutation({
    mutationFn: (action: 'save' | 'remove') => {
      const options = { idempotencyKey: createIdempotencyKey() }
      if (action === 'remove' && server?.id) return apiClient.controlBotMcpServer(server.id, 'remove', options)
      const input = { name: name.trim(), url: url.trim(), credentialId: credentialId || null, exposure, botIds }
      return server?.id
        ? apiClient.updateBotMcpServer(server.id, input, options)
        : apiClient.createBotMcpServer(teamId, input, options)
    },
    onSuccess: async () => {
      close()
      await client.invalidateQueries({ queryKey: [...serversKey, teamId] })
    },
  })
  const valid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && url.trim().startsWith('https://')
  return (
    <DialogContent
      showCloseButton={!save.isPending}
      onEscapeKeyDown={(event) => {
        if (save.isPending) event.preventDefault()
      }}
      onPointerDownOutside={(event) => {
        if (save.isPending) event.preventDefault()
      }}
    >
      <DialogHeader>
        <DialogTitle>{server ? '编辑 MCP 服务器' : '添加 MCP 服务器'}</DialogTitle>
        <DialogDescription>通过 HTTPS 连接远程工具，并选择可以调用它们的智能体。</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid && !save.isPending && !remove) save.mutate('save')
        }}
      >
        <label className="field">
          <span>名称</span>
          <Input
            required
            maxLength={40}
            placeholder="my-server"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            value={name}
            readOnly={save.isPending}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>HTTPS 地址</span>
          <Input
            required
            type="url"
            maxLength={2048}
            placeholder="https://example.com/mcp"
            value={url}
            readOnly={save.isPending}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label className="field">
          <span>团队凭据</span>
          <Select
            disabled={save.isPending}
            value={credentialId}
            onChange={(event) => setCredentialId(event.target.value)}
          >
            <option value="">无需凭据</option>
            {credentialId && !choices.some(({ id }) => id === credentialId) && (
              <option value={credentialId}>已选凭据</option>
            )}
            {choices.map(({ id, name }) => (
              <option value={id} key={id}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        {credentials.isError && (
          <Button type="button" variant="ghost" onClick={() => void credentials.refetch()}>
            重试加载凭据
          </Button>
        )}
        {credentials.hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            disabled={credentials.isFetchingNextPage}
            onClick={() => void credentials.fetchNextPage()}
          >
            加载更多凭据
          </Button>
        )}
        <label className="field">
          <span>工具提供方式</span>
          <Select
            value={exposure}
            disabled={save.isPending}
            onChange={(event) => setExposure(event.target.value === 'direct' ? 'direct' : 'deferred')}
          >
            <option value="deferred">按需发现</option>
            <option value="direct">直接提供</option>
          </Select>
        </label>
        <fieldset className="grid gap-2">
          <legend className="mb-2">授权智能体</legend>
          {bots.isPending && <p className="small muted">加载智能体…</p>}
          {bots.isSuccess && !botChoices.length && <p className="small muted">团队还没有智能体。</p>}
          {bots.isError && (
            <Button type="button" variant="ghost" onClick={() => void bots.refetch()}>
              重试加载智能体
            </Button>
          )}
          {botChoices.map(({ id, name }) => (
            <label className="row min-h-9" key={id} htmlFor={`${formId}-${id}`}>
              <Checkbox
                id={`${formId}-${id}`}
                checked={botIds.includes(id)}
                disabled={save.isPending || (botIds.length >= 100 && !botIds.includes(id))}
                onCheckedChange={(checked) =>
                  setBotIds((ids) => (checked ? [...ids, id] : ids.filter((selected) => selected !== id)))
                }
              />
              <span className="wrap-break-word">{name}</span>
            </label>
          ))}
          {bots.hasNextPage && (
            <Button
              type="button"
              variant="ghost"
              disabled={bots.isFetchingNextPage}
              onClick={() => void bots.fetchNextPage()}
            >
              加载更多智能体
            </Button>
          )}
        </fieldset>
        {save.isError && (
          <p role="alert" className="field-error">
            {describeRequestError(save.error).description}
          </p>
        )}
        {remove && <p role="status">删除后，已授权的智能体将无法使用此服务器。</p>}
        <DialogFooter>
          {server?.id && !remove && (
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => setRemove(true)}>
              删除服务器
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending}
            onClick={remove ? () => setRemove(false) : close}
          >
            取消
          </Button>
          {remove ? (
            <Button type="button" variant="destructive" disabled={save.isPending} onClick={() => save.mutate('remove')}>
              {save.isPending ? '删除中…' : '确认删除'}
            </Button>
          ) : (
            <Button type="submit" disabled={!valid || save.isPending} aria-busy={save.isPending}>
              {save.isPending ? '保存中…' : '保存服务器'}
            </Button>
          )}
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function ServerRow({ server, teamId }: { server: Server; teamId: string }) {
  const client = useQueryClient()
  const test = useMutation({
    mutationFn: (id: string) => apiClient.testBotMcpServer(id, { idempotencyKey: createIdempotencyKey() }),
  })
  const toggle = useMutation({
    mutationFn: (id: string) =>
      apiClient.controlBotMcpServer(id, server.status === 'enabled' ? 'disable' : 'enable', {
        idempotencyKey: createIdempotencyKey(),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: [...serversKey, teamId] }),
  })
  const id = server.id
  const pending = test.isPending || toggle.isPending
  const checked = test.data?.data
  const error = test.error ?? toggle.error
  return (
    <li className="grid gap-2 border-t border-border py-3">
      <div className="row flex-wrap">
        <div className="min-w-0 flex-1">
          <strong className="wrap-break-word">{server.name}</strong>
          <p className="small muted">
            {server.status === 'enabled' ? '已启用' : '已停用'}
            {id && ` · ${server.botIds?.length ?? 0} 个智能体`}
          </p>
        </div>
        {id && (
          <div className="row flex-wrap">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              aria-busy={test.isPending}
              onClick={() => test.mutate(id)}
            >
              {test.isPending ? '测试中…' : '测试连接'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              aria-busy={toggle.isPending}
              onClick={() => toggle.mutate(id)}
            >
              {toggle.isPending ? '更新中…' : server.status === 'enabled' ? '停用' : '启用'}
            </Button>
            <ServerDialog teamId={teamId} server={server}>
              <Button type="button" variant="outline" size="sm" disabled={pending} aria-label={`编辑 ${server.name}`}>
                编辑
              </Button>
            </ServerDialog>
          </div>
        )}
      </div>
      {checked && (
        <p className="small muted" role="status">
          {checked.isConnected
            ? `连接成功，发现 ${checked.toolCount} 个工具。`
            : (checked.failureMessage ?? '连接失败。')}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {describeRequestError(error).description}
        </p>
      )}
    </li>
  )
}

/**
 * 列出团队的远程 MCP 服务器，按服务端权限展示管理入口。
 * @param props 当前团队标识。
 * @returns 连接列表、测试与授权控件。
 */
export function BotMcpServers({ teamId }: { teamId: string }) {
  const list = useInfiniteQuery({
    queryKey: [...serversKey, teamId],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) =>
      apiClient.listBotMcpServers(teamId, { cursor: pageParam || undefined }, { signal }),
    getNextPageParam: ({ data }) => data.nextCursor ?? undefined,
  })
  const items = list.data?.pages.flatMap(({ data }) => data.items) ?? []
  return (
    <section aria-label="MCP 服务器" className="settings-section">
      <div className="section-heading settings-heading">
        <h3>MCP 服务器</h3>
        {list.data?.pages[0]?.data.canManage && (
          <ServerDialog teamId={teamId}>
            <Button variant="outline" type="button" size="sm" className="max-md:min-h-11">
              <Plus className="size-4" aria-hidden="true" />
              添加服务器
            </Button>
          </ServerDialog>
        )}
      </div>
      {list.isPending && <DelayedPageSkeleton />}
      {list.isError && (
        <PageError
          title="MCP 服务器加载失败"
          error={list.error}
          retrying={list.isFetching}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.isSuccess && !items.length && <p className="settings-inline-empty">还没有 MCP 服务器</p>}
      {items.length > 0 && (
        <ul>
          {items.map((server) => (
            <ServerRow key={server.id ?? server.name} server={server} teamId={teamId} />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button
          variant="ghost"
          type="button"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? '加载中…' : '加载更多服务器'}
        </Button>
      )}
    </section>
  )
}
