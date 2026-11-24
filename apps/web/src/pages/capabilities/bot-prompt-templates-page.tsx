import { useDeferredValue, useState } from 'react'
import { createIdempotencyKey, type ApiSuccessData } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Plus, Search } from 'lucide-react'
import { useSession } from '@/features/identity/model/session'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Textarea } from '@/shared/ui/controls/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/ui/controls/dialog'
import { PromptTemplatesPageSkeleton } from '@/pages/page-skeletons'
import { CompactListSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'

type Template = ApiSuccessData<'/api/v1/teams/{teamId}/bot-prompt-templates', 'get'>['items'][number]
const templatesKey = ['bot-prompt-templates']

function TemplateDialog({
  teamId,
  template,
  write,
  children,
}: {
  teamId: string
  template?: Template
  write: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      {open && <TemplateFields teamId={teamId} template={template} write={write} close={() => setOpen(false)} />}
    </Dialog>
  )
}

function TemplateFields({
  teamId,
  template,
  write,
  close,
}: {
  teamId: string
  template?: Template
  write: boolean
  close: () => void
}) {
  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [body, setBody] = useState(template?.body ?? '')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const client = useQueryClient()
  const mutation = useMutation({
    mutationFn: (action: 'save' | 'remove') => {
      const options = { idempotencyKey: createIdempotencyKey() }
      if (action === 'remove' && template) return apiClient.removeBotPromptTemplate(template.id, options)
      const input = { name: name.trim(), description: description.trim(), body: body.trim() }
      return template
        ? apiClient.updateBotPromptTemplate(template.id, input, options)
        : apiClient.createBotPromptTemplate(teamId, input, options)
    },
    onSuccess: async () => {
      close()
      await client.invalidateQueries({ queryKey: [...templatesKey, teamId] })
    },
  })
  const locked = !write || mutation.isPending
  const valid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) && !!description.trim() && !!body.trim()
  return (
    <DialogContent
      showCloseButton={!mutation.isPending}
      onEscapeKeyDown={(event) => {
        if (mutation.isPending) event.preventDefault()
      }}
      onPointerDownOutside={(event) => {
        if (mutation.isPending) event.preventDefault()
      }}
    >
      <DialogHeader>
        <DialogTitle>{template ? (write ? '编辑提示模板' : `/${template.name}`) : '新建提示模板'}</DialogTitle>
        <DialogDescription>在会话输入框键入 / 即可选择模板。</DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!locked && valid && !confirmRemove) mutation.mutate('save')
        }}
      >
        <label className="field">
          <span>命令名称</span>
          <Input
            required
            maxLength={40}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            readOnly={locked}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="review-plan"
          />
          {write && <span className="small muted">使用小写英文字母或数字，可用短横线分隔。</span>}
        </label>
        <label className="field">
          <span>摘要</span>
          <Input
            required
            maxLength={200}
            readOnly={locked}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="field">
          <span>模板正文</span>
          <Textarea
            required
            rows={7}
            maxLength={16000}
            readOnly={locked}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          {write && <span className="small muted">{'使用 $ARGUMENTS 引用成员填写的内容。'}</span>}
        </label>
        {confirmRemove && <p role="status">删除后，此命令会从会话的模板列表中移除。</p>}
        {mutation.isError && (
          <p role="alert" className="field-error">
            {describeRequestError(mutation.error).description}
          </p>
        )}
        <DialogFooter>
          {template && write && !confirmRemove && (
            <Button type="button" variant="ghost" disabled={locked} onClick={() => setConfirmRemove(true)}>
              删除模板
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={confirmRemove ? () => setConfirmRemove(false) : close}
          >
            {write ? '取消' : '关闭'}
          </Button>
          {confirmRemove && (
            <Button type="button" variant="destructive" disabled={locked} onClick={() => mutation.mutate('remove')}>
              {mutation.isPending ? '删除中…' : '确认删除'}
            </Button>
          )}
          {write && !confirmRemove && (
            <Button type="submit" disabled={locked || !valid} aria-busy={mutation.isPending}>
              {mutation.isPending ? '保存中…' : '保存模板'}
            </Button>
          )}
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

function TemplateList({ teamId, write }: { teamId: string; write: boolean }) {
  const [search, setSearch] = useState('')
  const query = useDeferredValue(search.trim())
  const list = useInfiniteQuery({
    queryKey: [...templatesKey, teamId, query],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) =>
      apiClient.listBotPromptTemplates(
        teamId,
        { query: query || undefined, cursor: pageParam || undefined },
        { signal },
      ),
    getNextPageParam: ({ data }) => data.nextCursor ?? undefined,
  })
  const items = list.data?.pages.flatMap(({ data }) => data.items) ?? []
  return (
    <div className="work-padding" aria-label="提示模板">
      <header className="work-header">
        <h1>提示模板</h1>
      </header>
      <div className="work-toolbar flex-wrap">
        <label className="search">
          <Search className="size-4" aria-hidden="true" />
          <Input
            type="search"
            value={search}
            maxLength={80}
            aria-label="搜索模板"
            placeholder="搜索模板"
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <span className="spacer" />
        {write && (
          <TemplateDialog teamId={teamId} write={write}>
            <Button type="button">
              <Plus className="size-4" />
              新建模板
            </Button>
          </TemplateDialog>
        )}
      </div>
      {list.isPending && <CompactListSkeleton rows={5} trailing bordered label="提示模板列表加载中" />}
      {list.isError && (
        <PageError
          title="提示模板加载失败"
          error={list.error}
          retrying={list.isFetching}
          onRetry={() => void list.refetch()}
        />
      )}
      {list.isSuccess && !items.length && (
        <EmptyState icon={<FileText />} title={query ? '没有匹配的模板' : '还没有提示模板'} />
      )}
      <ul className="grid gap-3">
        {items.map((template) => (
          <li className="card row flex-wrap" key={template.id}>
            <div className="min-w-0 flex-1">
              <strong className="wrap-break-word">/{template.name}</strong>
              <p className="small muted wrap-break-word">{template.description}</p>
            </div>
            <TemplateDialog teamId={teamId} template={template} write={write}>
              <Button type="button" variant="ghost" aria-label={`${write ? '编辑' : '查看'} /${template.name}`}>
                {write ? '编辑' : '查看'}
              </Button>
            </TemplateDialog>
          </li>
        ))}
      </ul>
      {list.hasNextPage && (
        <Button
          type="button"
          variant="ghost"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? '加载中…' : '加载更多模板'}
        </Button>
      )}
    </div>
  )
}

/**
 * 展示团队共享的提示模板，根据当前角色提供模板维护操作。
 * @returns 当前团队的模板列表与编辑对话框入口。
 */
export function Component() {
  const { currentTeam, role, isReady } = useSession()
  if (!isReady) return <PromptTemplatesPageSkeleton />
  if (!currentTeam) return <EmptyState mascot="group" title="尚未选择团队" />
  return <TemplateList key={currentTeam.id} teamId={currentTeam.id} write={role === 'admin' || role === 'developer'} />
}
