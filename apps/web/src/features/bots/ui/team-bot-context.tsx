import { useState } from 'react'
import { createIdempotencyKey, type ApiSuccessData } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/controls/button'
import { Textarea } from '@/shared/ui/controls/textarea'
import { DelayedPageSkeleton } from '@/shared/ui/page-skeleton'
import { PageError } from '@/shared/ui/page-state'

type Context = ApiSuccessData<'/api/v1/teams/{teamId}/bot-context', 'get'>
const maxBytes = 16_384

function ContextForm({ teamId, isAdmin }: { teamId: string; isAdmin: boolean }) {
  const client = useQueryClient()
  const key = ['team-bot-context', teamId]
  const details = useQuery({ queryKey: key, queryFn: ({ signal }) => apiClient.getTeamBotContext(teamId, { signal }) })
  const [draft, setDraft] = useState<Pick<Context, 'content' | 'version'>>()
  const value = draft?.content ?? details.data?.data.content ?? ''
  const size = new TextEncoder().encode(value).length
  const save = useMutation({
    mutationFn: (input: Pick<Context, 'content' | 'version'>) =>
      apiClient.updateTeamBotContext(teamId, input, { idempotencyKey: createIdempotencyKey() }),
    onSuccess: (result) => {
      client.setQueryData(key, result)
      setDraft(undefined)
    },
  })
  if (details.isPending) return <DelayedPageSkeleton />
  if (!details.data)
    return (
      <PageError
        title="团队上下文加载失败"
        error={details.error}
        retrying={details.isFetching}
        onRetry={() => void details.refetch()}
      />
    )
  const { data } = details.data
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (draft && size <= maxBytes && !save.isPending) save.mutate(draft)
      }}
    >
      <Textarea
        aria-labelledby="team-context-title"
        rows={8}
        value={value}
        readOnly={!isAdmin || save.isPending}
        aria-invalid={size > maxBytes}
        aria-describedby="team-context-description bot-context-size"
        className="min-h-36 resize-y"
        placeholder={isAdmin ? '填写 Bot 在本团队中应遵循的约定' : '尚未配置团队上下文'}
        onChange={(event) => setDraft({ content: event.target.value, version: draft?.version ?? data.version })}
      />
      <div className="row flex-wrap">
        <span className={size > maxBytes ? 'small field-error' : 'small muted'} id="bot-context-size">
          {size.toLocaleString('zh-CN')} / {maxBytes.toLocaleString('zh-CN')} 字节
        </span>
        {data.updatedAt && (
          <time className="small muted" dateTime={data.updatedAt}>
            更新于 {formatDateTime(data.updatedAt)}
          </time>
        )}
        <span className="spacer" />
        {isAdmin && (
          <Button
            type="submit"
            className="max-md:min-h-11"
            aria-busy={save.isPending}
            disabled={!draft || value === data.content || size > maxBytes || save.isPending}
          >
            {save.isPending ? '保存中…' : '保存上下文'}
          </Button>
        )}
      </div>
      {save.isError && (
        <div className="row flex-wrap">
          <p role="alert" className="field-error">
            {describeRequestError(save.error).description}
          </p>
          <Button
            type="button"
            variant="ghost"
            disabled={details.isFetching}
            onClick={async () => {
              const fresh = await details.refetch()
              if (!fresh.isSuccess) return
              // 从服务器核对最新内容和版本，保留草稿供管理员重新确认。
              setDraft((previous) => previous && { ...previous, version: fresh.data.data.version })
              save.reset()
            }}
          >
            读取最新版本
          </Button>
        </div>
      )}
      {draft && draft.version === data.version && save.isIdle && value !== data.content && data.version > 0 && (
        <p className="small muted">保存后会替换当前团队指令。</p>
      )}
      {save.isSuccess && !draft && (
        <p role="status" className="small muted">
          已保存。
        </p>
      )}
    </form>
  )
}

/**
 * 展示团队共用的 Agent 指令及版本化编辑表单。
 * @param props.teamId 当前团队标识。
 * @param props.canManage 是否允许保存团队指令。
 * @returns 团队上下文区块；查询或保存失败时保留重试入口与草稿。
 */
export function TeamBotContext({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  return (
    <section className="settings-form-width grid gap-3" aria-label="团队上下文">
      <header className="settings-heading">
        <div>
          <h2 id="team-context-title">团队共用指令</h2>
          <p id="team-context-description" className="mt-1 text-sm text-muted-foreground">
            适用于本团队的 Bot，用于补充团队共用约定。
          </p>
        </div>
      </header>
      <ContextForm key={teamId} teamId={teamId} isAdmin={canManage} />
    </section>
  )
}
