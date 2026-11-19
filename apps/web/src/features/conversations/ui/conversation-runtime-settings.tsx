import { useState } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { botCatalogOptions, botConnectionsOptions } from '@/features/bots/api/connections'
import { botDetailQueryOptions } from '@/features/bots/api/queries'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import { conversationOptions, type BotConversation } from '../api/queries'

const levels = {
  off: '关闭',
  minimal: '极低',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}
type Thinking = keyof typeof levels

function isThinking(value: string): value is Thinking {
  return Object.hasOwn(levels, value)
}

type Props = {
  room: BotConversation
  botId: string
  name: string
  readOnly: boolean
  busy: boolean
}

/**
 * 展示并配置单个 Bot 的会话级覆盖，通过运行队列请求会话压缩。
 * @param props 当前会话与 Bot、写权限和活动运行状态。
 * @returns 会话级模型、思考等级和压缩控件。
 */
export function ConversationRuntimeSettings({ room, botId, name, readOnly, busy }: Props) {
  const setting = room.botSettings?.find((item) => item.botId === botId)
  const client = useQueryClient()
  const bot = useQuery(botDetailQueryOptions(botId))
  const connections = useQuery({ ...botConnectionsOptions(room.teamId), enabled: !readOnly })
  const connection = connections.data?.data.find(({ id }) => id === bot.data?.data.modelConnectionId)
  const providerId = connection?.providerId
  const models = useQuery({ ...botCatalogOptions(room.teamId, providerId), enabled: Boolean(providerId) && !readOnly })
  const [draft, setDraft] = useState<{ modelId: string; thinking: Thinking | '' }>()
  const modelId = draft?.modelId ?? setting?.modelId ?? ''
  const thinking = draft?.thinking ?? setting?.thinkingLevel ?? ''
  const changed = modelId !== (setting?.modelId ?? '') || thinking !== (setting?.thinkingLevel ?? '')
  const save = useMutation({
    mutationFn: () =>
      apiClient.updateBotSessionSettings(
        room.id,
        botId,
        { modelId: modelId || null, thinkingLevel: thinking || null },
        { idempotencyKey: createIdempotencyKey() },
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: conversationOptions(room.id).queryKey })
      setDraft(undefined)
    },
  })
  const compact = useMutation({
    mutationFn: () => apiClient.compactBotConversation(room.id, botId, { idempotencyKey: createIdempotencyKey() }),
  })
  const values = models.data?.data.filter((model) => connection && model.authTypes.includes(connection.authType)) ?? []
  const error = save.error ?? compact.error
  const pending = save.isPending || compact.isPending
  return (
    <section
      className="settings-section"
      aria-label={`${name}的会话运行设置`}
      data-settings-pending={pending}
      data-settings-dirty={changed}
    >
      <h4 className="font-semibold">{room.kind === 'group' ? `${name}的会话运行设置` : '会话运行设置'}</h4>
      <p className="small muted">
        实际生效模型 {(setting?.isOverrideValid && setting.modelId) || bot.data?.data.modelId || '未配置'}
      </p>
      <p className="small muted">
        实际思考等级{' '}
        {setting?.effectiveThinkingLevel === 'max'
          ? '最高'
          : setting?.effectiveThinkingLevel
            ? levels[setting.effectiveThinkingLevel]
            : '运行后显示'}
      </p>
      {setting?.isOverrideValid === false && <p role="status">覆盖模型已失效，运行将沿用 Bot 的默认模型。</p>}
      {!readOnly && (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (changed && !pending) save.mutate()
          }}
        >
          <label className="field">
            <span>会话模型</span>
            <Select
              value={modelId}
              onChange={(event) => setDraft({ modelId: event.target.value, thinking })}
              disabled={pending || models.isFetching}
            >
              <option value="">沿用默认模型</option>
              {modelId && !values.some((model) => model.modelId === modelId) && (
                <option value={modelId}>{modelId}</option>
              )}
              {values.map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.displayName}
                </option>
              ))}
            </Select>
          </label>
          <label className="field">
            <span>思考等级</span>
            <Select
              value={thinking}
              disabled={pending}
              onChange={(event) => {
                const value = event.target.value
                setDraft({ modelId, thinking: isThinking(value) ? value : '' })
              }}
            >
              <option value="">沿用默认等级</option>
              {Object.entries(levels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <div className="row flex-wrap">
            <Button type="submit" size="sm" disabled={pending || !changed} aria-busy={save.isPending}>
              {save.isPending ? '保存中…' : '保存运行设置'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || pending || !bot.data?.data.modelId}
              aria-busy={compact.isPending}
              onClick={() => compact.mutate()}
            >
              {compact.isPending ? '排队中…' : '压缩会话'}
            </Button>
          </div>
          {save.isSuccess && !changed && (
            <p role="status" className="small muted">
              运行设置已保存。
            </p>
          )}
          {compact.isSuccess && (
            <p className="small muted" role="status">
              压缩已排队，可在轨迹查看进度。
            </p>
          )}
          {(bot.isError || connections.isError || models.isError) && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (bot.isError) void bot.refetch()
                if (connections.isError) void connections.refetch()
                if (models.isError) void models.refetch()
              }}
            >
              重试加载模型
            </Button>
          )}
          {error && (
            <p className="field-error" role="alert">
              {describeRequestError(error).description}
            </p>
          )}
        </form>
      )}
    </section>
  )
}
