import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/features/identity/model/session'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { FormSectionSkeleton } from '@/shared/ui/page-skeleton'
import { botDetailQueryOptions } from '../api/queries'
import { BotForm } from './bot-form'
import { BotMemoryPanel } from './bot-memory-panel'
import { BotModelForm } from './bot-model-form'
import { BotToolAccess } from './bot-tool-access'

const INSTRUCTIONS_PREVIEW_LENGTH = 80

/**
 * 在会话侧栏汇总一位智能体的配置、工具权限与长期记忆，配置与模型在弹窗中编辑。
 * @param props Bot 标识与会话中的名称、当前成员标识、是否在标题中显示名称（群组有多位智能体时）与配置保存后的会话刷新回调。
 * @returns 只读摘要加编辑入口；基础配置可由开发者编辑，模型绑定仅对管理员开放，浏览者只读。
 */
export function BotSettingsPanel({
  botId,
  name,
  userId,
  showName = false,
  onChanged,
}: {
  botId: string
  name: string
  userId: string
  showName?: boolean
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
  const isAdmin = role === 'admin'
  const heading = showName ? `智能体 · ${bot?.name ?? name}` : '智能体'
  if (!bot)
    return (
      <section className="settings-section" aria-label={`智能体${name}`}>
        <div className="settings-section-row">
          <h4>{heading}</h4>
        </div>
        {query.isPending && <FormSectionSkeleton fields={2} label="智能体配置加载中" />}
        {query.isError && (
          <>
            <p className="field-error" role="alert">
              {describeRequestError(query.error).description}
            </p>
            <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>
              重试加载配置
            </Button>
          </>
        )}
      </section>
    )
  return (
    <>
      <section className="settings-section" aria-label={`智能体${bot.name}`}>
        <div className="settings-section-row">
          <h4>{heading}</h4>
          {canWrite && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing('config')}>
              编辑配置
            </Button>
          )}
        </div>
        <dl className="work-properties settings-properties">
          <dt>负责人</dt>
          <dd>{bot.ownerName ?? '未设置'}</dd>
          <dt>模型</dt>
          <dd className="settings-property-action">
            <span>
              {bot.modelId ?? '未绑定'}
              {bot.connectionName ? ` · ${bot.connectionName}` : ''}
            </span>
            {isAdmin && (
              <Button type="button" size="xs" variant="ghost" onClick={() => setEditing('model')}>
                更换
              </Button>
            )}
          </dd>
          <dt>技能</dt>
          <dd>{bot.skillIds.length ? `已配置 ${bot.skillIds.length} 个` : '未配置'}</dd>
          <dt>指令</dt>
          <dd>
            <ExpandableText text={bot.instructions} empty="未设置" />
          </dd>
          <dt>工具权限</dt>
          <dd>
            <BotToolAccess botId={bot.id} name={bot.name} canWrite={canWrite} />
          </dd>
        </dl>
        {editing === 'config' && (
          <BotForm bot={bot} teamId={bot.teamId} defaultOwnerId={userId} onClose={closeEditor} />
        )}
        {editing === 'model' && <BotModelForm bot={bot} onClose={closeEditor} />}
      </section>
      <BotMemoryPanel bot={bot} />
    </>
  )
}

function ExpandableText({ text, empty }: { text: string; empty: string }) {
  const [expanded, setExpanded] = useState(false)
  const content = text.trim()
  if (!content) return <span className="quiet">{empty}</span>
  const hasMore = content.length > INSTRUCTIONS_PREVIEW_LENGTH
  return (
    <div className="settings-expandable">
      <span>{hasMore && !expanded ? `${content.slice(0, INSTRUCTIONS_PREVIEW_LENGTH).trimEnd()}…` : content}</span>
      {hasMore && (
        <Button type="button" size="xs" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起' : '展开'}
        </Button>
      )}
    </div>
  )
}
