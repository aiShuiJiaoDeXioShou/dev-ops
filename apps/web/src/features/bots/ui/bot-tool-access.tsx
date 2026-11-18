import { createIdempotencyKey } from '@dev-ops/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Select } from '@/shared/ui/controls/select'
import { botDetailQueryOptions, botQueryKey } from '../api/queries'

/**
 * 在会话侧栏设置一位智能体的本地工具权限。
 * @param props 当前会话中智能体的标识与名称。
 * @returns 可重试的权限设置，保存后对后续运行生效并停止旧权限运行。
 */
export function BotToolAccess({ botId, name }: { botId: string; name: string }) {
  const client = useQueryClient()
  const query = useQuery(botDetailQueryOptions(botId))
  const bot = query.data?.data
  const save = useMutation({
    mutationFn: (accessMode: 'sandbox' | 'full') => {
      if (!bot) throw new Error('智能体配置尚未加载')
      return apiClient.setBotAccess(
        botId,
        { configVersion: bot.configVersion, accessMode },
        { idempotencyKey: createIdempotencyKey() },
      )
    },
    onSuccess: async (result) => {
      client.setQueryData(botDetailQueryOptions(botId).queryKey, result)
      await client.invalidateQueries({ queryKey: botQueryKey })
    },
    onError: () => client.invalidateQueries({ queryKey: botDetailQueryOptions(botId).queryKey }),
  })
  return (
    <div className="work-gap">
      <label className="field">
        <span>{name} · 工具访问权限</span>
        <Select
          value={bot?.accessMode ?? 'sandbox'}
          disabled={!bot || save.isPending}
          onChange={(event) => {
            const mode = event.target.value
            if (mode === 'sandbox' || mode === 'full') save.mutate(mode)
          }}
        >
          <option value="sandbox">沙盒 · 仅 Bot 工作目录</option>
          <option value="full">完全访问</option>
        </Select>
      </label>
      <p className="small quiet">
        {bot?.accessMode === 'full'
          ? '允许工具访问执行主机上的其他目录。'
          : '文件与命令工具仅可访问该 Bot 的独立工作目录。'}
      </p>
      {query.isPending && (
        <p className="small quiet" role="status">
          正在加载权限…
        </p>
      )}
      {save.isPending && (
        <p className="small quiet" role="status">
          正在保存权限…
        </p>
      )}
      {(query.isError || save.isError) && (
        <p className="field-error" role="alert">
          {describeRequestError(query.error ?? save.error).description}
        </p>
      )}
      {query.isError && (
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>
          重试加载权限
        </Button>
      )}
    </div>
  )
}
