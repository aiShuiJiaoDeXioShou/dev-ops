import { openAsBlob } from 'node:fs'
import { basename } from 'node:path'
import type { Command } from 'commander'
import { apiAction, writeOptions } from '../lib/api-command.ts'
import { CliError } from '../lib/errors.ts'
import { downloadToFile } from '../lib/files.ts'
import type { CliContext } from '../lib/context.ts'

/**
 * 注册附件策略、上传、下载和删除命令。上传返回的附件 ID 供事项命令绑定。
 * @param program 根命令。
 * @param context CLI 输入输出上下文。
 * @returns 无返回值，只有实际执行命令时访问文件或服务。
 */
export function registerAttachmentCommands(program: Command, context: CliContext): void {
  const group = program.command('attachment').description('上传、下载和删除项目事项附件')
  apiAction(group.command('policy').description('查询附件上传与绑定限制'), context, ({ business }) =>
    business.client.getAttachmentPolicy(),
  )
  const upload = group
    .command('upload')
    .description('上传临时附件并返回可绑定的附件 ID')
    .argument('<projectId>', '项目 ID')
    .requiredOption('--file <path>', '待上传的本地文件')
    .option('--content-type <type>', '文件媒体类型', 'application/octet-stream')
    .option('--name <name>', '覆盖服务端显示的文件名')
  apiAction(upload, context, async ({ business, arg }) => {
    const options = upload.opts<{ file: string; contentType: string; name?: string }>()
    const file = await openAsBlob(options.file).catch(() => {
      throw new CliError('无法读取待上传的附件文件', 2, { code: 'CONTENT_READ_FAILED' })
    })
    const policy = await business.client.getAttachmentPolicy()
    if (file.size < 1 || file.size > policy.data.maxFileBytes) {
      throw new CliError('附件文件为空或超过服务端大小限制', 2, { code: 'ATTACHMENT_INVALID' })
    }
    return business.client.uploadAttachment(arg(), file, {
      name: options.name ?? basename(options.file),
      contentType: options.contentType,
    })
  })
  const download = group
    .command('download')
    .description('校验摘要后下载附件')
    .argument('<attachmentId>', '附件 ID')
    .requiredOption('--output <path>', '新文件路径')
  apiAction(download, context, ({ business, arg }) =>
    downloadToFile(download.opts<{ output: string }>().output, () => business.client.downloadAttachment(arg())),
  )
  apiAction(
    group.command('remove').description('删除附件').argument('<attachmentId>', '附件 ID'),
    context,
    ({ business, arg }) => business.client.removeAttachment(arg(), writeOptions(business)),
    { confirm: '确定删除附件？' },
  )
}
