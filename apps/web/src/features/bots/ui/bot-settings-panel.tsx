import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/features/identity/model/session'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { botDetailQueryOptions } from '../api/queries'
import { BotForm } from './bot-form'
import { BotMemoryPanel } from './bot-memory-panel'
import { BotModelForm } from './bot-model-form'

/**
 * 在会话侧栏内编辑 Bot 配置、模型绑定与长期记忆。
 * @param props Bot 标识、当前成员标识与配置编辑结束后的会话刷新回调。
 * @returns 直接调用现有配置接口的内嵌表单；基础配置可由开发者编辑，模型绑定仅对管理员开放。
 */
export function BotSettingsPanel({
  botId,
  userId,
  onChanged,
}: {
  botId: string
  userId: string
  onChanged: () => void
}) {
  const { role } = useSession()
  const query = useQuery(botDetailQueryOptions(botId))
  const [editing, setEditing] = useState<'config' | 'model'>()
  const bot = query.data?.data
  const closeEditor = () => {
    setEditing(undefined)
    onChanged()
  }
  const canWrite = role === 'admin' || role === 'developer'
  if (!bot)
    return (
      <section className="settings-section">
        {query.isPending && <p role="status">正在加载智能体配置…</p>}
        {query.isError && (
          <>
            <p className="field-error" role="alert">
              {describeRequestError(query.error).description}
            </p>
            <Button type="button" variant="outline" onClick={() => void query.refetch()}>
              重试加载配置
            </Button>
          </>
        )}
      </section>
    )
  return (
    <>
      <section className="settings-section" aria-label={`${bot.name}的配置`}>
        <div className="row">
          <strong>智能体配置</strong>
          <span className="spacer" />
          {canWrite && !editing && (
            <Button type="button" variant="ghost" onClick={() => setEditing('config')}>
              编辑配置
            </Button>
          )}
        </div>
        {editing === 'config' ? (
          <div className="pt-3">
            <BotForm inline bot={bot} teamId={bot.teamId} defaultOwnerId={userId} onClose={closeEditor} />
          </div>
        ) : editing === 'model' ? (
          <div className="pt-3">
            <BotModelForm inline bot={bot} onClose={closeEditor} />
          </div>
        ) : (
          <>
            <p>
              {bot.name} · {bot.responsibility}
            </p>
            <p>负责人：{bot.ownerName ?? '未设置'}</p>
            <p>
              模型：{bot.modelId ?? '未绑定'}
              {bot.connectionName ? ` · ${bot.connectionName}` : ''}
            </p>
            {role === 'admin' && (
              <Button type="button" variant="outline" onClick={() => setEditing('model')}>
                修改模型
              </Button>
            )}
          </>
        )}
      </section>
      <BotMemoryPanel bot={bot} canWrite={canWrite} isAdmin={role === 'admin'} />
    </>
  )
}
