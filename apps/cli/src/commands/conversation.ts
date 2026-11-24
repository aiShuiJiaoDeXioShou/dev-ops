import type { Command } from 'commander'
import { apiAction, checkedQuery, jsonAction, queryAction, writeOptions } from '../lib/api-command.ts'
import type { CliContext } from '../lib/context.ts'
import { CliError } from '../lib/errors.ts'
import { pollInterval, withPolling, withWaitTimeout } from '../lib/follow.ts'

function registerMessages(group: Command, context: CliContext) {
  queryAction(
    group.command('messages').description('按游标查询会话消息').argument('<conversationId>', '会话 ID'),
    context,
    '/api/v1/bot-conversations/{conversationId}/messages',
    ({ business, arg }, query) => business.client.listBotMessages(arg(), query),
    'nextBefore',
  )
  jsonAction(
    group
      .command('send')
      .description('发送消息，支持提及、提示模板和运行中追加')
      .argument('<conversationId>', '会话 ID'),
    context,
    '/api/v1/bot-conversations/{conversationId}/messages',
    ({ business, arg }, body, write) => business.client.sendBotMessage(arg(), body, write),
  )
  jsonAction(
    group
      .command('edit-resend')
      .description('编辑私聊中的消息并重新生成')
      .argument('<conversationId>', '会话 ID')
      .argument('<messageId>', '消息 ID'),
    context,
    '/api/v1/bot-conversations/{conversationId}/messages/{messageId}/edit-resend',
    ({ business, arg }, body, write) => business.client.editBotMessage(arg(), arg(1), body, write),
  )
  jsonAction(
    group
      .command('feedback')
      .description('提交回复评价')
      .argument('<conversationId>', '会话 ID')
      .argument('<messageId>', '消息 ID'),
    context,
    '/api/v1/bot-conversations/{conversationId}/messages/{messageId}/feedback',
    ({ business, arg }, body, write) => business.client.rateBotMessage(arg(), arg(1), body, write),
  )
  jsonAction(
    group.command('switch-branch').description('切换消息分支').argument('<conversationId>', '会话 ID'),
    context,
    '/api/v1/bot-conversations/{conversationId}/branches/switch',
    ({ business, arg }, body, write) => business.client.switchBotConversationBranch(arg(), body, write),
  )
  jsonAction(
    group.command('fork').description('从现有消息派生一个会话').argument('<conversationId>', '会话 ID'),
    context,
    '/api/v1/bot-conversations/{conversationId}/fork',
    ({ business, arg }, body, write) => business.client.forkBotConversation(arg(), body, write),
  )
}

function registerQueuedInputs(group: Command, context: CliContext) {
  apiAction(
    group.command('usage').description('读取当前会话累计用量与费用').argument('<conversationId>', '会话 ID'),
    context,
    ({ business, arg }) => business.client.getBotConversationUsage(arg()),
  )
  apiAction(
    group.command('queued-inputs').description('列出本人尚未投递的排队消息').argument('<conversationId>', '会话 ID'),
    context,
    ({ business, arg }) => business.client.listBotQueuedInputs(arg()),
  )
  apiAction(
    group
      .command('withdraw-input')
      .description('撤回本人尚未投递的消息并返回原稿')
      .argument('<conversationId>', '会话 ID')
      .argument('<messageId>', '排队消息 ID'),
    context,
    ({ business, arg }) => business.client.withdrawBotQueuedInput(arg(), arg(1), writeOptions(business)),
    { confirm: '确定撤回该排队消息？成功后返回原稿，可编辑后重新发送。' },
  )
}

function registerEvents(group: Command, context: CliContext) {
  const events = withWaitTimeout(
    group
      .command('events')
      .description('查询或跟踪会话事件和运行轨迹')
      .argument('<conversationId>', '会话 ID')
      .option('--cursor <value>', '读取该事件游标之后的数据')
      .option('--run <runId>', '只读取指定运行的轨迹')
      .option('--follow', '持续输出每条事件，直到指定运行完成或达到等待时限'),
  )
  apiAction(
    events,
    context,
    async ({ business, arg }) => {
      const { cursor, run, follow } = events.opts<{ cursor?: string; run?: string; follow?: boolean }>()
      const query = checkedQuery('/api/v1/bot-conversations/{conversationId}/events', {
        ...(cursor === undefined ? {} : { after: cursor }),
        ...(run === undefined ? {} : { runId: run }),
      })
      if (!follow) return business.client.listBotConversationEvents(arg(), query)
      if (business.globals.json) throw new CliError('--follow 持续输出事件，请使用 --cursor 分页读取 JSON', 2)
      return withPolling(events, async (signal) => {
        const conversationId = arg()
        let after = query?.after
        for (;;) {
          const result = await business.client.listBotConversationEvents(
            conversationId,
            { ...(after === undefined ? {} : { after }), ...(run ? { runId: run } : {}) },
            { signal },
          )
          if (result.data.resetRequired) {
            throw new CliError('事件游标已失效，请重新读取会话消息和事件', 1, {
              code: 'CURSOR_EXPIRED',
              requestId: result.requestId,
            })
          }
          for (const event of result.data.items) context.stdout(`${JSON.stringify(event)}\n`)
          if (result.data.items.length > 0 && after === result.data.cursor) {
            throw new CliError('会话事件游标未推进', 1, { code: 'INVALID_RESPONSE', requestId: result.requestId })
          }
          after = result.data.cursor
          if (result.data.items.length >= 100) continue
          if (run && !result.data.activeRuns.some((item) => item.id === run)) return result
          await pollInterval(signal)
        }
      })
    },
    { silentWhenFollowing: true },
  )
}

/**
 * 注册会话、消息、群组成员、运行设置和接力控制。
 * @param program CLI 根命令。
 * @param context CLI 执行上下文，事件跟踪使用其 stdout。
 * @returns 无返回值；命令只操作调用人有权访问的会话。
 */
export function registerConversationCommands(program: Command, context: CliContext): void {
  const group = program.command('conversation').description('管理智能体会话、消息和运行')
  queryAction(
    group.command('list').description('列出当前团队可见会话'),
    context,
    '/api/v1/teams/{teamId}/bot-conversations',
    async ({ business, team }, query) => business.client.listBotConversations(await team(), query),
    'nextCursor',
  )
  apiAction(
    group.command('get').description('读取会话详情').argument('<conversationId>', '会话 ID'),
    context,
    ({ business, arg }) => business.client.getBotConversation(arg()),
  )
  jsonAction(
    group.command('create').description('创建私聊或群聊'),
    context,
    '/api/v1/teams/{teamId}/bot-conversations',
    async ({ business, team }, body, write) => business.client.createBotConversation(await team(), body, write),
  )
  jsonAction(
    group.command('update').description('更新群聊名称、职责或指令').argument('<conversationId>', '会话 ID'),
    context,
    '/api/v1/bot-conversations/{conversationId}/update',
    ({ business, arg }, body, write) => business.client.updateBotConversation(arg(), body, write),
  )
  const members = group.command('member').description('添加或移除群聊成员')
  for (const action of ['add', 'remove'] as const) {
    jsonAction(
      members
        .command(action)
        .description(action === 'add' ? '添加群聊成员' : '移除群聊成员')
        .argument('<conversationId>', '会话 ID'),
      context,
      '/api/v1/bot-conversations/{conversationId}/members/add',
      ({ business, arg }, body, write) => business.client.updateBotConversationMember(arg(), action, body, write),
    )
  }
  jsonAction(
    group
      .command('settings')
      .description('设置会话内模型与思考等级')
      .argument('<conversationId>', '会话 ID')
      .argument('<botId>', '智能体 ID'),
    context,
    '/api/v1/bot-conversations/{conversationId}/bots/{botId}/settings',
    ({ business, arg }, body, write) => business.client.updateBotSessionSettings(arg(), arg(1), body, write),
  )
  apiAction(
    group
      .command('compact')
      .description('手动压缩会话上下文')
      .argument('<conversationId>', '会话 ID')
      .argument('<botId>', '智能体 ID'),
    context,
    ({ business, arg }) => business.client.compactBotConversation(arg(), arg(1), writeOptions(business)),
  )
  apiAction(
    group.command('stop').description('停止智能体运行').argument('<runId>', '运行 ID'),
    context,
    ({ business, arg }) => business.client.stopBotRun(arg(), writeOptions(business)),
  )
  const relay = group.command('relay').description('继续、结束或停止群聊接力')
  for (const [action, description] of [
    ['continue', '继续暂停的接力'],
    ['end', '结束接力'],
    ['stop', '停止接力及当前运行'],
  ] as const) {
    jsonAction(
      relay.command(action).description(description).argument('<relayId>', '接力 ID'),
      context,
      '/api/v1/bot-relays/{relayId}/continue',
      ({ business, arg }, body, write) => business.client.controlBotRelay(arg(), action, body, write),
    )
  }
  registerQueuedInputs(group, context)
  registerMessages(group, context)
  registerEvents(group, context)
}
