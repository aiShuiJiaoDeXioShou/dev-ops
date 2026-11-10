import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateRunPlan, materializeRunPlan, PipelinePlanError } from '../../src/modules/pipeline/pipeline.planner.ts'
import { parseWorkflowFile } from '../../src/modules/pipeline/pipeline.workflow.ts'

const workflowYaml = `name: web-build
on:
  workflow_dispatch:
    inputs:
      target:
        type: choice
        options: [web, api]
        default: web
      requiredName:
        type: string
        required: true
env:
  NODE_ENV: production
jobs:
  build:
    runs-on: linux
    timeout-minutes: 20
    steps:
      - uses: builtin:checkout
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Build
        run: pnpm --dir apps/web build
        env:
          TARGET: \${{ inputs.target }}
      - name: Upload
        uses: builtin:upload-artifact
        with:
          name: web-dist
          path: apps/web/dist
`

function parseValidWorkflow() {
  const result = parseWorkflowFile({ path: '.devops/workflows/ci.yml', content: workflowYaml })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('fixture 解析失败')
  return result.workflow
}

const github = { sha: 'a'.repeat(40), ref: 'refs/heads/main', repository: 'team/repo' }

function planInputs(overrides: Record<string, string | boolean | number> = {}) {
  return { requiredName: 'demo', ...overrides }
}

test('生成串行运行计划并分配全局步骤序号', () => {
  const template = generateRunPlan({
    workflow: parseValidWorkflow(),
    runId: 'run-1',
    ref: 'main',
    commitSha: github.sha,
    inputs: planInputs(),
    github,
    defaultRunTimeoutSeconds: 3600,
  })
  assert.equal(template.jobs.length, 1)
  assert.deepEqual(
    template.jobs[0]?.steps.map((step) => step.index),
    [0, 1, 2, 3],
  )
  assert.equal(template.jobs[0]?.steps[2]?.env?.TARGET, 'web')
  assert.equal(template.jobs[0]?.steps[2]?.timeoutSeconds, 600)
  assert.equal(template.inputs.requiredName, 'demo')
})

test('输入必填、未知输入与 choice 校验', () => {
  const workflow = parseValidWorkflow()
  assert.throws(
    () =>
      generateRunPlan({
        workflow,
        runId: 'r',
        ref: 'main',
        commitSha: github.sha,
        inputs: {},
        github,
        defaultRunTimeoutSeconds: 60,
      }),
    PipelinePlanError,
  )
  assert.throws(
    () =>
      generateRunPlan({
        workflow,
        runId: 'r',
        ref: 'main',
        commitSha: github.sha,
        inputs: { requiredName: 'x', extra: 'y' },
        github,
        defaultRunTimeoutSeconds: 60,
      }),
    PipelinePlanError,
  )
  assert.throws(
    () =>
      generateRunPlan({
        workflow,
        runId: 'r',
        ref: 'main',
        commitSha: github.sha,
        inputs: planInputs({ target: 'invalid' }),
        github,
        defaultRunTimeoutSeconds: 60,
      }),
    PipelinePlanError,
  )
})

test('未知 runs-on 标签与逻辑条件跳过', () => {
  const unknownRunner = parseWorkflowFile({
    path: '.devops/workflows/ci.yml',
    content: workflowYaml.replace('runs-on: linux', 'runs-on: windows'),
  })
  assert.equal(unknownRunner.ok, true)
  if (unknownRunner.ok) {
    assert.throws(
      () =>
        generateRunPlan({
          workflow: unknownRunner.workflow,
          runId: 'r',
          ref: 'main',
          commitSha: github.sha,
          inputs: planInputs(),
          github,
          defaultRunTimeoutSeconds: 60,
        }),
      PipelinePlanError,
    )
  }
})

test('secrets 在模板中保留，物化后替换', () => {
  const withSecret = parseWorkflowFile({
    path: '.devops/workflows/ci.yml',
    content: workflowYaml.replace(
      '  NODE_ENV: production',
      '  NODE_ENV: production\n  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}',
    ),
  })
  assert.equal(withSecret.ok, true)
  if (!withSecret.ok) return
  const template = generateRunPlan({
    workflow: withSecret.workflow,
    runId: 'r',
    ref: 'main',
    commitSha: github.sha,
    inputs: planInputs(),
    github,
    defaultRunTimeoutSeconds: 60,
  })
  assert.ok(template.secretNames.includes('NPM_TOKEN'))
  assert.equal(template.env.NPM_TOKEN, '${{ secrets.NPM_TOKEN }}')
  const materialized = materializeRunPlan(template, {
    git: {
      remoteUrl: 'https://github.com/team/repo.git',
      username: 'x-access-token',
      password: 'token',
      expiresAt: '2026-11-10T10:00:00.000Z',
      commitSha: github.sha,
    },
    secrets: { NPM_TOKEN: 'secret-value' },
  })
  assert.equal(materialized.env.NPM_TOKEN, 'secret-value')
  assert.equal(materialized.jobs[0]?.steps[0]?.env?.NODE_ENV, 'production')
})

test('缺少物化密钥与 run 中引用 secrets 被拒绝', () => {
  const withSecret = parseWorkflowFile({
    path: '.devops/workflows/ci.yml',
    content: workflowYaml.replace(
      '  NODE_ENV: production',
      '  NODE_ENV: production\n  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}',
    ),
  })
  assert.equal(withSecret.ok, true)
  if (!withSecret.ok) return
  const template = generateRunPlan({
    workflow: withSecret.workflow,
    runId: 'r',
    ref: 'main',
    commitSha: github.sha,
    inputs: planInputs(),
    github,
    defaultRunTimeoutSeconds: 60,
  })
  assert.throws(
    () =>
      materializeRunPlan(template, {
        git: {
          remoteUrl: 'https://github.com/team/repo.git',
          username: 'x-access-token',
          password: 'token',
          expiresAt: '2026-11-10T10:00:00.000Z',
          commitSha: github.sha,
        },
        secrets: {},
      }),
    PipelinePlanError,
  )
  // run 文本中的 secrets 属于禁止位置，静态解析阶段即拒绝（不再进入计划求值）。
  const secretInRun = parseWorkflowFile({
    path: '.devops/workflows/ci.yml',
    content: workflowYaml.replace('run: pnpm install --frozen-lockfile', 'run: echo ${{ secrets.TOKEN }}'),
  })
  assert.equal(secretInRun.ok, false)
  if (!secretInRun.ok) {
    assert.equal(
      secretInRun.issues.some((issue) => issue.code === 'WORKFLOW_SECRET_IN_UNSAFE_POSITION'),
      true,
    )
  }
})
