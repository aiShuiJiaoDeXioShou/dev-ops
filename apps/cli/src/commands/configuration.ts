import type { Command } from 'commander'
import { apiAction, jsonAction, queryAction, writeOptions } from '../lib/api-command.ts'
import type { CliContext } from '../lib/context.ts'

/**
 * 注册项目环境变量与凭据引用管理。
 * @param project 已注册的项目命令组。
 * @param context CLI 执行和输入输出上下文。
 * @returns 无返回值；秘密类型通过凭据 ID 引用。
 */
export function registerEnvironmentCommands(project: Command, context: CliContext): void {
  const group = project.command('env').description('管理项目环境变量与凭据引用')
  apiAction(
    group
      .command('list')
      .description('读取指定环境的变量')
      .argument('<projectId>', '项目 ID')
      .argument('<environment>', '环境'),
    context,
    ({ business, arg }) => business.client.listEnvVariables(arg(), arg(1)),
    { list: true },
  )
  jsonAction(
    group
      .command('create')
      .description('创建环境变量或凭据引用')
      .argument('<projectId>', '项目 ID')
      .argument('<environment>', '环境'),
    context,
    '/api/v1/projects/{projectId}/environments/{environment}/variables',
    ({ business, arg }, body, write) => business.client.createEnvVariable(arg(), arg(1), body, write),
  )
  jsonAction(
    group.command('update').description('更新变量或其凭据引用').argument('<variableId>', '变量 ID'),
    context,
    '/api/v1/project-variables/{variableId}/update',
    ({ business, arg }, body, write) => business.client.updateEnvVariable(arg(), body, write),
  )
  jsonAction(
    group.command('remove').description('删除环境变量').argument('<variableId>', '变量 ID'),
    context,
    '/api/v1/project-variables/{variableId}/remove',
    ({ business, arg }, body, write) => business.client.removeEnvVariable(arg(), body, write),
    { confirm: '确定删除环境变量？' },
  )
}

/**
 * 注册团队凭据元数据、授权、轮换及使用记录命令。
 * @param program CLI 根命令。
 * @param context CLI 执行和输入输出上下文。
 * @returns 无返回值；秘密值仅用于提交，输出为服务端元数据。
 */
export function registerCredentialCommands(program: Command, context: CliContext): void {
  const group = program.command('credential').description('管理团队凭据、项目授权及使用记录')
  queryAction(
    group.command('list').description('列出团队凭据元数据'),
    context,
    '/api/v1/teams/{teamId}/credentials',
    async ({ business, team }, query) => business.client.listCredentials(await team(), query),
    'page',
  )
  apiAction(
    group.command('get').description('读取凭据元数据和项目授权').argument('<credentialId>', '凭据 ID'),
    context,
    async ({ business, team, arg }) => business.client.getCredential(await team(), arg()),
  )
  jsonAction(
    group.command('create').description('从标准输入创建团队凭据'),
    context,
    '/api/v1/teams/{teamId}/credentials',
    async ({ business, team }, body, write) => business.client.createCredential(await team(), body, write),
    { secret: true },
  )
  jsonAction(
    group.command('rotate').description('从标准输入读取新值并轮换凭据').argument('<credentialId>', '凭据 ID'),
    context,
    '/api/v1/credentials/{credentialId}/rotate',
    ({ business, arg }, body, write) => business.client.rotateCredential(arg(), body, write),
    { secret: true, confirm: '确定轮换凭据？' },
  )
  jsonAction(
    group.command('revoke').description('撤销凭据').argument('<credentialId>', '凭据 ID'),
    context,
    '/api/v1/credentials/{credentialId}/revoke',
    ({ business, arg }, body, write) => business.client.revokeCredential(arg(), body, write),
    { confirm: '确定撤销凭据？' },
  )
  jsonAction(
    group.command('grant').description('向项目授权使用凭据').argument('<credentialId>', '凭据 ID'),
    context,
    '/api/v1/credentials/{credentialId}/grants',
    ({ business, arg }, body, write) => business.client.grantCredential(arg(), body, write),
  )
  jsonAction(
    group
      .command('revoke-grant')
      .description('撤销项目的凭据使用授权')
      .argument('<credentialId>', '凭据 ID')
      .argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/credentials/{credentialId}/grants/{projectId}/revoke',
    ({ business, arg }, body, write) => business.client.revokeCredentialGrant(arg(), arg(1), body, write),
    { confirm: '确定撤销项目凭据授权？' },
  )
  queryAction(
    group.command('usage').description('查询凭据使用记录').argument('<credentialId>', '凭据 ID'),
    context,
    '/api/v1/credentials/{credentialId}/usage',
    ({ business, arg }, query) => business.client.listCredentialUsage(arg(), query),
    'page',
  )
}

/**
 * 注册平台储存桶列表、配置、连接测试与默认桶管理。
 * @param program CLI 根命令。
 * @param context CLI 执行和输入输出上下文。
 * @returns 无返回值，平台管理员权限由服务端实时判定。
 */
export function registerStorageCommands(program: Command, context: CliContext): void {
  const storage = program.command('storage').description('管理平台储存桶')
  const group = storage.command('bucket').description('配置和维护平台储存桶')
  apiAction(
    group.command('list').description('列出平台储存桶'),
    context,
    ({ business }) => business.client.listStorageBuckets(),
    { list: true },
  )
  jsonAction(
    group.command('create').description('从标准输入创建储存桶'),
    context,
    '/api/v1/platform/storage-buckets',
    ({ business }, body, write) => business.client.createStorageBucket(body, write),
    { secret: true },
  )
  jsonAction(
    group.command('update').description('更新指定储存桶').argument('<bucketId>', '储存桶 ID'),
    context,
    '/api/v1/platform/storage-buckets/{bucketId}/update',
    ({ business, arg }, body, write) => business.client.updateStorageBucket(arg(), body, write),
    { secretFields: ['accessKeyId', 'secretAccessKey'] },
  )
  apiAction(
    group.command('test').description('测试储存桶读写连接').argument('<bucketId>', '储存桶 ID'),
    context,
    ({ business, arg }) => business.client.testStorageBucket(arg(), writeOptions(business)),
  )
  jsonAction(
    group.command('set-default').description('将指定桶设为平台默认桶').argument('<bucketId>', '储存桶 ID'),
    context,
    '/api/v1/platform/storage-buckets/{bucketId}/set-default',
    ({ business, arg }, body, write) => business.client.setStorageBucketDefault(arg(), body, write),
  )
  apiAction(
    group.command('remove').description('删除储存桶').argument('<bucketId>', '储存桶 ID'),
    context,
    ({ business, arg }) => business.client.removeStorageBucket(arg(), writeOptions(business)),
    { confirm: '确定删除储存桶？' },
  )
}
