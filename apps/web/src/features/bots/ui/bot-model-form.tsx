import { useId, useState, type FormEvent } from 'react'
import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFormBody,
  DialogFormFooter,
  DialogFormHeader,
  DialogTitle,
} from '@/shared/ui/controls/dialog'
import { Select } from '@/shared/ui/controls/select'
import { useToast } from '@/shared/ui/toast'
import { botQueryKey, type BotView } from '../api/queries'
import { botCatalogOptions, botConnectionsOptions } from '../api/connections'

/** 允许团队管理员用目录中的可用模型更新智能体绑定。 */
export function BotModelForm({ bot, onClose }: { bot: BotView; onClose: () => void }) {
  const id = useId()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [connectionId, setConnectionId] = useState(bot.modelConnectionId ?? '')
  const [modelId, setModelId] = useState(bot.modelId ?? '')
  const connections = useQuery(botConnectionsOptions(bot.teamId))
  const available = connections.data?.data.filter((connection) => connection.status === 'active') ?? []
  const selected = available.find((connection) => connection.id === connectionId)
  const catalog = useQuery({ ...botCatalogOptions(bot.teamId, selected?.providerId), enabled: Boolean(selected) })
  const models = catalog.data?.data.filter((model) => selected && model.authTypes.includes(selected.authType)) ?? []
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.bindBotModel(
        bot.id,
        { connectionId, modelId, configVersion: bot.configVersion },
        {
          idempotencyKey: createIdempotencyKey(),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: botQueryKey })
      showToast('模型已绑定', 'success')
      onClose()
    },
  })
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selected && models.some((model) => model.modelId === modelId) && !mutation.isPending) mutation.mutate()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose()
      }}
    >
      <DialogContent layout="form">
        <DialogFormHeader>
          <DialogTitle>绑定模型</DialogTitle>
          <DialogDescription>从团队现有连接和提供方模型目录中选择。</DialogDescription>
        </DialogFormHeader>
        <form className="flex min-h-0 flex-col" onSubmit={submit}>
          <DialogFormBody className="space-y-4">
            <label className="field" htmlFor={`${id}-connection`}>
              <span>模型连接</span>
              <Select
                id={`${id}-connection`}
                value={selected?.id ?? ''}
                disabled={connections.isPending || connections.isError}
                onChange={(event) => {
                  setConnectionId(event.target.value)
                  setModelId('')
                }}
                required
              >
                <option value="">请选择可用连接</option>
                {available.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </label>
            {connections.isSuccess && available.length === 0 && (
              <p className="quiet small">在「连接与节点」添加可用模型连接。</p>
            )}
            <label className="field" htmlFor={`${id}-model`}>
              <span>模型</span>
              <Select
                id={`${id}-model`}
                value={modelId}
                disabled={!selected || catalog.isPending || catalog.isError}
                onChange={(event) => setModelId(event.target.value)}
                required
              >
                <option value="">请选择模型</option>
                {models.map((model) => (
                  <option key={model.modelId} value={model.modelId}>
                    {model.displayName}
                  </option>
                ))}
              </Select>
            </label>
            {(connections.isError || catalog.isError) && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (connections.isError) void connections.refetch()
                  if (catalog.isError) void catalog.refetch()
                }}
              >
                重试加载
              </Button>
            )}
            {mutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {describeRequestError(mutation.error).description}
              </p>
            )}
          </DialogFormBody>
          <DialogFormFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={onClose}>
              取消
            </Button>
            <Button
              type="submit"
              disabled={mutation.isPending || !selected || !models.some((model) => model.modelId === modelId)}
            >
              保存配置
            </Button>
          </DialogFormFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
