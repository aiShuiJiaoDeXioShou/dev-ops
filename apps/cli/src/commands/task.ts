import type { Command } from 'commander'
import { apiAction, jsonAction, queryAction, writeOptions } from '../lib/api-command.ts'
import type { CliContext } from '../lib/context.ts'

/**
 * 注册历史会话任务的只读查询命令。
 * @param program CLI 根命令。
 * @param context CLI 执行上下文。
 * @returns 无返回值；读取时由服务端校验会话可见权限。
 */
export function registerTaskCommands(program: Command, context: CliContext): void {
  const group = program.command('task').description('只读查询历史智能体任务')
  apiAction(group.command('inbox').description('查询当前团队等你回复的会话'), context, async ({ business, team }) =>
    business.client.getBotInbox(await team()),
  )
  apiAction(
    group.command('get').description('只读查询历史任务、运行和验收详情').argument('<taskId>', '任务 ID'),
    context,
    ({ business, arg }) => business.client.getBotTask(arg()),
  )
  queryAction(
    group.command('list').description('只读列出历史会话任务').argument('<conversationId>', '会话 ID'),
    context,
    '/api/v1/bot-conversations/{conversationId}/tasks',
    ({ business, arg }, query) => business.client.listBotTasks(arg(), query),
    'nextCursor',
  )
}

/**
 * 注册工作标签目录及其会话、任务关联。
 * @param program CLI 根命令。
 * @param context CLI 执行上下文。
 * @returns 无返回值；删除标签前要求确认。
 */
export function registerWorkTagCommands(program: Command, context: CliContext): void {
  const group = program.command('work-tag').description('整理会话和任务的工作标签')
  queryAction(
    group.command('list').description('列出团队工作标签'),
    context,
    '/api/v1/teams/{teamId}/work-tags',
    async ({ business, team }, query) => business.client.listWorkTags(await team(), query),
    'nextCursor',
  )
  jsonAction(
    group.command('create').description('创建团队工作标签'),
    context,
    '/api/v1/teams/{teamId}/work-tags',
    async ({ business, team }, body, write) => business.client.createWorkTag(await team(), body, write),
  )
  jsonAction(
    group.command('rename').description('重命名工作标签').argument('<tagId>', '标签 ID'),
    context,
    '/api/v1/work-tags/{tagId}/update',
    ({ business, arg }, body, write) => business.client.renameWorkTag(arg(), body, write),
  )
  apiAction(
    group.command('remove').description('删除工作标签及其关联').argument('<tagId>', '标签 ID'),
    context,
    ({ business, arg }) => business.client.removeWorkTag(arg(), writeOptions(business)),
    { confirm: '确定删除标签及其关联？' },
  )
  for (const action of ['link', 'unlink'] as const) {
    jsonAction(
      group
        .command(action)
        .description(action === 'link' ? '为事项添加标签' : '解除事项标签关联')
        .argument('<tagId>', '标签 ID'),
      context,
      '/api/v1/work-tags/{tagId}/link',
      ({ business, arg }, body, write) => business.client.setWorkTagLink(arg(), action === 'link', body, write),
    )
  }
}
