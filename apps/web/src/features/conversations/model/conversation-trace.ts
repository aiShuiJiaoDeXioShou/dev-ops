import { conversationEventText, type ConversationEvents, type ConversationMessage } from '../api/queries'

export type ConversationRun = {
  id: string
  text: string
  name: string
  botId?: string
  status?: string
  statusText?: string
  createdAt?: string
  startedAt?: string
  finishedAt?: string
  stopRequested?: boolean
  input?: ConversationMessage
  reply?: ConversationMessage
}

export const traceLanes = { input: '输入与状态', model: '模型输出', tool: '工具调用' }
export const traceStatuses = {
  done: '已完成',
  running: '进行中',
  failed: '失败',
  interrupted: '已中断',
  pending: '等待',
  unknown: '结果未知',
}

export type TraceStep = {
  id: string
  kind: keyof typeof traceLanes
  title: string
  status: keyof typeof traceStatuses
  at: string
  endAt?: string
  text?: string
  note?: string
  target?: string
  code?: string
  sequence?: string
}

const statusSteps = {
  queued: { title: '等待执行', status: 'pending' },
  running: { title: '开始运行', status: 'done' },
  succeeded: { title: '运行完成', status: 'done' },
  failed: { title: '执行失败', status: 'failed' },
  stopped: { title: '已停止生成', status: 'interrupted' },
} satisfies Record<string, Pick<TraceStep, 'title' | 'status'>>

function isRunStatus(value: string | undefined): value is keyof typeof statusSteps {
  return value !== undefined && Object.hasOwn(statusSteps, value)
}

function flag(value: unknown, key: string) {
  return value !== null && typeof value === 'object' && Reflect.get(value, key) === true
}

function messageText(message: ConversationMessage) {
  return message.body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n\n')
}

function mergeAudit(steps: TraceStep[], audit: TraceStep[]) {
  const tools = steps.filter(({ kind }) => kind === 'tool')
  for (const record of audit) {
    const candidates = tools.filter((step) => step.title === record.title)
    const matchingCall = candidates.find(
      (step) =>
        step.id === record.id ||
        (step.title === record.title &&
          !step.target &&
          step.endAt &&
          Date.parse(step.at) <= Date.parse(record.at) &&
          Date.parse(record.at) <= Date.parse(step.endAt)),
    )
    // 旧 Worker 批量落库时，审计时间可能早于调用开始。仅在同名记录一一对应时合并。
    const uniqueCall = candidates.length === 1 && audit.filter((item) => item.title === record.title).length === 1
    const call = matchingCall ?? (uniqueCall ? candidates[0] : undefined)
    if (call) {
      call.target = record.target
      call.code = record.code
      if (record.status !== 'done') call.status = record.status
    } else {
      steps.push({ ...record, title: record.target ?? record.title })
    }
  }
}

/**
 * 按记录还原一次运行，包括输入、状态、连续的模型输出与工具操作。
 * @param run 当前运行以及已载入的会话消息。
 * @param events 分页读取的事件，按会话事件序号排列。
 * @returns 时间顺序的步骤。历史事件缺少起止时间时仅展示已记录的时间。
 */
export function traceSteps(
  run: Pick<ConversationRun, 'id' | 'status' | 'input' | 'reply'>,
  events: ConversationEvents['items'],
): TraceStep[] {
  const steps: TraceStep[] = []
  if (run.input) {
    steps.push({
      id: 'input',
      kind: 'input',
      title: '收到消息',
      status: 'done',
      at: run.input.createdAt,
      text: messageText(run.input),
      note: run.input.speakerName ?? undefined,
    })
  }
  const tools = new Map<string, TraceStep>()
  const audit: TraceStep[] = []
  let output: TraceStep | undefined
  let hasOutput = false
  let previousStatus: string | undefined
  for (const { sequence, kind, payload, createdAt: at, runId } of events) {
    if (runId !== run.id) continue
    const base = { id: `event-${sequence}`, sequence, at }
    if (kind === 'output_delta') {
      const text = conversationEventText(payload, 'text')
      if (!text) continue
      if (output) {
        output.text = (output.text ?? '') + text
        output.endAt = at
      } else {
        output = { ...base, kind: 'model', title: '模型输出', status: 'done', text }
        steps.push(output)
        hasOutput = true
      }
    }
    if (kind === 'run_status') {
      const status = conversationEventText(payload, 'status')
      if (!isRunStatus(status)) continue
      const stopping = status === 'running' && flag(payload, 'stopRequested')
      const key = stopping ? 'stopping' : status
      if (key === previousStatus) continue
      previousStatus = key
      const state = statusSteps[status]
      if (output) output.status = state.status === 'pending' ? 'done' : state.status
      output = undefined
      steps.push({
        ...base,
        kind: 'input',
        title: stopping ? '正在停止…' : state.title,
        status: stopping ? 'running' : status === 'queued' && run.status !== 'queued' ? 'done' : state.status,
        note: conversationEventText(payload, 'failureMessage'),
      })
    }
    if (kind !== 'tool_activity') continue
    const state = conversationEventText(payload, 'state')
    if (state === 'memory_written') {
      steps.push({ ...base, kind: 'tool', title: '记忆已更新', status: 'done' })
      continue
    }
    const title = conversationEventText(payload, 'name') ?? '工具调用'
    const callId = conversationEventText(payload, 'callId') ?? sequence
    const tool = { ...base, id: `tool-${callId}`, kind: 'tool' as const, title }
    if (state === 'started') {
      output = undefined
      tools.set(callId, { ...tool, status: run.status === 'running' ? 'running' : 'interrupted' })
    } else if (state === 'finished') {
      output = undefined
      const start = tools.get(callId)
      const status = flag(payload, 'ok') ? 'done' : 'failed'
      tools.set(callId, start ? { ...start, status, endAt: at } : { ...tool, status })
    } else if (state) {
      const target = [conversationEventText(payload, 'method'), conversationEventText(payload, 'path')]
        .filter(Boolean)
        .join(' ')
      audit.push({
        ...tool,
        target: target || undefined,
        code: conversationEventText(payload, 'code'),
        status: state === 'succeeded' ? 'done' : state === 'unknown' ? 'unknown' : 'failed',
      })
    }
  }
  if (output && run.status === 'running') output.status = 'running'
  if (!hasOutput && run.reply) {
    steps.push({
      id: 'reply',
      kind: 'model',
      title: '助手回复',
      status: 'done',
      at: run.reply.createdAt,
      text: messageText(run.reply),
    })
  }
  steps.push(...tools.values())
  mergeAudit(steps, audit)
  return steps.sort((a, b) => {
    const difference = Date.parse(a.at) - Date.parse(b.at)
    if (difference) return difference
    const left = BigInt(a.sequence ?? '0')
    const right = BigInt(b.sequence ?? '0')
    return left === right ? 0 : left < right ? -1 : 1
  })
}
