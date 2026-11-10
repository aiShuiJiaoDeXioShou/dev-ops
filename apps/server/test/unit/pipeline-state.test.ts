import assert from 'node:assert/strict'
import { test } from 'node:test'
import { maskErrorMessage, maskInputValue, maskSensitiveText } from '../../src/modules/pipeline/pipeline.mask.ts'
import {
  hashPipelineToken,
  PIPELINE_NODE_CAPABILITY_WHITELIST,
  validateNodeCapabilities,
} from '../../src/modules/pipeline/pipeline.nodes.service.ts'
import {
  canTransitionRunStatus,
  canTransitionStepStatus,
  collectRunRequirements,
  isTerminalRunStatus,
  nodeSatisfiesRequirements,
  parseRunPlanTemplate,
  toInputSummary,
} from '../../src/modules/pipeline/pipeline.state.ts'
import { ApiError } from '../../src/platform/http/errors.ts'
import { resolveLogAfterSeq } from '../../src/modules/pipeline/pipeline.service.ts'
import { isDeclaredArtifactOverLimit, logSeqConflictData } from '../../src/modules/pipeline/pipeline.agent.service.ts'
import { shouldApplyLogAfterSeq } from '../../src/modules/pipeline/pipeline.repository.ts'

const template = {
  runId: 'run-1',
  workflowPath: '.devops/workflows/ci.yml',
  workflowName: 'ci',
  ref: 'main',
  commitSha: 'a'.repeat(40),
  repository: 'acme/app',
  timeoutSeconds: 1800,
  inputs: { target: 'web' },
  env: { CI: 'true' },
  secretNames: ['NPM_TOKEN'],
  jobs: [
    {
      id: 'build',
      name: 'Build',
      image: 'node:24-bookworm-slim',
      runsOn: ['linux', 'docker', 'node24'],
      timeoutSeconds: 1200,
      env: {},
      steps: [
        { index: 0, name: 'Checkout', kind: 'builtin_checkout', with: {} },
        { index: 1, name: 'Build', kind: 'run', run: 'pnpm build', env: {}, continueOnError: false },
      ],
    },
  ],
}

test('运行状态机只允许契约声明中的转换', () => {
  assert.equal(canTransitionRunStatus('queued', 'assigned'), true)
  assert.equal(canTransitionRunStatus('queued', 'cancelled'), true)
  assert.equal(canTransitionRunStatus('queued', 'running'), false)
  assert.equal(canTransitionRunStatus('assigned', 'running'), true)
  assert.equal(canTransitionRunStatus('running', 'cancelling'), true)
  assert.equal(canTransitionRunStatus('cancelling', 'cancelled'), true)
  assert.equal(canTransitionRunStatus('cancelling', 'failed'), true)
  assert.equal(canTransitionRunStatus('succeeded', 'failed'), false)
  assert.equal(isTerminalRunStatus('interrupted'), true)
  assert.equal(isTerminalRunStatus('cancelling'), false)
  assert.throws(() => canTransitionRunStatus('unknown', 'failed'), /数据库运行状态不合法/)
})

test('步骤状态机禁止跳过与回退，允许取消收口', () => {
  assert.equal(canTransitionStepStatus('pending', 'running'), true)
  assert.equal(canTransitionStepStatus('pending', 'skipped'), true)
  assert.equal(canTransitionStepStatus('running', 'succeeded'), true)
  assert.equal(canTransitionStepStatus('running', 'cancelled'), true)
  assert.equal(canTransitionStepStatus('pending', 'succeeded'), false)
  assert.equal(canTransitionStepStatus('succeeded', 'running'), false)
  assert.throws(() => canTransitionStepStatus('unknown', 'failed'), /数据库步骤状态不合法/)
})

test('运行计划模板校验拒绝结构不合法数据', () => {
  assert.equal(parseRunPlanTemplate(template).runId, 'run-1')
  assert.throws(() => parseRunPlanTemplate({ ...template, jobs: [] }), /运行计划快照不合法/)
  assert.throws(() => parseRunPlanTemplate({ ...template, secretNames: 'x' }), /运行计划快照不合法/)
})

test('能力标签匹配要求节点覆盖全部 runs-on 标签', () => {
  const parsed = parseRunPlanTemplate(template)
  const requirements = collectRunRequirements(parsed)
  assert.deepEqual(requirements, ['docker', 'linux', 'node24'])
  assert.equal(nodeSatisfiesRequirements(['linux', 'docker', 'node24'], requirements), true)
  assert.equal(nodeSatisfiesRequirements(['linux', 'node24'], requirements), false)
  assert.equal(nodeSatisfiesRequirements([], requirements), false)
})

test('日志与错误脱敏覆盖令牌、连接串与已知明文密钥', () => {
  const masked = maskSensitiveText(
    'Authorization: Bearer abcdefghijklmnop token=super-secret postgresql://user:pass@localhost/db ghp_123456789012345678901234',
    ['runtime-secret-value'],
  )
  assert.equal(masked.includes('abcdefghijklmnop'), false)
  assert.equal(masked.includes('super-secret'), false)
  assert.equal(masked.includes('user:pass@'), false)
  assert.equal(masked.includes('ghp_123456789012345678901234'), false)
  assert.equal(
    maskSensitiveText('value=runtime-secret-value', ['runtime-secret-value']).includes('runtime-secret-value'),
    false,
  )
  assert.equal(maskErrorMessage('  '), null)
  assert.equal(maskErrorMessage('token=abc'), 'token=***')
})

test('触发输入摘要按字段名脱敏且限制长度', () => {
  assert.equal(maskInputValue('NPM_TOKEN', 'plain-value'), '***')
  assert.equal(maskInputValue('target', 'web'), 'web')
  const summary = toInputSummary({ target: 'web', password: 'p', count: 3, enabled: false }, maskInputValue)
  assert.deepEqual(summary, { target: 'web', password: '***', count: 3, enabled: false })
})

test('节点能力白名单与令牌哈希稳定', () => {
  assert.deepEqual(validateNodeCapabilities(['linux', 'docker', 'linux']), ['linux', 'docker'])
  assert.deepEqual(PIPELINE_NODE_CAPABILITY_WHITELIST, ['linux', 'docker', 'node24'])
  assert.throws(() => validateNodeCapabilities([]), ApiError)
  assert.throws(() => validateNodeCapabilities(['kubernetes']), ApiError)
  assert.equal(hashPipelineToken('plain-token'), hashPipelineToken('plain-token'))
  assert.notEqual(hashPipelineToken('plain-token'), 'plain-token')
  assert.equal(hashPipelineToken('plain-token').length, 64)
})

test('日志读取默认游标包含 seq=0 首片', () => {
  assert.equal(resolveLogAfterSeq(undefined), -1)
  assert.equal(resolveLogAfterSeq(-1), -1)
  assert.equal(resolveLogAfterSeq(0), 0)
  assert.equal(resolveLogAfterSeq(5), 5)
})

test('日志序号冲突 data 返回平台已接受的最大序号供 Agent 续传', () => {
  assert.deepEqual(logSeqConflictData(1, 9), { acceptedThrough: { '1': 9 } })
  assert.deepEqual(logSeqConflictData(0, -1), { acceptedThrough: { '0': -1 } })
})

test('合并读取日志时忽略 afterSeq，指定步骤才应用增量游标', () => {
  assert.equal(shouldApplyLogAfterSeq(undefined), false)
  assert.equal(shouldApplyLogAfterSeq(0), true)
  assert.equal(shouldApplyLogAfterSeq(2), true)
})

test('产物上传按 Content-Length 预检超限，缺失或非法值交由流式计数兜底', () => {
  assert.equal(isDeclaredArtifactOverLimit(undefined, 1024), false)
  assert.equal(isDeclaredArtifactOverLimit('abc', 1024), false)
  assert.equal(isDeclaredArtifactOverLimit('1024', 1024), false)
  assert.equal(isDeclaredArtifactOverLimit('1025', 1024), true)
  assert.equal(isDeclaredArtifactOverLimit('104857600', 1024), true)
})
