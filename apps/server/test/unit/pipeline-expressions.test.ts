import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  evaluateCondition,
  PipelineExpressionError,
  resolveTemplateString,
} from '../../src/modules/pipeline/pipeline.expressions.ts'

const context = {
  env: { NODE_ENV: 'production' },
  inputs: { target: 'web', skip: false },
  github: { sha: 'a'.repeat(40), ref: 'refs/heads/main', repository: 'team/repo' },
  secrets: { NPM_TOKEN: 'token-value' },
}

test('替换 env、inputs、github 与 secrets', () => {
  assert.equal(resolveTemplateString('${{ github.sha }}', context, true), 'a'.repeat(40))
  assert.equal(resolveTemplateString('target=${{ inputs.target }}', context, true), 'target=web')
  assert.equal(resolveTemplateString('${{ env.NODE_ENV }}', context, true), 'production')
  assert.equal(resolveTemplateString('${{ secrets.NPM_TOKEN }}', context, true), 'token-value')
})

test('普通字符串不解析，未定义 env 为空字符串', () => {
  assert.equal(resolveTemplateString('plain', context, true), 'plain')
  assert.equal(resolveTemplateString('[${{ env.MISSING }}]', context, true), '[]')
})

test('禁止在非 env 位置使用 secrets', () => {
  assert.throws(() => resolveTemplateString('${{ secrets.NPM_TOKEN }}', context, false), PipelineExpressionError)
})

test('if 支持比较、布尔运算与括号', () => {
  assert.equal(evaluateCondition("${{ inputs.target == 'web' }}", context), true)
  assert.equal(evaluateCondition("${{ inputs.target == 'api' }}", context), false)
  assert.equal(evaluateCondition('${{ !inputs.skip }}', context), true)
  assert.equal(evaluateCondition("${{ inputs.target == 'web' && !inputs.skip }}", context), true)
  assert.equal(evaluateCondition("${{ inputs.target == 'api' || !inputs.skip }}", context), true)
})

test('非法条件与 secrets 条件被拒绝', () => {
  assert.throws(() => evaluateCondition('${{ env.NODE_ENV }}', context), PipelineExpressionError)
  assert.throws(() => evaluateCondition('${{ secrets.NPM_TOKEN }}', context), PipelineExpressionError)
  assert.throws(() => evaluateCondition('${{ lowercase(inputs.target) }}', context), PipelineExpressionError)
})
