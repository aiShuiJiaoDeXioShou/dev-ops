import type { RunPlanStep } from '@dev-ops/pipeline-protocol'

import type { AgentConfig } from './config.ts'
import { describeError, isLeaseLostError } from './errors.ts'
import { executeRunPlan } from './executor.ts'
import type { ExecuteRunPlanOptions, RunExecutionResult } from './executor.ts'
import { executeHostCommand } from './host-command.ts'

type NativeDeploymentOptions = Omit<Extract<ExecuteRunPlanOptions, { native: unknown }>, 'native'> & {
  host: NonNullable<AgentConfig['nativeDeployment']>
}

function failure(errorCode: string, errorMessage: string): RunExecutionResult {
  return { status: 'failed', errorCode, errorMessage, cleanupFailures: [] }
}

/**
 * 校验原生节点的发布权限，并在宿主工作区执行固定提交的工作流。
 * @param options 运行计划、宿主白名单、工作目录、步骤上报、日志和停止信号。
 * @returns 运行终态；兼容升级前的宿主脚本工作流。
 */
export async function executeNativeDeployment(options: NativeDeploymentOptions): Promise<RunExecutionResult> {
  const { plan, host } = options
  const [job] = plan.jobs
  const firstStep = job?.steps[0]
  if (
    plan.jobs.length !== 1 ||
    !job ||
    job.runsOn.length !== 1 ||
    job.runsOn[0] !== 'macmini-deploy' ||
    !firstStep ||
    plan.workflowPath !== host.workflow ||
    plan.git.remoteUrl !== host.repository ||
    !['main', 'refs/heads/main'].includes(plan.ref) ||
    !/^[0-9a-f]{40}$/.test(plan.commitSha) ||
    plan.git.commitSha !== plan.commitSha
  ) {
    return failure('AGENT_NATIVE_DEPLOY_NOT_ALLOWED', '原生节点仅执行配置的仓库和 main 发布工作流')
  }

  if (firstStep.kind === 'builtin_deploy_native' && job.steps.length === 1 && host.script) {
    return executeLegacyDeployment(options, firstStep, host.script, job.timeoutSeconds)
  }
  if (
    firstStep.kind !== 'builtin_checkout' ||
    firstStep.continueOnError ||
    job.steps.slice(1).some((step) => step.kind !== 'run' && step.kind !== 'builtin_upload_artifact')
  ) {
    return failure('AGENT_NATIVE_DEPLOY_NOT_ALLOWED', '原生作业先检出固定提交，再执行命令或上传产物')
  }
  return executeRunPlan({ ...options, native: host })
}

async function executeLegacyDeployment(
  options: NativeDeploymentOptions,
  step: RunPlanStep,
  script: string,
  jobTimeout: number,
): Promise<RunExecutionResult> {
  const { plan, host, stop, sink, collector, masker } = options
  if (stop.signal.aborted) return { status: stop.reason ?? 'interrupted', cleanupFailures: [] }
  masker.addSecrets([plan.git.password])
  try {
    await sink.reportStepStatus(step.index, { status: 'running' })
    let status: RunExecutionResult['status'] = 'succeeded'
    let errorCode: string | undefined
    let errorMessage: string | undefined
    let exitCode: number | null = null
    try {
      const result = await executeHostCommand({
        args: [script, plan.commitSha],
        env: {
          HOME: process.env.HOME,
          PATH: process.env.PATH,
          DEVOPS_DEPLOY_ROOT: host.deployRoot,
          DEVOPS_DEPLOY_GIT_PROXY: host.gitProxy,
          DEVOPS_DEPLOY_REPOSITORY: host.repository,
          DEVOPS_DEPLOY_GIT_TOKEN: plan.git.password,
        },
        timeoutMs: Math.min(plan.timeoutSeconds, jobTimeout, step.timeoutSeconds ?? Infinity) * 1000,
        signal: stop.signal,
        onOutput: (chunk) => collector.append(step.index, chunk),
      })
      exitCode = result.exitCode
      if (result.timedOut) {
        errorCode = 'AGENT_STEP_TIMEOUT'
        throw new Error('原生发布超时')
      }
      if (result.cancelled || exitCode !== 0) throw new Error('原生发布脚本失败，请查看步骤日志')
    } catch (error) {
      status = stop.reason ?? 'failed'
      errorCode ??= 'AGENT_NATIVE_DEPLOY_FAILED'
      errorMessage = masker.maskText(describeError(error))
    }
    await collector.flush(step.index)
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
    return failure('AGENT_NATIVE_DEPLOY_REPORT_FAILED', masker.maskText(describeError(error)))
  }
}
