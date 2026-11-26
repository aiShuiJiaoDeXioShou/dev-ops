import { useState } from 'react'
import { createIdempotencyKey, type ApiSuccessData } from '@dev-ops/api-client'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChartNoAxesColumn } from 'lucide-react'
import { apiClient } from '@/shared/api/client'
import { describeRequestError } from '@/shared/api/errors'
import { Button } from '@/shared/ui/controls/button'
import { Input } from '@/shared/ui/controls/input'
import { Select } from '@/shared/ui/controls/select'
import { TableSkeleton } from '@/shared/ui/page-skeleton'
import { EmptyState, PageError } from '@/shared/ui/page-state'

type Usage = ApiSuccessData<'/api/v1/teams/{teamId}/bot-usage', 'get'>
const budgetPattern = /^(0|[1-9][0-9]{0,7})(\.[0-9]{1,4})?$/
const monthPattern = /^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/

function BudgetFields({ teamId, limit, canManage }: { teamId: string; limit: string | null; canManage: boolean }) {
  const client = useQueryClient()
  const [draft, setDraft] = useState<string>()
  const amount = draft ?? limit ?? ''
  const valid = !amount || budgetPattern.test(amount)
  const save = useMutation({
    mutationFn: () =>
      apiClient.updateBotBudget(
        teamId,
        { monthlyLimitUsd: amount || null },
        { idempotencyKey: createIdempotencyKey() },
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['bot-usage', teamId] })
      setDraft(undefined)
    },
  })
  return (
    <form
      className="card grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid && !save.isPending && canManage) save.mutate()
      }}
    >
      <h2>月度预算</h2>
      <div className="row flex-wrap items-end">
        <label className="field">
          <span>金额（USD）</span>
          <Input
            inputMode="decimal"
            maxLength={13}
            placeholder="不限额"
            value={amount}
            readOnly={!canManage || save.isPending}
            aria-invalid={!valid}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {canManage && (
          <Button
            type="submit"
            disabled={!valid || amount === (limit ?? '') || save.isPending}
            aria-busy={save.isPending}
          >
            {save.isPending ? '保存中…' : '保存预算'}
          </Button>
        )}
      </div>
      <p className="small muted">
        {canManage ? '留空表示不限额。' : '只有团队管理员可以修改预算。'}预算按 UTC 自然月计算。
      </p>
      {!valid && (
        <p role="status" className="field-error">
          请输入非负金额，最多八位整数和四位小数。
        </p>
      )}
      {save.isError && (
        <p role="alert" className="field-error">
          {describeRequestError(save.error).description}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" className="small muted">
          预算已保存。
        </p>
      )}
    </form>
  )
}

function Counts({ usage }: { usage: Usage['total'] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <div>
        <dt className="small muted">输入 Token</dt>
        <dd>{BigInt(usage.inputTokens).toLocaleString('zh-CN')}</dd>
      </div>
      <div>
        <dt className="small muted">输出 Token</dt>
        <dd>{BigInt(usage.outputTokens).toLocaleString('zh-CN')}</dd>
      </div>
      <div>
        <dt className="small muted">缓存读取</dt>
        <dd>{BigInt(usage.cacheReadTokens).toLocaleString('zh-CN')}</dd>
      </div>
      <div>
        <dt className="small muted">缓存写入</dt>
        <dd>{BigInt(usage.cacheWriteTokens).toLocaleString('zh-CN')}</dd>
      </div>
      <div>
        <dt className="small muted">已知费用</dt>
        <dd>{usage.costUsd} USD</dd>
      </div>
      {!usage.costKnown && (
        <div>
          <dt className="small muted">费用未知</dt>
          <dd>{usage.unknownCostRuns} 次运行</dd>
        </div>
      )}
    </dl>
  )
}

/**
 * 展示团队的月度用量、按智能体或日期汇总的费用与预算表单。
 * @param props.teamId 当前团队标识。
 * @param props.canManage 是否允许修改预算。
 * @returns 用量与预算区块；查询失败支持重试，分页加载保留已有记录。
 */
export function BotUsage({ teamId, canManage }: { teamId: string; canManage: boolean }) {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const [botId, setBotId] = useState('')
  const [group, setGroup] = useState<'bot' | 'day'>('bot')
  const list = useInfiniteQuery({
    queryKey: ['bot-usage', teamId, month, botId],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) =>
      apiClient.getBotUsage(
        teamId,
        { month: month || undefined, botId: botId || undefined, botCursor: pageParam || undefined },
        { signal },
      ),
    getNextPageParam: ({ data }) => data.nextBotCursor ?? undefined,
  })
  const data = list.data?.pages[0]?.data
  const bots = list.data?.pages.flatMap(({ data }) => data.byBot) ?? []
  const rows =
    group === 'bot'
      ? bots.map((row) => ({ id: row.botId, label: row.name, usage: row }))
      : (data?.byDay ?? []).map((row) => ({ id: row.date, label: row.date, usage: row }))
  return (
    <div className="grid content-start gap-4">
      <header className="work-header">
        <h2>用量与预算</h2>
      </header>
      <div className="row flex-wrap items-end">
        <label className="field">
          <span>统计月份</span>
          <Input
            type="month"
            min="1000-01"
            value={month}
            onChange={(event) => {
              const value = event.target.value
              if (monthPattern.test(value)) {
                setMonth(value)
                setBotId('')
              }
            }}
          />
        </label>
        <label className="field">
          <span>统计方式</span>
          <Select
            value={group}
            onChange={(event) => {
              const group = event.target.value === 'day' ? 'day' : 'bot'
              setGroup(group)
              if (group === 'bot') setBotId('')
            }}
          >
            <option value="bot">按 Bot</option>
            <option value="day">按日</option>
          </Select>
        </label>
        {group === 'day' && (
          <label className="field">
            <span>智能体</span>
            <Select value={botId} onChange={(event) => setBotId(event.target.value)}>
              <option value="">全部智能体</option>
              {bots.map(({ botId, name }) => (
                <option key={botId} value={botId}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
        )}
        {list.hasNextPage && (
          <Button
            type="button"
            variant="ghost"
            disabled={list.isFetchingNextPage}
            onClick={() => void list.fetchNextPage()}
          >
            {list.isFetchingNextPage ? '加载中…' : '加载更多智能体'}
          </Button>
        )}
      </div>
      {list.isPending && <TableSkeleton rows={4} columns={['34%', '22%', '22%', '22%']} label="用量加载中" />}
      {list.isError && (
        <PageError
          title="用量加载失败"
          error={list.error}
          retrying={list.isFetching}
          onRetry={() => void list.refetch()}
        />
      )}
      {data && (
        <>
          <BudgetFields teamId={teamId} canManage={canManage} limit={data.monthlyLimitUsd} />
          <section className="card grid gap-3">
            <h2>{data.month} 团队用量</h2>
            <Counts usage={data.total} />
          </section>
        </>
      )}
      {list.isSuccess && !rows.length && (
        <EmptyState icon={<ChartNoAxesColumn />} title={botId ? '此智能体本月没有用量' : '本月没有用量'} />
      )}
      <ul className="grid gap-3">
        {rows.map(({ id, label, usage }) => (
          <li className="card grid gap-3" key={id}>
            <h3 className="wrap-break-word">{label}</h3>
            <Counts usage={usage} />
          </li>
        ))}
      </ul>
    </div>
  )
}
