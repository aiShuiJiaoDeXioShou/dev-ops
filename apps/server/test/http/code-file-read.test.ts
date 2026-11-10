import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createTestApp } from '../support/create-test-app.ts'

test('读取仓库文件与指定 ref 文件需要身份，并校验路径参数', async (t) => {
  const app = createTestApp()
  t.after(() => app.close())
  await app.ready()
  const projectId = randomUUID()
  const repositoryId = randomUUID()
  const baseUrl = `/api/v1/projects/${projectId}/repositories/${repositoryId}`

  const unauthenticated = await app.inject({
    method: 'GET',
    url: `${baseUrl}/file?path=.devops/workflows/ci.yml`,
  })
  assert.equal(unauthenticated.statusCode, 200)
  assert.equal(unauthenticated.json().success, false)
  assert.equal(unauthenticated.json().code, 'UNAUTHENTICATED')

  const missingPath = await app.inject({ method: 'GET', url: `${baseUrl}/file` })
  assert.equal(missingPath.statusCode, 200)
  assert.equal(missingPath.json().code, 'VALIDATION_ERROR')

  const oversizedPath = await app.inject({
    method: 'GET',
    url: `${baseUrl}/file?path=${'a'.repeat(501)}`,
  })
  assert.equal(oversizedPath.statusCode, 200)
  assert.equal(oversizedPath.json().code, 'VALIDATION_ERROR')

  const oversizedBranch = await app.inject({
    method: 'GET',
    url: `${baseUrl}/file?path=.devops/workflows/ci.yml&branch=${'b'.repeat(201)}`,
  })
  assert.equal(oversizedBranch.statusCode, 200)
  assert.equal(oversizedBranch.json().code, 'VALIDATION_ERROR')

  const wrongMethod = await app.inject({ method: 'POST', url: `${baseUrl}/file?path=x` })
  assert.equal(wrongMethod.statusCode, 200)
  assert.equal(wrongMethod.json().code, 'NOT_FOUND')
})
