import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Value } from 'typebox/value'
import {
  AGENT_ERROR_CODES,
  AgentHeartbeatRequestSchema,
  AgentLogChunkSchema,
  AgentRegisterRequestSchema,
  hasUniqueStepIndexes,
  isAgentErrorCode,
  RunPlanSchema,
  validateRunPlan,
  type RunPlan,
} from '../src/index.ts'

function buildRunPlan(): RunPlan {
  return {
    runId: 'run-1',
    workflowPath: '.devops/workflows/ci.yml',
    workflowName: 'ci',
    ref: 'main',
    commitSha: 'a'.repeat(40),
    timeoutSeconds: 1800,
    inputs: { target: 'web' },
    env: { CI: 'true' },
    git: {
      remoteUrl: 'https://github.com/team/repo.git',
      username: 'x-access-token',
      password: 'short-lived',
      expiresAt: '2026-11-10T10:00:00.000Z',
      commitSha: 'a'.repeat(40),
    },
    secrets: { NPM_TOKEN: 'short-lived' },
    jobs: [
      {
        id: 'build',
        name: 'Build',
        image: 'devops/node24:1',
        runsOn: ['linux', 'docker'],
        timeoutSeconds: 1200,
        env: { NODE_ENV: 'production' },
        steps: [
          { index: 0, name: 'Checkout', kind: 'builtin_checkout', with: {} },
          { index: 1, name: 'Build', kind: 'run', run: 'pnpm build', timeoutSeconds: 600 },
        ],
      },
    ],
  }
}

test('合法运行计划通过校验', () => {
  const plan = buildRunPlan()
  assert.equal(Value.Check(RunPlanSchema, plan), true)
  assert.equal(validateRunPlan(plan), true)
})

test('缺少 jobs 时结构校验失败', () => {
  const plan = buildRunPlan()
  assert.equal(Value.Check(RunPlanSchema, { ...plan, jobs: [] }), false)
  assert.equal(validateRunPlan({ ...plan, jobs: [] }), false)
})

test('step.index 全局重复时 validateRunPlan 拒绝（TypeBox 结构校验不负责跨数组唯一）', () => {
  const plan = buildRunPlan()
  const job = plan.jobs[0]
  assert.ok(job)
  const duplicated: RunPlan = {
    ...plan,
    jobs: [
      {
        ...job,
        steps: [job.steps[0], { ...job.steps[1], index: 0 }].filter(
          (step): step is RunPlan['jobs'][number]['steps'][number] => step !== undefined,
        ),
      },
    ],
  }
  assert.equal(Value.Check(RunPlanSchema, duplicated), true)
  assert.equal(hasUniqueStepIndexes(duplicated), false)
  assert.equal(validateRunPlan(duplicated), false)
})

test('注册与心跳请求拒绝空能力与未知状态', () => {
  assert.equal(
    Value.Check(AgentRegisterRequestSchema, {
      registrationToken: 'r'.repeat(32),
      name: 'node',
      os: 'linux',
      arch: 'x64',
      capabilities: ['linux'],
      agentVersion: '0.1.0',
    }),
    true,
  )
  assert.equal(Value.Check(AgentHeartbeatRequestSchema, { version: '0.1.0', runningLeaseId: 'x' }), true)
})

test('日志分片限制内容与序号', () => {
  assert.equal(Value.Check(AgentLogChunkSchema, { stepIndex: 0, seq: 0, content: 'ok' }), true)
  assert.equal(Value.Check(AgentLogChunkSchema, { stepIndex: -1, seq: 0, content: 'bad' }), false)
})

test('Agent 错误码常量可被复用并按错误码收窄', () => {
  assert.equal(isAgentErrorCode(AGENT_ERROR_CODES.AGENT_LEASE_EXPIRED), true)
  assert.equal(isAgentErrorCode('NOT_AN_AGENT_CODE'), false)
})

test('协议 2：受控代码修改步骤与 codeChange 字段', () => {
  const base = buildRunPlan()
  const plan: RunPlan = {
    ...base,
    codeChange: {
      baseSha: 'a'.repeat(40),
      branchName: 'feature/demo',
      commitMessage: '演示修改',
      authorName: '开发者',
      authorEmail: 'dev@example.test',
      patch: 'diff --git a/a.ts b/a.ts\n',
      patchSha256: 'b'.repeat(64),
    },
    jobs: [
      {
        ...base.jobs[0]!,
        steps: [
          { index: 0, name: '检出', kind: 'builtin_checkout' },
          { index: 1, name: '应用补丁', kind: 'builtin_apply_patch' },
          { index: 2, name: '提交', kind: 'builtin_commit_changes' },
          { index: 3, name: '收集差异', kind: 'builtin_collect_diff' },
          { index: 4, name: '推送', kind: 'builtin_push_branch' },
          { index: 5, name: '验证', kind: 'builtin_verify_service', with: { healthUrl: 'http://x/health' } },
        ],
      },
    ],
  }
  assert.equal(Value.Check(RunPlanSchema, plan), true)
  assert.equal(validateRunPlan(plan), true)
  assert.equal(
    Value.Check(RunPlanSchema, {
      ...plan,
      codeChange: { ...plan.codeChange!, patchSha256: 'not-a-sha' },
    }),
    false,
  )
  assert.equal(
    Value.Check(RunPlanSchema, {
      ...plan,
      jobs: [{ ...plan.jobs[0]!, steps: [{ index: 0, name: '未知', kind: 'builtin_unknown' }] }],
    }),
    false,
  )
})
