import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FakeMailer } from './support/fake-mailer.ts'
import { createFakeGitData } from './support/fake-git.ts'
import { createTestApp } from './support/create-test-app.ts'

test('fake mailer records messages without network access', async () => {
  const mailer = new FakeMailer()
  await mailer.send({ to: 'user@example.test', subject: '邀请', text: '正文' })
  assert.equal(mailer.sent.length, 1)
  assert.equal(mailer.sent[0]?.subject, '邀请')
})

test('fake git data is deterministic and isolated per call', () => {
  const first = createFakeGitData()
  const second = createFakeGitData()
  first.repositories.push({ id: 'extra', owner: 'example', name: 'extra', visibility: 'public', defaultBranch: 'main' })
  assert.equal(second.repositories.length, 2)
  assert.equal(second.repositories[1]?.visibility, 'private')
})

test('test app factory creates an injectable app', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  const response = await app.inject('/api/v1/health')
  assert.equal(response.statusCode, 200)
  assert.equal(response.json().success, true)
})
