import assert from 'node:assert/strict'
import { test } from 'node:test'
import { idempotencyScopeFor } from '../../src/platform/http/idempotency-hooks.ts'

const TEAM_A = '11111111-1111-4111-8111-111111111111'
const TEAM_B = '22222222-2222-4222-8222-222222222222'

test('幂等作用域使用实际路径，跨团队复用同一 key 不会互相冲突', () => {
  const a = idempotencyScopeFor({ url: `/api/v1/teams/${TEAM_A}/projects?page=1`, params: { teamId: TEAM_A } })
  const b = idempotencyScopeFor({ url: `/api/v1/teams/${TEAM_B}/projects`, params: { teamId: TEAM_B } })
  assert.equal(a.scope, `/api/v1/teams/${TEAM_A}/projects`, '查询串不进入作用域')
  assert.notEqual(a.scope, b.scope, '不同团队的资源路径必须产生不同作用域')
  assert.equal(a.teamId, TEAM_A)
  assert.equal(b.teamId, TEAM_B)
})

test('无法确定团队时回退 nil UUID，非 UUID 参数不被采用', () => {
  const result = idempotencyScopeFor({ url: '/api/v1/platform/teams', params: { teamId: 'team-1' } })
  assert.equal(result.scope, '/api/v1/platform/teams')
  assert.equal(result.teamId, '00000000-0000-0000-0000-000000000000')
})
