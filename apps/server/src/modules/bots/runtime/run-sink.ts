import { botSession, botSessionEntry } from '../bots.session.tables.ts'
import { containsCredential, type RunEvent, type RunOutcome } from '@dev-ops/devops-bot'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Database } from '../../../platform/database/client.ts'
import { defaultBotRelayLimits, relayMentionableBots } from '../../collaboration/bot-relay.repository.ts'
import { appendBotEvents } from '../../collaboration/bot-events.repository.ts'
import { botConversation, botEvent, botMessage } from '../../collaboration/bot-conversations.tables.ts'
import type { BotMessageBody } from '../../collaboration/bot-message-body.ts'
import {
  finishBotRun,
  lockBotRunLease,
  type BotRunLease,
  type ConversationBotRunRecord,
} from '../bots.run-queue.repository.ts'

const EVENT_WRITE_INTERVAL_MS = 300
const EVENT_BATCH_LIMIT = 100
const REDACTED = '[内容含疑似凭据，已隐藏]'

function safeText(text: string): string {
  return containsCredential(text) ? REDACTED : text
}

function savedEvent(event: Exclude<RunEvent, { type: 'turn_finished' }>, botId: string) {
  const order = { run_sequence: event.seq, created_at: new Date() }
  switch (event.type) {
    case 'output_delta':
      return { ...order, kind: 'output_delta', payload: { text: safeText(event.payload.text) } }
    case 'tool_started':
      return { ...order, kind: 'tool_activity', payload: { state: 'started', ...event.payload } }
    case 'tool_finished':
      return { ...order, kind: 'tool_activity', payload: { state: 'finished', ...event.payload } }
    case 'model_selected':
      return { ...order, kind: 'tool_activity', payload: { state: 'model_selected', botId, ...event.payload } }
    case 'memory_written':
      return { ...order, kind: 'tool_activity', payload: { state: 'memory_written', ...event.payload } }
    default:
      return { ...order, kind: event.type, payload: event.payload }
  }
}

async function relayMentions(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  scope: { teamId: string; conversationId: string },
  outcome: Extract<RunOutcome, { status: 'succeeded' }>,
) {
  if (outcome.skipped) return []
  const text = outcome.finalMessage.blocks.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
  if (!text.includes('@')) return outcome.mentions ?? []
  const bots = await relayMentionableBots(tx, scope)
  const names = bots
    .flatMap(({ id, name }) => {
      const label = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      const match = new RegExp(`(?:^|\\s)@${label}(?=$|[\\s，。,.!?；;:：、！？])`, 'iu').exec(text)
      return match ? [{ id, index: match.index }] : []
    })
    .sort((a, b) => a.index - b.index)
    .map(({ id }) => id)
  return [...new Set([...(outcome.mentions ?? []), ...names])]
}

/**
 * 将运行事件合批写入 PostgreSQL，最终消息与运行终态使用同一事务。
 * @param db 数据库连接。
 * @param run 当前运行持有的队列记录。
 * @param lease 领取者与代次凭证。
 * @param onBatchFailure 异步刷新失败时中止模型调用的回调。
 * @param relayLimits 群聊接力可用的跳数与回复条数。
 * @returns 运行事件接收器和终态提交方法。
 */
export function createPgRunSink(
  db: Database,
  run: ConversationBotRunRecord,
  lease: BotRunLease,
  onBatchFailure: () => void,
  relayLimits = defaultBotRelayLimits,
) {
  const scope = { teamId: run.team_id, conversationId: run.conversation_id, runId: run.id }
  const buffer: ReturnType<typeof savedEvent>[] = []
  let timer: NodeJS.Timeout | undefined
  let writes = Promise.resolve()
  let sequenceOffset: number | undefined

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer)
    timer = undefined
    const batch = buffer.splice(0)
    if (batch.length === 0) return writes
    writes = writes.then(() =>
      db.transaction(async (tx) => {
        if (!(await lockBotRunLease(tx, lease))) throw new Error('Bot 运行租约已失效')
        if (sequenceOffset === undefined) {
          const [previous] = await tx
            .select({ sequence: sql<number>`coalesce(max(${botEvent.run_sequence}), 0)` })
            .from(botEvent)
            .where(and(eq(botEvent.team_id, scope.teamId), eq(botEvent.run_id, run.id)))
          sequenceOffset = previous?.sequence ?? 0
        }
        const offset = sequenceOffset
        await appendBotEvents(
          tx,
          scope,
          batch.map((event) => ({ ...event, run_sequence: event.run_sequence + offset })),
        )
      }),
    )
    return writes
  }

  return {
    /**
     * 收集脱敏事件，短间隔批量提交。
     * @param event 库输出的事件。最终状态由 finish 统一提交。
     * @returns 写入缓冲后完成；达到批次上限时等待写入。
     */
    async emit(event: RunEvent): Promise<void> {
      if (event.type === 'turn_finished') return
      buffer.push(savedEvent(event, run.bot_id))
      if (buffer.length >= EVENT_BATCH_LIMIT) return flush()
      timer ??= setTimeout(() => {
        void flush().catch(onBatchFailure)
      }, EVENT_WRITE_INTERVAL_MS)
    },
    /** 提交当前事件批次并等待先前批次，写入异常向上传播。 */
    flush,
    /**
     * 写入用量、运行终态和助手最终消息。
     * @param outcome 模型运行结果，含安全的失败摘要和测得的用量。
     * @returns 写入成功时为 true；运行代次失效时为 false。
     */
    async finish(outcome: RunOutcome): Promise<boolean> {
      await flush()
      return db.transaction(async (tx) => {
        // 所有消息操作先锁会话行，保证队列回复与新输入使用同一个消息序列。
        const [conversation] = await tx
          .select({ id: botConversation.id, branchId: botConversation.active_branch_id })
          .from(botConversation)
          .where(and(eq(botConversation.id, scope.conversationId), eq(botConversation.team_id, scope.teamId)))
          .for('update')
        const mentions =
          outcome.status === 'succeeded' && run.relay_id ? await relayMentions(tx, scope, outcome) : undefined
        const finished = await finishBotRun(tx, lease, { ...outcome, mentions, relayLimits })
        if (!finished) return false
        const shouldReply =
          finished.status === 'succeeded' &&
          outcome.status === 'succeeded' &&
          !outcome.skipped &&
          run.kind !== 'compact'
        const shouldExplain = Boolean(run.relay_id) && finished.failure_kind === 'model_unavailable'
        if (!shouldReply && !shouldExplain) return true
        if (!conversation) throw new Error('Bot 回复所属会话不存在')
        const [latest] = await tx
          .select({ sequence: botMessage.sequence })
          .from(botMessage)
          .where(and(eq(botMessage.team_id, scope.teamId), eq(botMessage.conversation_id, scope.conversationId)))
          .orderBy(desc(botMessage.sequence))
          .limit(1)
        const body: BotMessageBody = shouldReply
          ? {
              metrics: {
                ...outcome.usage,
                turns: outcome.turns,
                durationMs: Math.max(0, Date.now() - (run.started_at ?? run.created_at).getTime()),
              },
              blocks: outcome.finalMessage.blocks.flatMap<BotMessageBody['blocks'][number]>((block) => {
                if (block.type !== 'text') return []
                return [{ type: 'text', text: safeText(block.text) }]
              }),
            }
          : { blocks: [{ type: 'notice', text: '本轮接力跳过了一位不可用的智能体。' }] }
        const [message] = await tx
          .insert(botMessage)
          .values({
            team_id: scope.teamId,
            conversation_id: scope.conversationId,
            run_id: run.id,
            branch_id: conversation.branchId,
            sequence: (latest?.sequence ?? 0n) + 1n,
            speaker_kind: shouldReply ? 'bot' : 'system',
            speaker_id: shouldReply ? run.bot_id : null,
            relay_id: run.relay_id,
            body,
          })
          .returning({ id: botMessage.id, sequence: botMessage.sequence })
        if (!message) throw new Error('未能提交 Bot 回复')
        const [tree] = await tx
          .select({ id: botSession.id, leaf: botSession.leaf_entry_id })
          .from(botSession)
          .where(
            and(
              eq(botSession.team_id, scope.teamId),
              eq(botSession.conversation_id, scope.conversationId),
              eq(botSession.bot_id, run.bot_id),
            ),
          )
        if (tree?.leaf && shouldReply) {
          await tx
            .update(botSessionEntry)
            .set({ source_message_id: message.id, updated_at: new Date() })
            .where(
              and(
                eq(botSessionEntry.team_id, scope.teamId),
                eq(botSessionEntry.session_id, tree.id),
                eq(botSessionEntry.entry_id, tree.leaf),
                eq(botSessionEntry.run_id, run.id),
                sql`${botSessionEntry.source_message_id} is null`,
              ),
            )
        }

        await tx
          .update(botConversation)
          .set({
            last_message_at: sql`clock_timestamp()`,
            updated_at: sql`clock_timestamp()`,
          })
          .where(eq(botConversation.id, conversation.id))
        await appendBotEvents(tx, scope, [
          {
            kind: 'message_committed',
            payload: { id: message.id, sequence: message.sequence.toString() },
          },
        ])
        return true
      })
    },
  }
}
