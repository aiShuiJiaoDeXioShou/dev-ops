import { createHash } from 'node:crypto'
import { parseDocument, type Document } from 'yaml'
import type { PipelineInputValue } from '@dev-ops/pipeline-protocol'

/** 平台读取的工作流目录；P1 只支持该目录第一层文件。 */
export const PIPELINE_WORKFLOW_DIRECTORY = '.devops/workflows'
/** 单个 workflow 文件默认大小上限，可由调用方配置覆盖。 */
export const PIPELINE_WORKFLOW_MAX_BYTES = 131_072

export type WorkflowIssueCode =
  'WORKFLOW_PARSE_ERROR' | 'WORKFLOW_SCHEMA_ERROR' | 'WORKFLOW_UNSUPPORTED' | 'WORKFLOW_SECRET_IN_UNSAFE_POSITION'

/** 解析或校验错误；line/column 仅在 YAML 解析器可提供时出现。 */
export interface WorkflowIssue {
  code: WorkflowIssueCode
  message: string
  path?: string
  line?: number
  column?: number
}

export interface WorkflowInputDefinition {
  type: 'string' | 'boolean' | 'number' | 'choice'
  description?: string
  required: boolean
  defaultValue?: PipelineInputValue
  options?: string[]
}

export type WorkflowStepKind = 'run' | 'builtin_checkout' | 'builtin_upload_artifact' | 'builtin_verify_service'

export interface WorkflowStepDefinition {
  name: string
  kind: WorkflowStepKind
  run?: string
  workingDirectory?: string
  env: Record<string, string>
  timeoutMinutes?: number
  continueOnError: boolean
  if?: string
  with: Record<string, string>
}

export interface WorkflowJobDefinition {
  id: string
  name: string
  runsOn: string
  needs: string[]
  env: Record<string, string>
  timeoutMinutes?: number
  if?: string
  steps: WorkflowStepDefinition[]
}

export interface ParsedWorkflow {
  path: string
  name: string
  hash: string
  snapshot: string
  inputs: Record<string, WorkflowInputDefinition>
  env: Record<string, string>
  jobs: WorkflowJobDefinition[]
}

export type ParseWorkflowResult = { ok: true; workflow: ParsedWorkflow } | { ok: false; issues: WorkflowIssue[] }

const TOP_LEVEL_KEYS = new Set(['name', 'on', 'env', 'jobs'])
const JOB_KEYS = new Set(['name', 'runs-on', 'needs', 'if', 'env', 'timeout-minutes', 'steps'])
const STEP_KEYS = new Set([
  'name',
  'run',
  'uses',
  'with',
  'env',
  'working-directory',
  'timeout-minutes',
  'continue-on-error',
  'if',
])
const INPUT_KEYS = new Set(['description', 'type', 'required', 'default', 'options'])
const INPUT_TYPES: ReadonlySet<string> = new Set(['string', 'boolean', 'number', 'choice'])
const BUILTIN_ACTIONS = new Set(['builtin:checkout', 'builtin:upload-artifact', 'builtin:verify-service'])
const JOB_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]{0,79}$/
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9._-]{1,80}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 判断 YAML 中的输入类型是否受支持；用于把 unknown 收窄为业务枚举。 */
function isWorkflowInputType(value: unknown): value is WorkflowInputDefinition['type'] {
  return typeof value === 'string' && INPUT_TYPES.has(value)
}

/** 校验输入默认值类型并返回可持久化值；不满足时返回 issue 而不是强制断言。 */
function readInputDefault(
  inputType: WorkflowInputDefinition['type'],
  rawDefault: unknown,
  options: string[] | undefined,
): { value?: PipelineInputValue; issue?: string } {
  if (rawDefault === undefined) return {}
  if (inputType === 'boolean') {
    return typeof rawDefault === 'boolean' ? { value: rawDefault } : { issue: '布尔输入默认值必须是 true 或 false' }
  }
  if (inputType === 'number') {
    return typeof rawDefault === 'number' && Number.isFinite(rawDefault)
      ? { value: rawDefault }
      : { issue: '数字输入默认值必须是有限数字' }
  }
  if (inputType === 'string') {
    return typeof rawDefault === 'string' ? { value: rawDefault } : { issue: '字符串输入默认值必须是字符串' }
  }
  return typeof rawDefault === 'string' && (options ?? []).includes(rawDefault)
    ? { value: rawDefault }
    : { issue: 'choice 默认值必须出现在 options 中' }
}

function addIssue(issues: WorkflowIssue[], code: WorkflowIssueCode, message: string, path?: string): void {
  issues.push({ code, message, ...(path ? { path } : {}) })
}

function checkKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  basePath: string,
  issues: WorkflowIssue[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      addIssue(issues, 'WORKFLOW_UNSUPPORTED', `不支持的字段：${key}`, basePath ? `${basePath}.${key}` : key)
    }
  }
}

/** 判断文本是否在 env/with 之外的禁止位置引用了 secrets。 */
function referencesSecrets(value: string): boolean {
  return /\$\{\{\s*secrets\./.test(value)
}

/** 把 YAML 字段路径转换为定位节点所需的段；仅支持 map 键与数组下标。 */
function toPathSegments(fieldPath: string): Array<string | number> | null {
  const segments: Array<string | number> = []
  for (const part of fieldPath.split('.')) {
    const match = /^([A-Za-z0-9_-]*)(?:\[(\d+)\])?$/.exec(part)
    if (!match) return null
    const key = match[1]
    if (key) segments.push(key)
    const index = match[2]
    if (index !== undefined) segments.push(Number(index))
  }
  return segments
}

/**
 * 根据 YAML 字段路径定位行列号。
 * @param document 已解析的 YAML 文档。
 * @param content 原始文本，用于把字符偏移换算为行列。
 * @param fieldPath 字段路径，如 `jobs.build.steps[0].run`。
 * @returns 定位成功时返回 1 起始的行列；无法定位时返回空对象。
 * @remarks schema 校验基于 JS 对象，行号通过 YAML AST 的 range 反查，而不是重新解析。
 */
function locatePath(
  document: Document,
  content: string,
  fieldPath: string | undefined,
): { line?: number; column?: number } {
  if (!fieldPath) return {}
  const segments = toPathSegments(fieldPath)
  if (!segments || segments.length === 0) return {}
  const node: unknown = document.getIn(segments, true)
  if (typeof node !== 'object' || node === null || !('range' in node)) return {}
  const range: unknown = node.range
  const offset = Array.isArray(range) && typeof range[0] === 'number' ? range[0] : undefined
  if (offset === undefined) return {}
  const before = content.slice(0, offset)
  const line = before.split('\n').length
  const column = offset - before.lastIndexOf('\n')
  return { line, column }
}

/** 校验相对路径不逃逸工作区，且不含绝对路径与 Windows 盘符。 */
function validateRelativePath(value: string, path: string, issues: WorkflowIssue[]): boolean {
  const normalized = value.trim().replaceAll('\\', '/')
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '路径必须为工作区相对路径', path)
    return false
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..' || segment === '')) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '路径不能包含 .. 或空段', path)
    return false
  }
  return true
}

function normalizeEnv(value: unknown, path: string, issues: WorkflowIssue[]): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'env 必须是键值对象', path)
    return {}
  }
  const env: Record<string, string> = {}
  for (const [name, raw] of Object.entries(value)) {
    if (!ENV_NAME_PATTERN.test(name)) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', `环境变量名不合法：${name}`, `${path}.${name}`)
      continue
    }
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '环境变量值只能是字符串、数字或布尔值', `${path}.${name}`)
      continue
    }
    env[name] = String(raw)
  }
  return env
}

function parseInputs(value: unknown, issues: WorkflowIssue[]): Record<string, WorkflowInputDefinition> {
  if (value === undefined) return {}
  if (!isRecord(value)) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'workflow_dispatch.inputs 必须是对象', 'on.workflow_dispatch.inputs')
    return {}
  }
  if (Object.keys(value).length > 20) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '输入数量不能超过 20 个', 'on.workflow_dispatch.inputs')
  }
  const inputs: Record<string, WorkflowInputDefinition> = {}
  for (const [name, raw] of Object.entries(value)) {
    const path = `on.workflow_dispatch.inputs.${name}`
    if (!ENV_NAME_PATTERN.test(name)) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', `输入名不合法：${name}`, path)
      continue
    }
    if (!isRecord(raw)) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '输入定义必须是对象', path)
      continue
    }
    checkKeys(raw, INPUT_KEYS, path, issues)
    const type = raw.type ?? 'string'
    if (!isWorkflowInputType(type)) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '输入类型必须是 string、boolean、number 或 choice', `${path}.type`)
      continue
    }
    const required = raw.required ?? false
    if (typeof required !== 'boolean') {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'required 必须是布尔值', `${path}.required`)
      continue
    }
    let options: string[] | undefined
    if (type === 'choice') {
      if (!Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 20) {
        addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'choice 输入需要 2–20 个 options', `${path}.options`)
        continue
      }
      const seen = new Set<string>()
      options = []
      for (const option of raw.options) {
        if (typeof option !== 'string' || !option.trim() || option.length > 200 || seen.has(option)) {
          addIssue(
            issues,
            'WORKFLOW_SCHEMA_ERROR',
            'options 必须是非空、不重复、长度不超过 200 的字符串',
            `${path}.options`,
          )
          continue
        }
        seen.add(option)
        options.push(option)
      }
      if (options.length < 2) continue
    } else if (raw.options !== undefined) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '只有 choice 输入可以声明 options', `${path}.options`)
    }
    const defaultResult = readInputDefault(type, raw.default, options)
    if (defaultResult.issue) addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', defaultResult.issue, `${path}.default`)
    const defaultValue = defaultResult.value
    if (raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 200)) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'description 必须是不超过 200 字符的字符串', `${path}.description`)
    }
    inputs[name] = {
      type,
      required,
      ...(defaultValue !== undefined ? { defaultValue } : {}),
      ...(options ? { options } : {}),
      ...(typeof raw.description === 'string' ? { description: raw.description } : {}),
    }
  }
  return inputs
}

function parseSteps(value: unknown, jobPath: string, issues: WorkflowIssue[]): WorkflowStepDefinition[] {
  if (!Array.isArray(value) || value.length === 0) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'steps 必须是非空数组', `${jobPath}.steps`)
    return []
  }
  if (value.length > 100) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '步骤数量不能超过 100 个', `${jobPath}.steps`)
  }
  const steps: WorkflowStepDefinition[] = []
  for (const [index, raw] of value.entries()) {
    const path = `${jobPath}.steps[${index}]`
    if (!isRecord(raw)) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '步骤必须是对象', path)
      continue
    }
    checkKeys(raw, STEP_KEYS, path, issues)
    const hasRun = raw.run !== undefined
    const hasUses = raw.uses !== undefined
    if (hasRun === hasUses) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '步骤必须且只能包含 run 或 uses 之一', path)
      continue
    }
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `Step ${index + 1}`
    if (name.length > 120) addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '步骤名不能超过 120 字符', `${path}.name`)
    const env = normalizeEnv(raw.env, `${path}.env`, issues)
    let timeoutMinutes: number | undefined
    if (raw['timeout-minutes'] !== undefined) {
      const timeout = raw['timeout-minutes']
      if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 120) {
        addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'timeout-minutes 必须是 1–120 的整数', `${path}.timeout-minutes`)
      } else {
        timeoutMinutes = timeout
      }
    }
    const continueOnError = raw['continue-on-error'] ?? false
    if (typeof continueOnError !== 'boolean') {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'continue-on-error 必须是布尔值', `${path}.continue-on-error`)
    }
    let workingDirectory: string | undefined
    if (raw['working-directory'] !== undefined) {
      if (typeof raw['working-directory'] !== 'string') {
        addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'working-directory 必须是字符串', `${path}.working-directory`)
      } else if (validateRelativePath(raw['working-directory'], `${path}.working-directory`, issues)) {
        workingDirectory = raw['working-directory'].trim()
        if (referencesSecrets(workingDirectory)) {
          addIssue(
            issues,
            'WORKFLOW_SECRET_IN_UNSAFE_POSITION',
            'secrets 不能用于 working-directory',
            `${path}.working-directory`,
          )
        }
      }
    }
    let ifExpression: string | undefined
    if (raw.if !== undefined) {
      if (typeof raw.if !== 'string' || raw.if.length > 4_096) {
        addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'if 必须是不超过 4096 字符的字符串', `${path}.if`)
      } else {
        ifExpression = raw.if
        if (referencesSecrets(raw.if)) {
          addIssue(issues, 'WORKFLOW_SECRET_IN_UNSAFE_POSITION', 'secrets 不能用于 if 条件', `${path}.if`)
        }
      }
    }
    if (hasUses && raw['working-directory'] !== undefined) {
      addIssue(issues, 'WORKFLOW_UNSUPPORTED', '内置步骤不支持 working-directory', `${path}.working-directory`)
    }
    const withValues: Record<string, string> = {}
    if (raw.with !== undefined) {
      if (!isRecord(raw.with)) {
        addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'with 必须是键值对象', `${path}.with`)
      } else {
        for (const [key, withValue] of Object.entries(raw.with)) {
          if (typeof withValue !== 'string' && typeof withValue !== 'number' && typeof withValue !== 'boolean') {
            addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'with 值只能是字符串、数字或布尔值', `${path}.with.${key}`)
            continue
          }
          withValues[key] = String(withValue)
        }
      }
    }
    if (hasUses) {
      if (typeof raw.uses !== 'string' || !BUILTIN_ACTIONS.has(raw.uses)) {
        addIssue(issues, 'WORKFLOW_UNSUPPORTED', '不支持的内置步骤', `${path}.uses`)
        continue
      }
      if (raw.uses === 'builtin:checkout') {
        if (withValues['fetch-depth'] !== undefined && withValues['fetch-depth'] !== '1') {
          addIssue(issues, 'WORKFLOW_UNSUPPORTED', 'P1 只支持 fetch-depth: 1', `${path}.with.fetch-depth`)
        }
        for (const key of Object.keys(withValues)) {
          if (key !== 'fetch-depth')
            addIssue(issues, 'WORKFLOW_UNSUPPORTED', `checkout 不支持参数：${key}`, `${path}.with.${key}`)
        }
        steps.push({
          name,
          kind: 'builtin_checkout',
          env,
          continueOnError: continueOnError === true,
          with: withValues,
          ...(ifExpression ? { if: ifExpression } : {}),
          ...(timeoutMinutes ? { timeoutMinutes } : {}),
        })
      } else if (raw.uses === 'builtin:verify-service') {
        const allowedKeys = new Set(['healthUrl', 'versionUrl', 'expectedVersion', 'timeoutSeconds'])
        for (const key of Object.keys(withValues)) {
          if (!allowedKeys.has(key)) {
            addIssue(issues, 'WORKFLOW_UNSUPPORTED', `verify-service 不支持参数：${key}`, `${path}.with.${key}`)
          }
        }
        if (!withValues.healthUrl || !/^https?:\/\//.test(withValues.healthUrl)) {
          addIssue(
            issues,
            'WORKFLOW_SCHEMA_ERROR',
            'verify-service 需要合法的 with.healthUrl',
            `${path}.with.healthUrl`,
          )
        }
        if (withValues.versionUrl !== undefined && !/^https?:\/\//.test(withValues.versionUrl)) {
          addIssue(
            issues,
            'WORKFLOW_SCHEMA_ERROR',
            'verify-service 的 versionUrl 必须是 HTTP(S)',
            `${path}.with.versionUrl`,
          )
        }
        if (!withValues.expectedVersion) {
          addIssue(
            issues,
            'WORKFLOW_SCHEMA_ERROR',
            'verify-service 需要 with.expectedVersion',
            `${path}.with.expectedVersion`,
          )
        }
        if (withValues.timeoutSeconds !== undefined) {
          const timeoutSeconds = Number(withValues.timeoutSeconds)
          if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 5 || timeoutSeconds > 120) {
            addIssue(
              issues,
              'WORKFLOW_SCHEMA_ERROR',
              'timeoutSeconds 必须是 5–120 的整数',
              `${path}.with.timeoutSeconds`,
            )
          }
        }
        steps.push({
          name,
          kind: 'builtin_verify_service',
          env,
          continueOnError: continueOnError === true,
          with: withValues,
          ...(ifExpression ? { if: ifExpression } : {}),
          ...(timeoutMinutes ? { timeoutMinutes } : {}),
        })
      } else {
        const artifactName = withValues.name
        const artifactPath = withValues.path
        if (!artifactName || !ARTIFACT_NAME_PATTERN.test(artifactName)) {
          addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'upload-artifact 需要合法的 with.name', `${path}.with.name`)
        }
        if (!artifactPath) {
          addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'upload-artifact 需要 with.path', `${path}.with.path`)
        } else {
          validateRelativePath(artifactPath, `${path}.with.path`, issues)
          if (/[*?[\]]/.test(artifactPath)) {
            addIssue(issues, 'WORKFLOW_UNSUPPORTED', 'P1 不支持 glob 产物路径', `${path}.with.path`)
          }
        }
        steps.push({
          name,
          kind: 'builtin_upload_artifact',
          env,
          continueOnError: continueOnError === true,
          with: withValues,
          ...(ifExpression ? { if: ifExpression } : {}),
          ...(timeoutMinutes ? { timeoutMinutes } : {}),
        })
      }
      continue
    }
    if (typeof raw.run !== 'string' || !raw.run.trim()) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'run 必须是非空字符串', `${path}.run`)
      continue
    }
    if (raw.run.length > 65_536) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'run 不能超过 64 KB', `${path}.run`)
    }
    if (referencesSecrets(raw.run)) {
      addIssue(issues, 'WORKFLOW_SECRET_IN_UNSAFE_POSITION', 'secrets 不能用于 run 命令文本', `${path}.run`)
    }
    steps.push({
      name,
      kind: 'run',
      run: raw.run,
      env,
      continueOnError: continueOnError === true,
      with: withValues,
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(timeoutMinutes ? { timeoutMinutes } : {}),
      ...(ifExpression ? { if: ifExpression } : {}),
    })
  }
  const checkoutIndexes = steps
    .map((step, index) => (step.kind === 'builtin_checkout' ? index : -1))
    .filter((index) => index >= 0)
  if (checkoutIndexes.length === 0) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '每个 job 必须包含 builtin:checkout 步骤', `${jobPath}.steps`)
  } else {
    if (checkoutIndexes.length > 1) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '每个 job 只能有一个 builtin:checkout', `${jobPath}.steps`)
    }
    const checkoutIndex = checkoutIndexes[0]
    const firstRunIndex = steps.findIndex((step) => step.kind === 'run')
    if (checkoutIndex !== undefined && firstRunIndex >= 0 && checkoutIndex > firstRunIndex) {
      addIssue(
        issues,
        'WORKFLOW_SCHEMA_ERROR',
        'builtin:checkout 必须位于所有 run 步骤之前',
        `${jobPath}.steps[${checkoutIndex}]`,
      )
    }
  }
  return steps
}

function parseJobs(value: unknown, issues: WorkflowIssue[]): WorkflowJobDefinition[] {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'jobs 必须是非空对象', 'jobs')
    return []
  }
  if (Object.keys(value).length > 50) addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'job 数量不能超过 50 个', 'jobs')
  const jobs: WorkflowJobDefinition[] = []
  const ids = new Set(Object.keys(value))
  for (const [id, raw] of Object.entries(value)) {
    const path = `jobs.${id}`
    if (!JOB_ID_PATTERN.test(id)) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', `job id 不合法：${id}`, path)
      continue
    }
    if (!isRecord(raw)) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'job 必须是对象', path)
      continue
    }
    checkKeys(raw, JOB_KEYS, path, issues)
    if (typeof raw['runs-on'] !== 'string' || !raw['runs-on'].trim()) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'runs-on 必须是非空字符串', `${path}.runs-on`)
      continue
    }
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : id
    if (name.length > 80) addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'job 名不能超过 80 字符', `${path}.name`)
    const needsRaw = raw.needs
    const needs: string[] = []
    if (typeof needsRaw === 'string') needs.push(needsRaw)
    else if (Array.isArray(needsRaw)) {
      for (const need of needsRaw) {
        if (typeof need !== 'string')
          addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'needs 必须由 job id 字符串组成', `${path}.needs`)
        else needs.push(need)
      }
    } else if (needsRaw !== undefined) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'needs 必须是字符串或字符串数组', `${path}.needs`)
    }
    for (const need of needs) {
      if (!ids.has(need))
        addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', `needs 引用了不存在的 job：${need}`, `${path}.needs`)
      if (need === id) addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'job 不能依赖自身', `${path}.needs`)
    }
    let timeoutMinutes: number | undefined
    if (raw['timeout-minutes'] !== undefined) {
      const timeout = raw['timeout-minutes']
      if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 240) {
        addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'timeout-minutes 必须是 1–240 的整数', `${path}.timeout-minutes`)
      } else {
        timeoutMinutes = timeout
      }
    }
    const env = normalizeEnv(raw.env, `${path}.env`, issues)
    if (raw.if !== undefined && (typeof raw.if !== 'string' || raw.if.length > 4_096)) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'if 必须是不超过 4096 字符的字符串', `${path}.if`)
    }
    jobs.push({
      id,
      name,
      runsOn: raw['runs-on'].trim(),
      needs: [...new Set(needs)],
      env,
      steps: parseSteps(raw.steps, path, issues),
      ...(timeoutMinutes ? { timeoutMinutes } : {}),
      ...(typeof raw.if === 'string' ? { if: raw.if } : {}),
    })
  }
  detectCycles(jobs, issues)
  return jobs
}

function detectCycles(jobs: WorkflowJobDefinition[], issues: WorkflowIssue[]): void {
  const byId = new Map(jobs.map((job) => [job.id, job]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  function visit(id: string): void {
    if (visited.has(id)) return
    if (visiting.has(id)) {
      addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', `job 依赖存在环：${id}`, `jobs.${id}.needs`)
      return
    }
    visiting.add(id)
    for (const need of byId.get(id)?.needs ?? []) visit(need)
    visiting.delete(id)
    visited.add(id)
  }
  for (const job of jobs) visit(job.id)
}

function parseOn(value: unknown, issues: WorkflowIssue[]): Record<string, WorkflowInputDefinition> {
  if (value === undefined) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '缺少 on.workflow_dispatch', 'on')
    return {}
  }
  // `on: push` 这类事件字符串属于“不支持自动触发”，与结构错误分开，便于页面提示。
  if (typeof value === 'string') {
    addIssue(issues, 'WORKFLOW_UNSUPPORTED', `P1 不支持自动触发事件：${value}`, 'on')
    return {}
  }
  if (!isRecord(value)) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'on 必须是对象或事件名', 'on')
    return {}
  }
  for (const key of Object.keys(value)) {
    if (key !== 'workflow_dispatch') {
      addIssue(issues, 'WORKFLOW_UNSUPPORTED', `P1 不支持自动触发事件：${key}`, `on.${key}`)
    }
  }
  const dispatch = value.workflow_dispatch
  if (dispatch === undefined) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', '缺少 on.workflow_dispatch', 'on')
    return {}
  }
  if (dispatch === null) return {}
  if (!isRecord(dispatch)) {
    addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'workflow_dispatch 必须是对象或空值', 'on.workflow_dispatch')
    return {}
  }
  checkKeys(dispatch, new Set(['inputs']), 'on.workflow_dispatch', issues)
  return parseInputs(dispatch.inputs, issues)
}

/**
 * 解析并校验一个 workflow 文件；只做静态结构校验，表达式在计划阶段求值。
 * @param input 文件路径、内容与可选大小上限。
 * @returns 成功时返回解析结果；失败时返回全部可读错误，便于页面逐项展示。
 */
export function parseWorkflowFile(input: { path: string; content: string; maxBytes?: number }): ParseWorkflowResult {
  const maxBytes = input.maxBytes ?? PIPELINE_WORKFLOW_MAX_BYTES
  const size = Buffer.byteLength(input.content, 'utf8')
  if (size > maxBytes) {
    return {
      ok: false,
      issues: [{ code: 'WORKFLOW_PARSE_ERROR', message: `workflow 文件超过 ${maxBytes} 字节上限`, path: input.path }],
    }
  }
  const document = parseDocument(input.content, { prettyErrors: true })
  const first = document.errors[0]
  if (first) {
    return {
      ok: false,
      issues: [
        {
          code: 'WORKFLOW_PARSE_ERROR',
          message: first.message,
          path: input.path,
          ...(first.linePos?.[0] ? { line: first.linePos[0].line, column: first.linePos[0].col } : {}),
        },
      ],
    }
  }
  const raw = document.toJS()
  if (!isRecord(raw)) {
    return {
      ok: false,
      issues: [{ code: 'WORKFLOW_SCHEMA_ERROR', message: 'workflow 顶层必须是对象', path: input.path }],
    }
  }
  const issues: WorkflowIssue[] = []
  checkKeys(raw, TOP_LEVEL_KEYS, '', issues)
  const workflowName = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fileStem(input.path)
  if (workflowName.length > 80) addIssue(issues, 'WORKFLOW_SCHEMA_ERROR', 'workflow 名不能超过 80 字符', 'name')
  const inputs = parseOn(raw.on, issues)
  const env = normalizeEnv(raw.env, 'env', issues)
  const jobs = parseJobs(raw.jobs, issues)
  if (issues.length > 0) {
    const located = issues.map((issue) => ({
      ...issue,
      ...(issue.line === undefined ? locatePath(document, input.content, issue.path) : {}),
    }))
    return { ok: false, issues: located }
  }
  return {
    ok: true,
    workflow: {
      path: input.path,
      name: workflowName,
      hash: createHash('sha256').update(input.content).digest('hex'),
      snapshot: input.content,
      inputs,
      env,
      jobs,
    },
  }
}

function fileStem(filePath: string): string {
  const name = filePath.split('/').pop() ?? filePath
  return name.replace(/\.(ya?ml)$/i, '')
}

/** 判断路径是否位于平台工作流目录第一层且为 YAML 文件。 */
export function isPipelineWorkflowPath(filePath: string): boolean {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '')
  if (!normalized.startsWith(`${PIPELINE_WORKFLOW_DIRECTORY}/`)) return false
  const rest = normalized.slice(PIPELINE_WORKFLOW_DIRECTORY.length + 1)
  return rest.length > 0 && !rest.includes('/') && /\.(ya?ml)$/i.test(rest)
}
