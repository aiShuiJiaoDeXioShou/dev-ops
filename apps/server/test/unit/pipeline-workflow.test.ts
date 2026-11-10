import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPipelineWorkflowPath, parseWorkflowFile } from '../../src/modules/pipeline/pipeline.workflow.ts'

const validWorkflow = `name: web-build
on:
  workflow_dispatch:
    inputs:
      target:
        type: choice
        options: [web, api]
        default: web
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
      - uses: builtin:upload-artifact
        with:
          name: web-dist
          path: apps/web/dist
`

test('合法 workflow 解析成功并保留快照', () => {
  const result = parseWorkflowFile({ path: '.devops/workflows/ci.yml', content: validWorkflow })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.workflow.name, 'web-build')
  assert.equal(result.workflow.jobs.length, 1)
  assert.equal(result.workflow.jobs[0]?.steps[2]?.kind, 'run')
  assert.equal(result.workflow.inputs.target?.type, 'choice')
  assert.equal(result.workflow.hash.length, 64)
})

test('缺少 checkout、未知字段与自动触发事件被拒绝', () => {
  const noCheckout = validWorkflow.replace('      - uses: builtin:checkout\n', '')
  const result = parseWorkflowFile({ path: '.devops/workflows/ci.yml', content: noCheckout })
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.message.includes('builtin:checkout')))

  const push = validWorkflow.replace('  workflow_dispatch:', '  push:')
  const pushResult = parseWorkflowFile({ path: '.devops/workflows/ci.yml', content: push })
  assert.equal(pushResult.ok, false)

  const unknown = validWorkflow.replace('    runs-on: linux', '    runs-on: linux\n    strategy: {}')
  const unknownResult = parseWorkflowFile({ path: '.devops/workflows/ci.yml', content: unknown })
  assert.equal(unknownResult.ok, false)
  if (!unknownResult.ok) assert.ok(unknownResult.issues.some((issue) => issue.message.includes('strategy')))
})

test('动作 uses 仅接受内置步骤', () => {
  const invalid = validWorkflow.replace('- uses: builtin:checkout', '- uses: actions/checkout@v4')
  const result = parseWorkflowFile({ path: '.devops/workflows/ci.yml', content: invalid })
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.issues.some((issue) => issue.code === 'WORKFLOW_UNSUPPORTED'))
})

test('产物路径逃逸与 glob 被拒绝', () => {
  const traversal = validWorkflow.replace('path: apps/web/dist', 'path: ../outside')
  assert.equal(parseWorkflowFile({ path: '.devops/workflows/ci.yml', content: traversal }).ok, false)
  const glob = validWorkflow.replace('path: apps/web/dist', 'path: apps/web/dist/**')
  assert.equal(parseWorkflowFile({ path: '.devops/workflows/ci.yml', content: glob }).ok, false)
})

test('文件大小上限与路径判断', () => {
  const result = parseWorkflowFile({ path: '.devops/workflows/ci.yml', content: validWorkflow, maxBytes: 10 })
  assert.equal(result.ok, false)
  assert.equal(isPipelineWorkflowPath('.devops/workflows/ci.yml'), true)
  assert.equal(isPipelineWorkflowPath('.github/workflows/ci.yml'), false)
  assert.equal(isPipelineWorkflowPath('.devops/workflows/nested/ci.yml'), false)
})

test('内置步骤的 if 与 timeout-minutes 不再被静默丢弃', () => {
  const result = parseWorkflowFile({
    path: '.devops/workflows/ci.yml',
    content: `name: builtin-options
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: linux
    steps:
      - uses: builtin:checkout
        if: \${{ inputs.target == 'web' }}
      - uses: builtin:upload-artifact
        if: \${{ inputs.target == 'web' }}
        timeout-minutes: 5
        with:
          name: dist
          path: apps/web/dist
`,
  })
  assert.equal(result.ok, true)
  if (!result.ok) return
  const steps = result.workflow.jobs[0]?.steps ?? []
  assert.equal(steps[0]?.if, "${{ inputs.target == 'web' }}")
  assert.equal(steps[1]?.timeoutMinutes, 5)
})

test('checkout 必须位于所有 run 步骤之前而不是必须第一步', () => {
  const result = parseWorkflowFile({
    path: '.devops/workflows/ci.yml',
    content: `name: order
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: linux
    steps:
      - uses: builtin:checkout
      - name: Build
        run: pnpm build
      - uses: builtin:upload-artifact
        with:
          name: dist
          path: dist
`,
  })
  assert.equal(result.ok, true)

  const invalid = parseWorkflowFile({
    path: '.devops/workflows/ci.yml',
    content: `name: order
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: linux
    steps:
      - name: Build
        run: pnpm build
      - uses: builtin:checkout
`,
  })
  assert.equal(invalid.ok, false)
  if (invalid.ok) return
  assert.equal(
    invalid.issues.some((issue) => issue.message.includes('builtin:checkout 必须位于所有 run 步骤之前')),
    true,
  )
})

test('on 缺失与事件字符串分别归为 schema / unsupported 错误', () => {
  const missing = parseWorkflowFile({
    path: '.devops/workflows/missing.yml',
    content: 'name: missing\njobs: {}\n',
  })
  assert.equal(missing.ok, false)
  if (!missing.ok) {
    assert.equal(missing.issues[0]?.code, 'WORKFLOW_SCHEMA_ERROR')
  }
  const unsupported = parseWorkflowFile({
    path: '.devops/workflows/push.yml',
    content: 'name: push\non: push\njobs: {}\n',
  })
  assert.equal(unsupported.ok, false)
  if (!unsupported.ok) {
    assert.equal(unsupported.issues[0]?.code, 'WORKFLOW_UNSUPPORTED')
  }
})

test('secrets 用于 if / run / working-directory 等禁止位置返回专用错误码', () => {
  const build = (step: string) => `name: unsafe
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: linux
    steps:
      - uses: builtin:checkout
${step}
`
  const cases = [
    build("      - name: Step\n        if: ${{ secrets.TOKEN == 'x' }}\n        run: echo ok"),
    build('      - name: Step\n        run: echo ${{ secrets.TOKEN }}'),
    build('      - name: Step\n        run: echo ok\n        working-directory: ${{ secrets.TOKEN }}'),
  ]
  for (const content of cases) {
    const result = parseWorkflowFile({ path: '.devops/workflows/unsafe.yml', content })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(
        result.issues.some((issue) => issue.code === 'WORKFLOW_SECRET_IN_UNSAFE_POSITION'),
        true,
        JSON.stringify(result.issues),
      )
    }
  }
})

test('schema 错误尽量携带字段路径与行列号', () => {
  const result = parseWorkflowFile({
    path: '.devops/workflows/locate.yml',
    content: `name: locate
on:
  workflow_dispatch:
jobs:
  build:
    runs-on: linux
    steps:
      - uses: builtin:checkout
      - name: Broken
        run: echo ok
        timeout-minutes: 999
`,
  })
  assert.equal(result.ok, false)
  if (result.ok) return
  const issue = result.issues.find((item) => item.path === 'jobs.build.steps[1].timeout-minutes')
  assert.ok(issue)
  const line = issue.line
  assert.equal(typeof line, 'number')
  if (typeof line !== 'number') return
  assert.equal(line > 0, true)
})
