import type { Command } from 'commander'
import { apiAction, jsonAction, queryAction } from '../lib/api-command.ts'
import type { CliContext } from '../lib/context.ts'

/**
 * 扩展构建上报命令，提供产物目录、运行版本和发布记录管理。
 * @param delivery 已注册的交付命令组。
 * @param context CLI 执行上下文。
 * @returns 无返回值，命令按服务端契约读写交付记录。
 */
export function registerDeliveryManagement(delivery: Command, context: CliContext): void {
  const artifact = delivery.command('artifact').description('查询构建产物目录')
  queryAction(
    artifact.command('list').description('列出项目产物').argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/projects/{projectId}/artifacts',
    ({ business, arg }, query) => business.client.listProjectArtifacts(arg(), query),
    'page',
  )

  const version = delivery.command('version').description('查询和确认服务运行版本')
  apiAction(
    version
      .command('list')
      .description('列出服务在各环境的已确认版本')
      .argument('<projectId>', '项目 ID')
      .argument('<serviceId>', '服务 ID'),
    context,
    ({ business, arg }) => business.client.listRunVersions(arg(), arg(1)),
  )
  jsonAction(
    version
      .command('confirm')
      .description('确认指定环境的实际运行版本')
      .argument('<projectId>', '项目 ID')
      .argument('<serviceId>', '服务 ID')
      .argument('<environment>', '运行环境'),
    context,
    '/api/v1/projects/{projectId}/services/{serviceId}/run-versions/{environment}/confirm',
    ({ business, arg }, body, write) => business.client.confirmRunVersion(arg(), arg(1), arg(2), body, write),
  )

  const review = delivery.command('review').description('管理外部审核记录')
  queryAction(
    review.command('list').description('列出项目审核记录').argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/projects/{projectId}/reviews',
    ({ business, arg }, query) => business.client.listReviews(arg(), query),
    'page',
  )
  apiAction(
    review.command('get').description('查询审核记录详情').argument('<reviewId>', '审核 ID'),
    context,
    ({ business, arg }) => business.client.getReview(arg()),
  )
  jsonAction(
    review.command('create').description('登记外部提审').argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/projects/{projectId}/reviews',
    ({ business, arg }, body, write) => business.client.createReview(arg(), body, write),
  )
  jsonAction(
    review.command('update').description('更新审核状态').argument('<reviewId>', '审核 ID'),
    context,
    '/api/v1/reviews/{reviewId}/update',
    ({ business, arg }, body, write) => business.client.updateReview(arg(), body, write),
  )

  const release = delivery.command('release').description('管理实际发布记录')
  queryAction(
    release.command('list').description('列出项目发布记录').argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/projects/{projectId}/releases',
    ({ business, arg }, query) => business.client.listReleases(arg(), query),
    'page',
  )
  jsonAction(
    release.command('create').description('登记实际发布结果').argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/projects/{projectId}/releases',
    ({ business, arg }, body, write) => business.client.createRelease(arg(), body, write),
  )
}
