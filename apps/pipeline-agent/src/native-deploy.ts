import { spawn } from 'node:child_process'
import type { RunPlan } from '@dev-ops/pipeline-protocol'
import type { AgentConfig } from './config.ts'
import { describeError, isLeaseLostError } from './errors.ts'
import type { RunExecutionResult, RunReportSink, RunStopSignal } from './executor.ts'
import type { LogCollector } from './logs.ts'

/**
 * 使用宿主配置的发布脚本执行固定仓库的 main 提交，沿用 Agent 的租约及日志协议。
 * @param options 平台运行计划、宿主白名单、步骤上报、日志和停止信号。
 * @returns 实际发布及就绪检查的结果；取消、超时和脚本异常不会上报成功。
 */
export async function executeNativeDeployment(options: {
  plan: RunPlan
  host: NonNullable<AgentConfig['nativeDeployment']>
  sink: RunReportSink
  collector: LogCollector
  stop: RunStopSignal
}): Promise<RunExecutionResult> {
  const { plan, host, stop, sink, collector } = options
  const failed = (errorCode: string, errorMessage: string): RunExecutionResult => ({
    status: 'failed',
    errorCode,
    errorMessage,
    cleanupFailures: [],
  })
  const [job] = plan.jobs
  const step = job?.steps[0]
  if (
    plan.jobs.length !== 1 ||
    !job ||
    job.runsOn.length !== 1 ||
    job.runsOn[0] !== 'macmini-deploy' ||
    job.steps.length !== 1 ||
    !step ||
    step.kind !== 'builtin_deploy_native' ||
    plan.workflowPath !== host.workflow ||
    plan.git.remoteUrl !== host.repository ||
    !['main', 'refs/heads/main'].includes(plan.ref) ||
    !/^[0-9a-f]{40}$/.test(plan.commitSha) ||
    plan.git.commitSha !== plan.commitSha
  )
    return failed('AGENT_NATIVE_DEPLOY_NOT_ALLOWED', '原生节点仅执行配置的仓库和 main 发布工作流')

  if (stop.signal.aborted) return { status: stop.reason ?? 'interrupted', cleanupFailures: [] }
  try {
    await sink.reportStepStatus(step.index, { status: 'running' })
    const timeout = AbortSignal.timeout(
      Math.min(plan.timeoutSeconds, job.timeoutSeconds, step.timeoutSeconds ?? Infinity) * 1000,
    )
    const signal = AbortSignal.any([stop.signal, timeout])
    let status: RunExecutionResult['status'] = 'succeeded'
    let errorCode: string | undefined
    let errorMessage: string | undefined
    let exitCode: number | null = null
    try {
      signal.throwIfAborted()
      const child = spawn('/bin/bash', [host.script, plan.commitSha], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          DEVOPS_DEPLOY_ROOT: process.env.DEVOPS_DEPLOY_ROOT,
          DEVOPS_DEPLOY_GIT_PROXY: process.env.DEVOPS_DEPLOY_GIT_PROXY,
          DEVOPS_DEPLOY_REPOSITORY: host.repository,
          DEVOPS_DEPLOY_GIT_TOKEN: plan.git.password,
        },
      })
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => collector.append(step.index, chunk))
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => collector.append(step.index, chunk))
      const terminate = () => {
        if (child.pid !== undefined) {
          try {
            process.kill(-child.pid, 'SIGTERM')
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
              collector.append(step.index, '停止原生发布进程失败\n')
            }
          }
        }
      }
      signal.addEventListener('abort', terminate, { once: true })
      try {
        exitCode = await new Promise<number | null>((resolve, reject) => {
          child.once('error', reject)
          child.once('close', resolve)
        })
      } finally {
        signal.removeEventListener('abort', terminate)
      }
      signal.throwIfAborted()
      if (exitCode !== 0) throw new Error('原生发布脚本失败，请查看步骤日志')
    } catch (error) {
      status = stop.reason ?? 'failed'
      errorCode = timeout.aborted ? 'AGENT_STEP_TIMEOUT' : 'AGENT_NATIVE_DEPLOY_FAILED'
      errorMessage = timeout.aborted ? '原生发布超时' : describeError(error)
    }
    await collector.flush(step.index)
    // 平台的步骤终态没有 interrupted，由运行终态表达租约中断。
    if (status !== 'interrupted') {
      await sink.reportStepStatus(step.index, {
        status,
        exitCode,
        errorCode: errorCode ?? null,
        errorMessage: errorMessage ?? null,
      })
    }
    return { status, ...(errorCode ? { errorCode, errorMessage } : {}), cleanupFailures: [] }
  } catch (error) {
    if (isLeaseLostError(error)) return { status: 'interrupted', cleanupFailures: [] }
    return failed('AGENT_NATIVE_DEPLOY_REPORT_FAILED', describeError(error))
  }
}
