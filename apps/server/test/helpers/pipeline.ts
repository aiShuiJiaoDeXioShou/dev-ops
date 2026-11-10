import assert from 'node:assert/strict'

/** 测试用流水线节点与运行最小字段集合，避免每个用例重复构造。 */
export interface PipelineTestRunSeed {
  teamId: string
  projectId: string
  repositoryId: string
  workflowPath?: string
  commitSha?: string
  ref?: string
  idempotencyKey?: string
  actorUserId: string
}

/**
 * 返回合法的流水线运行测试种子；调用方仍需按真实工作区替换项目与仓库标识。
 * @param input 种子字段，未提供的字段使用稳定的测试默认值。
 * @returns 可直接用于插入测试数据的字段集合。
 */
export function pipelineRunSeed(input: PipelineTestRunSeed) {
  return {
    workflow_path: input.workflowPath ?? '.devops/workflows/ci.yml',
    commit_sha: input.commitSha ?? 'a'.repeat(40),
    git_ref: input.ref ?? 'main',
    idempotency_key: input.idempotencyKey ?? `test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    inputs: {},
    run_plan: { jobs: [] },
    workflow_snapshot: 'name: test\non:\n  workflow_dispatch:\njobs: {}\n',
    workflow_hash: 'b'.repeat(64),
    status: 'queued',
    trigger_source: 'manual',
    initiator_channel: 'api',
    triggered_by_user_id: input.actorUserId,
    timeout_seconds: 3600,
  } as const
}

/** 校验一个 ISO 时间字符串可被 Date 解析。 */
export function assertIsoTimestamp(value: unknown): void {
  assert.equal(typeof value, 'string')
  assert.ok(!Number.isNaN(Date.parse(value as string)))
}
