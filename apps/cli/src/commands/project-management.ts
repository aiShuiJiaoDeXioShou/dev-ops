import type { Command } from 'commander'
import { apiAction, jsonAction, queryAction } from '../lib/api-command.ts'
import type { CliContext } from '../lib/context.ts'
import { registerEnvironmentCommands } from './configuration.ts'

/**
 * 注册项目活动、服务、流程模板和恢复操作。
 * @param project 已注册的项目命令组。
 * @param context CLI 执行上下文。
 * @returns 无返回值；读写均由服务端检查团队及资源权限。
 */
export function registerProjectManagement(project: Command, context: CliContext): void {
  registerEnvironmentCommands(project, context)
  queryAction(
    project.command('activity').description('读取团队项目晴雨表数据'),
    context,
    '/api/v1/teams/{teamId}/project-activity',
    async ({ business, team }, query) => business.client.getProjectActivity(await team(), query),
  )

  queryAction(
    project.command('repository-options').description('列出团队可用于筛选项目的仓库'),
    context,
    '/api/v1/teams/{teamId}/project-repositories',
    async ({ business, team }, query) => business.client.listProjectRepositoryOptions(await team(), query),
    'page',
  )

  const service = project.command('service').description('管理项目服务')
  apiAction(
    service.command('list').description('列出项目服务').argument('<projectId>', '项目 ID'),
    context,
    ({ business, arg }) => business.client.listProjectServices(arg()),
    { list: true },
  )
  apiAction(
    service
      .command('get')
      .description('查询项目服务')
      .argument('<projectId>', '项目 ID')
      .argument('<serviceId>', '服务 ID'),
    context,
    ({ business, arg }) => business.client.getProjectService(arg(), arg(1)),
  )
  jsonAction(
    service.command('create').description('创建项目服务').argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/projects/{projectId}/services',
    ({ business, arg }, body, write) => business.client.createProjectService(arg(), body, write),
  )
  jsonAction(
    service
      .command('update')
      .description('编辑、停用或恢复服务')
      .argument('<projectId>', '项目 ID')
      .argument('<serviceId>', '服务 ID'),
    context,
    '/api/v1/projects/{projectId}/services/{serviceId}/update',
    ({ business, arg }, body, write) => business.client.updateProjectService(arg(), arg(1), body, write),
  )

  const trash = project.command('recycle-bin').description('查询和恢复已删除项目')
  queryAction(
    trash.command('list').description('列出当前团队回收站中的项目'),
    context,
    '/api/v1/teams/{teamId}/project-recycle-bin',
    async ({ business, team }, query) => business.client.listProjectRecycleBin(await team(), query),
    'page',
  )
  jsonAction(
    trash.command('restore').description('恢复已删除项目').argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/projects/{projectId}/restore',
    ({ business, arg }, body, write) => business.client.restoreProject(arg(), body, write),
  )
}
