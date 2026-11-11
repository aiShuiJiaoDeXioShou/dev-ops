import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertExecutionTransition,
  assertPlanTransition,
  canTransitionExecution,
  canTransitionPlan,
  isExecutionActive,
  isPlanActive,
  isPlanEditable,
} from '../../src/modules/operations/operations.state.ts'

test('变更计划状态迁移只允许规格定义路径', () => {
  assert.equal(canTransitionPlan('pending', 'approved'), true)
  assert.equal(canTransitionPlan('approved', 'executing'), true)
  assert.equal(canTransitionPlan('executing', 'verifying'), true)
  assert.equal(canTransitionPlan('verifying', 'completed'), true)
  assert.equal(canTransitionPlan('failed', 'approved'), true)
  assert.equal(canTransitionPlan('pending', 'completed'), false)
  assert.equal(canTransitionPlan('completed', 'executing'), false)
  assert.equal(canTransitionPlan('cancelled', 'approved'), false)
  assert.throws(() => assertPlanTransition('pending', 'completed'), /不能从 pending 迁移到 completed/)
})

test('执行尝试状态迁移与活动状态判断', () => {
  assert.equal(canTransitionExecution('queued', 'running'), true)
  assert.equal(canTransitionExecution('running', 'timed_out'), true)
  assert.equal(canTransitionExecution('succeeded', 'unverified'), true)
  assert.equal(canTransitionExecution('failed', 'running'), false)
  assert.throws(() => assertExecutionTransition('failed', 'running'), /不能从 failed 迁移到 running/)
  assert.equal(isExecutionActive('queued'), true)
  assert.equal(isExecutionActive('unverified'), false)
})

test('计划可编辑与占用目标活动位的判定', () => {
  assert.equal(isPlanEditable('pending'), true)
  assert.equal(isPlanEditable('approved'), false)
  assert.equal(isPlanActive('approved'), true)
  assert.equal(isPlanActive('executing'), true)
  assert.equal(isPlanActive('verifying'), true)
  assert.equal(isPlanActive('pending'), false)
  assert.equal(isPlanActive('failed'), false)
})
