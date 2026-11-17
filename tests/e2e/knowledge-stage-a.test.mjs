import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLocalHttpFixture } from './support/local-http.mjs'

test('真实 HTTP：团队 Skills 发布、版本保留与停用', { timeout: 120_000 }, async (t) => {
  const fixture = await createLocalHttpFixture(t)
  if (!fixture) return
  const { request, post, teamId } = fixture
  const fields = {
    name: 'E2E 技能',
    identifier: 'e2e-skill',
    category: 'engineering',
    contentVersion: '1.0.0',
    summary: 'E2E 简述',
    content: '# E2E\n\n检查风险。',
    files: [{ path: 'references/check.md', content: '检查项', encoding: 'utf8' }],
  }
  const created = await post(`/api/v1/teams/${teamId}/skills`, fields)
  assert.equal(created.body.success, true, created.body.message)
  const skill = created.body.data
  const list = await request(`/api/v1/teams/${teamId}/skills?search=E2E`)
  assert.equal(list.body.data.total, 1)
  const skillPath = `/api/v1/skills/${skill.id}`
  const changed = await post(`${skillPath}/update`, {
    version: skill.version,
    name: fields.name,
    category: fields.category,
    contentVersion: '1.1.0',
    summary: fields.summary,
    content: '# E2E\n\n核对交付风险。',
  })
  assert.equal(changed.body.success, true, changed.body.message)
  const versions = await request(`${skillPath}/versions`)
  assert.deepEqual(
    versions.body.data.items.map(({ contentVersion }) => contentVersion),
    ['1.1.0', '1.0.0'],
  )
  const previous = await request(`${skillPath}/versions/${versions.body.data.items[1].id}`)
  assert.equal(previous.body.data.content, fields.content)
  const disabled = await post(`${skillPath}/disable`, { version: changed.body.data.version })
  assert.equal(disabled.body.success, true, disabled.body.message)
  assert.equal((await request(skillPath)).body.data.enabled, false)
  assert.equal((await request('/api/v1/ready')).body.success, true)
})
