import { writeFile } from 'node:fs/promises'
import { createSkillPackageZip, generateSkillMarkdown } from '@dev-ops/api-client/skill-package'
import type { Command } from 'commander'
import { apiAction, jsonAction, queryAction } from '../lib/api-command.ts'
import type { CliContext } from '../lib/context.ts'
import { CliError } from '../lib/errors.ts'

/**
 * 注册团队技能、历史版本、活动与技能包导出命令。
 * @param program CLI 根命令。
 * @param context CLI 执行上下文。
 * @returns 无返回值；导出路径必须指向新文件。
 */
export function registerSkillCommands(program: Command, context: CliContext): void {
  const group = program.command('skill').description('维护团队技能、版本和技能包')
  queryAction(
    group.command('list').description('列出团队技能'),
    context,
    '/api/v1/teams/{teamId}/skills',
    async ({ business, team }, query) => business.client.listSkills(await team(), query),
    'page',
  )
  apiAction(
    group.command('get').description('查询技能详情').argument('<skillId>', '技能 ID'),
    context,
    ({ business, arg }) => business.client.getSkill(arg()),
  )
  jsonAction(
    group.command('create').description('创建团队技能'),
    context,
    '/api/v1/teams/{teamId}/skills',
    async ({ business, team }, body, write) => business.client.createSkill(await team(), body, write),
  )
  jsonAction(
    group.command('update').description('编辑技能及资源文件').argument('<skillId>', '技能 ID'),
    context,
    '/api/v1/skills/{skillId}/update',
    ({ business, arg }, body, write) => business.client.updateSkill(arg(), body, write),
  )
  jsonAction(
    group.command('enable').description('启用技能').argument('<skillId>', '技能 ID'),
    context,
    '/api/v1/skills/{skillId}/enable',
    ({ business, arg }, body, write) => business.client.enableSkill(arg(), body, write),
  )
  jsonAction(
    group.command('disable').description('停用技能').argument('<skillId>', '技能 ID'),
    context,
    '/api/v1/skills/{skillId}/disable',
    ({ business, arg }, body, write) => business.client.disableSkill(arg(), body, write),
  )
  queryAction(
    group.command('versions').description('列出技能版本').argument('<skillId>', '技能 ID'),
    context,
    '/api/v1/skills/{skillId}/versions',
    ({ business, arg }, query) => business.client.listSkillVersions(arg(), query),
    'page',
  )
  apiAction(
    group
      .command('version')
      .description('读取技能的某个历史版本')
      .argument('<skillId>', '技能 ID')
      .argument('<versionId>', '版本 ID'),
    context,
    ({ business, arg }) => business.client.getSkillVersion(arg(), arg(1)),
  )
  queryAction(
    group.command('activities').description('查询技能操作记录').argument('<skillId>', '技能 ID'),
    context,
    '/api/v1/skills/{skillId}/activities',
    ({ business, arg }, query) => business.client.listSkillActivities(arg(), query),
    'page',
  )

  const download = group
    .command('export')
    .description('导出技能包或 SKILL.md')
    .argument('<skillId>', '技能 ID')
    .requiredOption('--output <path>', '新文件路径')
    .option('--markdown', '仅写入 SKILL.md')
  apiAction(download, context, async ({ business, arg }) => {
    const options = download.opts<{ output: string; markdown?: boolean }>()
    const { data, requestId } = await business.client.getSkill(arg())
    const content = options.markdown
      ? generateSkillMarkdown(data.identifier, data.summary, data.content)
      : new Uint8Array(await createSkillPackageZip(data, data.files).arrayBuffer())
    try {
      await writeFile(options.output, content, { flag: 'wx', mode: 0o600 })
    } catch {
      throw new CliError('无法写入技能包，请确认输出文件不存在且路径有效', 2, { code: 'OUTPUT_UNWRITABLE' })
    }
    return { data: { path: options.output, skillId: data.id, version: data.version }, requestId }
  })
}
