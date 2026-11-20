import type { Command } from 'commander'
import { apiAction, jsonAction, queryAction, writeOptions } from '../lib/api-command.ts'
import type { CliContext } from '../lib/context.ts'

function registerBotModels(bot: Command, context: CliContext) {
  const models = bot.command('model').description('查看模型目录并管理模型连接')
  queryAction(
    models.command('catalog').description('查看团队可用的模型目录'),
    context,
    '/api/v1/teams/{teamId}/bot-model-catalog',
    async ({ business, team }, query) => business.client.listBotModelCatalog(await team(), query),
  )
  apiAction(
    models.command('list').description('列出模型连接及订阅状态'),
    context,
    async ({ business, team }) => business.client.listBotConnections(await team()),
    { list: true },
  )
  const create = models.command('create').description('用凭据库引用或标准输入中的 API Key 创建模型连接')
  jsonAction(
    create,
    context,
    '/api/v1/teams/{teamId}/bot-model-connections',
    async ({ business, team }, body, write) => business.client.createBotConnection(await team(), body, write),
    { secretFields: ['apiKey'] },
  )
  for (const action of ['enable', 'disable'] as const) {
    jsonAction(
      models
        .command(action)
        .description(action === 'enable' ? '启用模型连接' : '停用模型连接')
        .argument('<connectionId>', '模型连接 ID'),
      context,
      '/api/v1/bot-model-connections/{connectionId}/enable',
      ({ business, arg }, body, write) =>
        business.client.setBotConnectionEnabled(arg(), action === 'enable', body, write),
    )
  }
}

function registerBotMcp(bot: Command, context: CliContext) {
  const mcp = bot.command('mcp').description('配置团队 MCP 服务')
  queryAction(
    mcp.command('list').description('列出当前团队的 MCP 服务'),
    context,
    '/api/v1/teams/{teamId}/bot-mcp-servers',
    async ({ business, team }, query) => business.client.listBotMcpServers(await team(), query),
    'nextCursor',
  )
  jsonAction(
    mcp.command('create').description('新建远程 MCP 连接'),
    context,
    '/api/v1/teams/{teamId}/bot-mcp-servers',
    async ({ business, team }, body, write) => business.client.createBotMcpServer(await team(), body, write),
  )
  jsonAction(
    mcp.command('update').description('更新远程 MCP 连接').argument('<serverId>', 'MCP 服务 ID'),
    context,
    '/api/v1/bot-mcp-servers/{serverId}/update',
    ({ business, arg }, body, write) => business.client.updateBotMcpServer(arg(), body, write),
  )
  apiAction(
    mcp.command('test').description('检测已配置的 MCP 服务').argument('<serverId>', 'MCP 服务 ID'),
    context,
    ({ business, arg }) => business.client.testBotMcpServer(arg(), writeOptions(business)),
  )
  for (const [action, description] of [
    ['enable', '启用 MCP 服务'],
    ['disable', '停用 MCP 服务'],
    ['remove', '删除 MCP 服务'],
  ] as const) {
    apiAction(
      mcp.command(action).description(description).argument('<serverId>', 'MCP 服务 ID'),
      context,
      ({ business, arg }) => business.client.controlBotMcpServer(arg(), action, writeOptions(business)),
      action === 'remove' ? { confirm: '确定删除 MCP 服务？' } : undefined,
    )
  }
}

function registerBotKnowledge(bot: Command, context: CliContext) {
  const memory = bot.command('memory').description('管理智能体长期记忆')
  queryAction(
    memory.command('list').description('查询智能体记忆'),
    context,
    '/api/v1/teams/{teamId}/bot-memories',
    async ({ business, team }, query) => business.client.listBotMemories(await team(), query),
    'nextCursor',
  )
  jsonAction(
    memory.command('create').description('创建智能体记忆'),
    context,
    '/api/v1/teams/{teamId}/bot-memories',
    async ({ business, team }, body, write) => business.client.createBotMemory(await team(), body, write),
  )
  jsonAction(
    memory.command('update').description('修改记忆正文或常驻状态').argument('<memoryId>', '记忆 ID'),
    context,
    '/api/v1/bot-memories/{memoryId}/update',
    ({ business, arg }, body, write) => business.client.updateBotMemory(arg(), body, write),
  )
  apiAction(
    memory.command('remove').description('删除智能体记忆').argument('<memoryId>', '记忆 ID'),
    context,
    ({ business, arg }) => business.client.removeBotMemory(arg(), writeOptions(business)),
    { confirm: '确定删除智能体记忆？' },
  )
  apiAction(
    memory.command('consolidate').description('触发长期记忆整理').argument('<botId>', '智能体 ID'),
    context,
    ({ business, arg }) => business.client.consolidateBotMemories(arg(), writeOptions(business)),
  )

  const templates = bot.command('template').description('管理团队提示词模板')
  queryAction(
    templates.command('list').description('列出团队提示词模板'),
    context,
    '/api/v1/teams/{teamId}/bot-prompt-templates',
    async ({ business, team }, query) => business.client.listBotPromptTemplates(await team(), query),
    'nextCursor',
  )
  jsonAction(
    templates.command('create').description('新建团队提示词模板'),
    context,
    '/api/v1/teams/{teamId}/bot-prompt-templates',
    async ({ business, team }, body, write) => business.client.createBotPromptTemplate(await team(), body, write),
  )
  jsonAction(
    templates.command('update').description('编辑团队提示词模板').argument('<templateId>', '模板 ID'),
    context,
    '/api/v1/bot-prompt-templates/{templateId}/update',
    ({ business, arg }, body, write) => business.client.updateBotPromptTemplate(arg(), body, write),
  )
  apiAction(
    templates.command('remove').description('删除团队提示词模板').argument('<templateId>', '模板 ID'),
    context,
    ({ business, arg }) => business.client.removeBotPromptTemplate(arg(), writeOptions(business)),
    { confirm: '确定删除提示词模板？' },
  )
}

function registerBotAdministration(bot: Command, context: CliContext) {
  const teamContext = bot.command('context').description('维护团队级智能体上下文')
  apiAction(teamContext.command('get').description('查看团队上下文'), context, async ({ business, team }) =>
    business.client.getTeamBotContext(await team()),
  )
  jsonAction(
    teamContext.command('update').description('编辑团队上下文'),
    context,
    '/api/v1/teams/{teamId}/bot-context',
    async ({ business, team }, body, write) => business.client.updateTeamBotContext(await team(), body, write),
  )
  queryAction(
    bot.command('usage').description('查询团队或指定智能体的用量与预算'),
    context,
    '/api/v1/teams/{teamId}/bot-usage',
    async ({ business, team }, query) => business.client.getBotUsage(await team(), query),
    'nextBotCursor',
  )
  const budget = bot.command('budget').description('管理团队用量预算')
  jsonAction(
    budget.command('update').description('设置或清除团队的月度预算'),
    context,
    '/api/v1/teams/{teamId}/bot-budget',
    async ({ business, team }, body, write) => business.client.updateBotBudget(await team(), body, write),
  )
}

/**
 * 注册智能体目录、模型连接、MCP、记忆、提示模板、上下文与预算命令。
 * @param program CLI 根命令。
 * @param context CLI 执行上下文。
 * @returns 无返回值，模型订阅授权入口仍在 Web。
 */
export function registerBotCommands(program: Command, context: CliContext): void {
  const bot = program.command('bot').description('管理智能体、模型和团队配置')
  queryAction(
    bot.command('list').description('列出当前团队的智能体'),
    context,
    '/api/v1/teams/{teamId}/bots',
    async ({ business, team }, query) => business.client.listBots(await team(), query),
    'nextCursor',
  )
  apiAction(
    bot.command('get').description('查看智能体配置').argument('<botId>', '智能体 ID'),
    context,
    ({ business, arg }) => business.client.getBot(arg()),
  )
  jsonAction(
    bot.command('create').description('新建智能体'),
    context,
    '/api/v1/teams/{teamId}/bots',
    async ({ business, team }, body, write) => business.client.createBot(await team(), body, write),
  )
  jsonAction(
    bot.command('update').description('编辑智能体与技能配置').argument('<botId>', '智能体 ID'),
    context,
    '/api/v1/bots/{botId}/update',
    ({ business, arg }, body, write) => business.client.updateBot(arg(), body, write),
  )
  jsonAction(
    bot.command('bind-model').description('为智能体绑定模型').argument('<botId>', '智能体 ID'),
    context,
    '/api/v1/bots/{botId}/bind-model',
    ({ business, arg }, body, write) => business.client.bindBotModel(arg(), body, write),
  )
  jsonAction(
    bot.command('set-access').description('修改智能体工具访问权限').argument('<botId>', '智能体 ID'),
    context,
    '/api/v1/bots/{botId}/set-access',
    ({ business, arg }, body, write) => business.client.setBotAccess(arg(), body, write),
  )
  for (const action of ['enable', 'disable'] as const) {
    jsonAction(
      bot
        .command(action)
        .description(action === 'enable' ? '启用智能体' : '停用智能体')
        .argument('<botId>', '智能体 ID'),
      context,
      '/api/v1/bots/{botId}/enable',
      ({ business, arg }, body, write) => business.client.setBotEnabled(arg(), action === 'enable', body, write),
    )
  }
  registerBotModels(bot, context)
  registerBotMcp(bot, context)
  registerBotKnowledge(bot, context)
  registerBotAdministration(bot, context)
}
