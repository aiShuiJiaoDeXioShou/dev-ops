import type { ApiQuery } from '@dev-ops/api-client'
import type { Command } from 'commander'
import {
  apiAction,
  checkedBody,
  checkedQuery,
  jsonAction,
  queryAction,
  readJsonFile,
  writeOptions,
} from '../lib/api-command.ts'
import type { CliContext } from '../lib/context.ts'
import { CliError } from '../lib/errors.ts'
import { downloadToFile, saveNodeToken } from '../lib/files.ts'
import { pollInterval, withPolling, withWaitTimeout } from '../lib/follow.ts'

const activeStatuses = new Set(['queued', 'assigned', 'running', 'cancelling'])
const logPath = '/api/v1/pipeline-runs/{runId}/logs'
type LogQuery = NonNullable<ApiQuery<typeof logPath, 'get'>>

function registerPipelineRuns(pipeline: Command, context: CliContext) {
  const run = pipeline.command('run').description('触发、查询及跟踪流水线运行')
  const trigger = run
    .command('trigger')
    .description('按版本引用触发指定工作流')
    .argument('<projectId>', '项目 ID')
    .requiredOption('--workflow <path>', '仓库中的工作流路径')
    .requiredOption('--ref <ref>', '仓库分支、标签或提交')
    .option('--inputs-file <path>', '工作流入参 JSON，- 表示标准输入')
  apiAction(trigger, context, async ({ business, arg }) => {
    const { workflow, ref, inputsFile } = trigger.opts<{ workflow: string; ref: string; inputsFile?: string }>()
    const write = writeOptions(business)
    const body = checkedBody('/api/v1/projects/{projectId}/pipeline-runs', {
      workflowPath: workflow,
      ref,
      idempotencyKey: write.idempotencyKey,
      ...(inputsFile ? { inputs: await readJsonFile(inputsFile, trigger, context) } : {}),
    })
    return business.client.triggerPipelineRun(arg(), body)
  })
  queryAction(
    run.command('list').description('列出项目运行').argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/projects/{projectId}/pipeline-runs',
    ({ business, arg }, query) => business.client.listPipelineRuns(arg(), query),
    'page',
  )
  apiAction(
    run.command('get').description('查询运行、步骤和产物详情').argument('<runId>', '运行 ID'),
    context,
    ({ business, arg }) => business.client.getPipelineRun(arg()),
  )

  const cancel = run
    .command('cancel')
    .description('请求取消流水线运行')
    .argument('<runId>', '运行 ID')
    .option('--reason <text>', '取消原因')
  apiAction(
    cancel,
    context,
    ({ business, arg }) =>
      business.client.cancelPipelineRun(arg(), cancel.opts<{ reason?: string }>(), writeOptions(business)),
    { confirm: '确定取消流水线运行？' },
  )

  const wait = withWaitTimeout(run.command('wait').description('等待运行完成').argument('<runId>', '运行 ID'))
  apiAction(wait, context, ({ business, arg }) =>
    withPolling(wait, async (signal) => {
      const id = arg()
      for (;;) {
        const result = await business.client.getPipelineRun(id, { signal })
        const { status, errorCode, errorMessage } = result.data
        if (status === 'succeeded') return result
        if (!activeStatuses.has(status)) {
          throw new CliError(errorMessage ?? `流水线运行结束，状态为 ${status}`, 1, {
            code: errorCode ?? 'PIPELINE_RUN_UNSUCCESSFUL',
            requestId: result.requestId,
          })
        }
        await pollInterval(signal)
      }
    }),
  )

  const logs = withWaitTimeout(
    run
      .command('logs')
      .description('读取日志页或持续跟踪日志')
      .argument('<runId>', '运行 ID')
      .option('--step <index>', '步骤索引')
      .option('--after-seq <sequence>', '读取该日志序号之后的数据')
      .option('--limit <count>', '每页分片数')
      .option('--follow', '向 stdout 持续写入日志正文'),
  )
  apiAction(
    logs,
    context,
    async ({ business, arg }) => {
      const { step, afterSeq, limit, follow } = logs.opts<{
        step?: string
        afterSeq?: string
        limit?: string
        follow?: boolean
      }>()
      const query = checkedQuery(logPath, {
        ...(step === undefined ? {} : { stepIndex: Number(step) }),
        ...(afterSeq === undefined ? {} : { afterSeq: Number(afterSeq) }),
        ...(limit === undefined ? {} : { limit: Number(limit) }),
      })
      if (!follow) return business.client.listPipelineRunLogs(arg(), query)
      if (business.globals.json) throw new CliError('--follow 输出日志正文，请使用 --after-seq 分页读取 JSON', 2)
      return withPolling(logs, async (signal) => {
        const runId = arg()
        let filters: LogQuery = query ?? {}
        let terminal = false
        for (;;) {
          const result = await business.client.listPipelineRunLogs(runId, filters, { signal })
          for (const chunk of result.data.items) context.stdout(chunk.content)
          const previous = filters.afterSeq ?? -1
          if (result.data.hasMore && result.data.nextSeq <= previous) {
            throw new CliError('日志分页游标未推进', 1, { code: 'INVALID_RESPONSE', requestId: result.requestId })
          }
          filters = { ...filters, afterSeq: result.data.nextSeq }
          if (result.data.hasMore) continue
          if (terminal) return { data: { nextSeq: result.data.nextSeq }, requestId: result.requestId }
          const status = await business.client.getPipelineRun(runId, { signal })
          terminal = !activeStatuses.has(status.data.status)
          if (!terminal) await pollInterval(signal)
        }
      })
    },
    { silentWhenFollowing: true },
  )
}

function registerNodes(pipeline: Command, context: CliContext) {
  const nodes = pipeline.command('node').description('管理执行节点与节点令牌')
  apiAction(
    nodes.command('list').description('列出当前团队的执行节点'),
    context,
    async ({ business, team }) => business.client.listPipelineNodes(await team()),
    { list: true },
  )
  const create = nodes
    .command('create')
    .description('创建节点，注册令牌只写入指定文件')
    .requiredOption('--token-out <path>', '新的注册令牌文件')
  jsonAction(
    create,
    context,
    '/api/v1/teams/{teamId}/pipeline-nodes',
    async ({ business, team }, body) => {
      const teamId = await team()
      return saveNodeToken(create.opts<{ tokenOut: string }>().tokenOut, async () => {
        const { data, requestId } = await business.client.createPipelineNode(teamId, body)
        return {
          secret: data.registrationToken,
          data: { node: data.node, registrationTokenExpiresAt: data.registrationTokenExpiresAt },
          requestId,
        }
      })
    },
    { idempotent: false },
  )
  apiAction(
    nodes.command('drain').description('排空执行节点').argument('<nodeId>', '节点 ID'),
    context,
    ({ business, arg }) => business.client.drainPipelineNode(arg(), writeOptions(business)),
  )
  apiAction(
    nodes.command('disable').description('停用执行节点').argument('<nodeId>', '节点 ID'),
    context,
    ({ business, arg }) => business.client.disablePipelineNode(arg(), writeOptions(business)),
    { confirm: '确定停用执行节点？' },
  )
  const rotate = nodes
    .command('rotate-token')
    .description('轮换节点令牌并写入文件')
    .argument('<nodeId>', '节点 ID')
    .requiredOption('--token-out <path>', '新的节点令牌文件')
  apiAction(
    rotate,
    context,
    ({ business, arg }) =>
      saveNodeToken(rotate.opts<{ tokenOut: string }>().tokenOut, async () => {
        const { data, requestId } = await business.client.rotatePipelineNodeToken(arg())
        return { secret: data.agentToken, data: { nodeId: data.nodeId }, requestId }
      }),
    { confirm: '确定轮换节点令牌？' },
  )
}

/**
 * 注册流水线工作流、运行、产物和执行节点命令。
 * @param program CLI 根命令。
 * @param context 执行和输入输出上下文。
 * @returns 无返回值；读取、等待和写操作均在命令执行时发生。
 */
export function registerPipelineCommands(program: Command, context: CliContext): void {
  const pipeline = program.command('pipeline').description('管理流水线、运行、产物和执行节点')
  const workflows = pipeline.command('workflow').description('读取仓库中的工作流')
  queryAction(
    workflows.command('list').description('列出项目工作流').argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/projects/{projectId}/pipeline-workflows',
    ({ business, arg }, query) => business.client.listPipelineWorkflows(arg(), query),
  )
  queryAction(
    workflows.command('get').description('读取工作流详情与解析结果').argument('<projectId>', '项目 ID'),
    context,
    '/api/v1/projects/{projectId}/pipeline-workflows/detail',
    ({ business, arg }, query) => business.client.getPipelineWorkflow(arg(), query),
  )
  registerPipelineRuns(pipeline, context)
  const artifacts = pipeline.command('artifact').description('查询及下载流水线产物')
  apiAction(
    artifacts.command('list').description('列出一次运行的产物').argument('<runId>', '运行 ID'),
    context,
    ({ business, arg }) => business.client.listPipelineArtifacts(arg()),
    { list: true },
  )
  const download = artifacts
    .command('download')
    .description('校验摘要后下载产物')
    .argument('<artifactId>', '产物 ID')
    .requiredOption('--output <path>', '新文件路径')
  apiAction(download, context, ({ business, arg }) =>
    downloadToFile(download.opts<{ output: string }>().output, () => business.client.downloadPipelineArtifact(arg())),
  )
  registerNodes(pipeline, context)
}
