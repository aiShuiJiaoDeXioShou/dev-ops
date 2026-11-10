import { hasUniqueStepIndexes } from '@dev-ops/pipeline-protocol'
import type {
  PipelineEnv,
  PipelineInputValue,
  PipelineInputs,
  RunPlan,
  RunPlanGit,
  RunPlanJob,
  RunPlanStep,
} from '@dev-ops/pipeline-protocol'
import { evaluateCondition, PipelineExpressionError, resolveTemplateString } from './pipeline.expressions.ts'
import type { ParsedWorkflow, WorkflowJobDefinition, WorkflowStepDefinition } from './pipeline.workflow.ts'

/** 平台标签到执行镜像的映射；P1 只支持 Node/Linux 构建。 */
export interface PipelineRunnerImage {
  image: string
  capabilities: string[]
}

/** P1 支持的 runs-on 标签；未列出的标签在校验阶段报错。 */
export const PIPELINE_RUNNER_IMAGES: Record<string, PipelineRunnerImage> = {
  linux: {
    image: 'node:24-bookworm-slim',
    capabilities: ['linux', 'docker', 'node24'],
  },
  node24: {
    image: 'node:24-bookworm-slim',
    capabilities: ['linux', 'docker', 'node24'],
  },
}

/** 运行计划模板；git 凭据与密钥在租约生成时物化，不进入持久化模板。 */
export interface RunPlanTemplate {
  runId: string
  workflowPath: string
  workflowName: string
  ref: string
  commitSha: string
  repository: string
  timeoutSeconds: number
  inputs: PipelineInputs
  env: PipelineEnv
  secretNames: string[]
  jobs: RunPlanJob[]
}

/** 计划生成错误；path 定位到 workflow 字段。 */
export class PipelinePlanError extends Error {
  readonly code: 'WORKFLOW_SCHEMA_ERROR' | 'WORKFLOW_UNSUPPORTED' | 'WORKFLOW_SECRET_IN_UNSAFE_POSITION'
  readonly path?: string

  constructor(message: string, path?: string, code: PipelinePlanError['code'] = 'WORKFLOW_SCHEMA_ERROR') {
    super(message)
    this.name = 'PipelinePlanError'
    this.path = path
    this.code = code
  }
}

const SECRET_REFERENCE = /\$\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
const SECRET_PLACEHOLDER = /__DEVOPS_SECRET_([A-Za-z_][A-Za-z0-9_]*)__/g
const DEFAULT_STEP_TIMEOUT_SECONDS = 600

export interface GenerateRunPlanInput {
  workflow: ParsedWorkflow
  runId: string
  ref: string
  commitSha: string
  inputs: Record<string, PipelineInputValue>
  github: { sha: string; ref: string; repository: string }
  defaultRunTimeoutSeconds: number
}

function replaceSecretReferences(value: string, secretNames: Set<string>): string {
  return value.replace(SECRET_REFERENCE, (_, name: string) => {
    secretNames.add(name)
    return `__DEVOPS_SECRET_${name}__`
  })
}

function restoreSecretReferences(value: string): string {
  return value.replace(SECRET_PLACEHOLDER, (_, name: string) => `\${{ secrets.${name} }}`)
}

function resolveEnvValue(
  value: string,
  context: Parameters<typeof resolveTemplateString>[1],
  secretNames: Set<string>,
  path: string,
): string {
  const protectedValue = replaceSecretReferences(value, secretNames)
  try {
    return restoreSecretReferences(resolveTemplateString(protectedValue, context, false, path))
  } catch (error) {
    if (error instanceof PipelineExpressionError)
      throw new PipelinePlanError(error.message, path, 'WORKFLOW_UNSUPPORTED')
    throw error
  }
}

function resolveNonSecretValue(
  value: string,
  context: Parameters<typeof resolveTemplateString>[1],
  path: string,
): string {
  if (SECRET_REFERENCE.test(value)) {
    SECRET_REFERENCE.lastIndex = 0
    throw new PipelinePlanError('secrets 只能用于 env 或内置步骤 with', path, 'WORKFLOW_SECRET_IN_UNSAFE_POSITION')
  }
  SECRET_REFERENCE.lastIndex = 0
  try {
    return resolveTemplateString(value, context, false, path)
  } catch (error) {
    if (error instanceof PipelineExpressionError)
      throw new PipelinePlanError(error.message, path, 'WORKFLOW_UNSUPPORTED')
    throw error
  }
}

function resolveEnv(
  values: Record<string, string>,
  baseEnv: Record<string, string>,
  context: GenerateRunPlanInput['github'],
  inputs: PipelineInputs,
  secretNames: Set<string>,
  basePath: string,
): Record<string, string> {
  const resolved: Record<string, string> = { ...baseEnv }
  for (const [name, value] of Object.entries(values)) {
    const expressionContext = { env: resolved, inputs, github: context }
    resolved[name] = resolveEnvValue(value, expressionContext, secretNames, `${basePath}.${name}`)
  }
  return resolved
}

function resolveInputs(
  definitions: ParsedWorkflow['inputs'],
  provided: Record<string, PipelineInputValue>,
): PipelineInputs {
  const resolved: PipelineInputs = {}
  for (const name of Object.keys(provided)) {
    if (!(name in definitions)) throw new PipelinePlanError(`未声明的输入：${name}`, `inputs.${name}`)
  }
  for (const [name, definition] of Object.entries(definitions)) {
    const value = provided[name] ?? definition.defaultValue
    if (value === undefined) {
      if (definition.required)
        throw new PipelinePlanError(`缺少必填输入：${name}`, `on.workflow_dispatch.inputs.${name}`)
      resolved[name] = ''
      continue
    }
    if (definition.type === 'boolean' && typeof value !== 'boolean') {
      throw new PipelinePlanError(`输入 ${name} 必须是布尔值`, `inputs.${name}`)
    }
    if (definition.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new PipelinePlanError(`输入 ${name} 必须是数字`, `inputs.${name}`)
    }
    if (definition.type === 'string' && typeof value !== 'string') {
      throw new PipelinePlanError(`输入 ${name} 必须是字符串`, `inputs.${name}`)
    }
    if (definition.type === 'choice') {
      if (typeof value !== 'string' || !(definition.options ?? []).includes(value)) {
        throw new PipelinePlanError(`输入 ${name} 必须是声明的选项之一`, `inputs.${name}`)
      }
    }
    resolved[name] = value
  }
  return resolved
}

function topologicalJobs(workflow: ParsedWorkflow): WorkflowJobDefinition[] {
  const byId = new Map(workflow.jobs.map((job) => [job.id, job]))
  const remaining = new Set(workflow.jobs.map((job) => job.id))
  const ordered: WorkflowJobDefinition[] = []
  while (remaining.size > 0) {
    const ready = workflow.jobs.filter(
      (job) => remaining.has(job.id) && job.needs.every((need) => !remaining.has(need)),
    )
    if (ready.length === 0) throw new PipelinePlanError('job 依赖存在环', 'jobs')
    for (const job of ready) {
      remaining.delete(job.id)
      const definition = byId.get(job.id)
      if (!definition) throw new PipelinePlanError(`job 解析失败：${job.id}`, `jobs.${job.id}`)
      ordered.push(definition)
    }
  }
  return ordered
}

/**
 * 将解析后的 workflow 转换为运行计划模板；不解析 git 凭据与密钥值。
 * @param input workflow、运行标识、固定提交、输入与平台默认超时。
 * @returns 可持久化的运行计划模板，secrets 引用保留在 env/with 中，等待租约生成时物化。
 * @throws PipelinePlanError 输入、标签、表达式或 if 条件不合法时抛出。
 */
export function generateRunPlan(input: GenerateRunPlanInput): RunPlanTemplate {
  const inputs = resolveInputs(input.workflow.inputs, input.inputs)
  const secretNames = new Set<string>()
  const workflowEnv = resolveEnv(input.workflow.env, {}, input.github, inputs, secretNames, 'env')
  const orderedJobs = topologicalJobs(input.workflow)
  const skipped = new Set<string>()
  const jobs: RunPlanJob[] = []
  let stepIndex = 0
  for (const job of orderedJobs) {
    if (job.needs.some((need) => skipped.has(need))) {
      skipped.add(job.id)
      continue
    }
    const jobContext = { env: workflowEnv, inputs, github: input.github }
    if (job.if !== undefined && !evaluateCondition(job.if, jobContext, `jobs.${job.id}.if`)) {
      skipped.add(job.id)
      continue
    }
    const jobEnv = resolveEnv(job.env, workflowEnv, input.github, inputs, secretNames, `jobs.${job.id}.env`)
    const image = PIPELINE_RUNNER_IMAGES[job.runsOn]
    if (!image) {
      throw new PipelinePlanError(
        `不支持的 runs-on 标签：${job.runsOn}`,
        `jobs.${job.id}.runs-on`,
        'WORKFLOW_UNSUPPORTED',
      )
    }
    const planSteps: RunPlanStep[] = []
    for (const definition of job.steps) {
      const stepPath = `jobs.${job.id}.steps[${planSteps.length}]`
      const stepEnv = resolveEnv(definition.env, jobEnv, input.github, inputs, secretNames, `${stepPath}.env`)
      const context = { env: stepEnv, inputs, github: input.github }
      if (definition.if !== undefined && !evaluateCondition(definition.if, context, `${stepPath}.if`)) continue
      planSteps.push(toPlanStep(definition, stepIndex, context, stepPath, stepEnv, secretNames))
      stepIndex += 1
    }
    if (planSteps.length === 0) {
      skipped.add(job.id)
      continue
    }
    const jobTimeoutSeconds = (job.timeoutMinutes ?? Math.max(1, Math.floor(input.defaultRunTimeoutSeconds / 60))) * 60
    jobs.push({
      id: job.id,
      name: job.name,
      image: image.image,
      runsOn: image.capabilities,
      timeoutSeconds: jobTimeoutSeconds,
      env: jobEnv,
      steps: planSteps,
    })
  }
  if (jobs.length === 0) throw new PipelinePlanError('没有可执行 job', 'jobs')
  // 序列化前自检步骤序号全局唯一，防止模板与 Agent 协议契约漂移。
  if (!hasUniqueStepIndexes({ jobs })) throw new PipelinePlanError('步骤序号重复', 'jobs')
  return {
    runId: input.runId,
    workflowPath: input.workflow.path,
    workflowName: input.workflow.name,
    ref: input.ref,
    commitSha: input.commitSha,
    repository: input.github.repository,
    timeoutSeconds: input.defaultRunTimeoutSeconds,
    inputs,
    env: workflowEnv,
    secretNames: [...secretNames].sort(),
    jobs,
  }
}

function toPlanStep(
  definition: WorkflowStepDefinition,
  index: number,
  context: { env: Record<string, string>; inputs: PipelineInputs; github: GenerateRunPlanInput['github'] },
  path: string,
  env: Record<string, string>,
  secretNames: Set<string>,
): RunPlanStep {
  const withValues: Record<string, string> = {}
  for (const [name, value] of Object.entries(definition.with)) {
    withValues[name] = resolveEnvValue(value, context, secretNames, `${path}.with.${name}`)
  }
  const step: RunPlanStep = {
    index,
    name: definition.name,
    kind: definition.kind,
    env,
    continueOnError: definition.continueOnError,
    with: withValues,
  }
  if (definition.workingDirectory) {
    step.workingDirectory = resolveNonSecretValue(definition.workingDirectory, context, `${path}.working-directory`)
  }
  if (definition.timeoutMinutes) step.timeoutSeconds = definition.timeoutMinutes * 60
  else if (definition.kind === 'run') step.timeoutSeconds = DEFAULT_STEP_TIMEOUT_SECONDS
  if (definition.kind === 'run') {
    if (!definition.run) throw new PipelinePlanError('run 步骤缺少命令', path)
    step.run = resolveNonSecretValue(definition.run, context, `${path}.run`)
  }
  return step
}

/**
 * 在租约生成时把模板物化为完整运行计划；git 凭据与密钥值只在此刻进入内存。
 * @param template 持久化的运行计划模板。
 * @param material git 凭据与已解析的密钥值。
 * @returns Agent 可执行的完整运行计划。
 * @throws PipelinePlanError 模板引用的密钥缺失时抛出。
 */
export function materializeRunPlan(
  template: RunPlanTemplate,
  material: { git: RunPlanGit; secrets: Record<string, string> },
): RunPlan {
  const missing = template.secretNames.filter((name) => material.secrets[name] === undefined)
  if (missing.length > 0) throw new PipelinePlanError(`缺少运行时密钥：${missing.join(', ')}`)
  const context = {
    env: { ...template.env },
    inputs: template.inputs,
    github: { sha: template.commitSha, ref: template.ref, repository: template.repository },
    secrets: material.secrets,
  }
  const jobs = template.jobs.map((job) => ({
    ...job,
    env: resolveMaterializedEnv(job.env ?? {}, context),
    steps: job.steps.map((step) => ({
      ...step,
      env: resolveMaterializedEnv(step.env ?? {}, context),
      with: resolveMaterializedEnv(step.with ?? {}, context),
    })),
  }))
  return {
    runId: template.runId,
    workflowPath: template.workflowPath,
    workflowName: template.workflowName,
    ref: template.ref,
    commitSha: template.commitSha,
    timeoutSeconds: template.timeoutSeconds,
    inputs: template.inputs,
    env: resolveMaterializedEnv(template.env, context),
    git: material.git,
    secrets: material.secrets,
    jobs,
  }
}

function resolveMaterializedEnv(
  values: Record<string, string>,
  context: Parameters<typeof resolveTemplateString>[1],
): Record<string, string> {
  const resolved: Record<string, string> = {}
  for (const [name, value] of Object.entries(values)) {
    resolved[name] = resolveTemplateString(value, context, true, name)
  }
  return resolved
}
