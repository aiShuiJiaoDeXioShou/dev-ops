import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { gitHubUserAuthorization } from '../../src/modules/integrations/integrations.tables.ts'
import { pipelineRun } from '../../src/modules/pipeline/pipeline.tables.ts'
import { codeChange, projectCapabilityGrant } from '../../src/modules/tools/tools.tables.ts'
import {
  expectFailure,
  expectSuccess,
  injectJson,
  setupPipelineContext,
  stringField,
  TEST_COMMIT_SHA,
} from './pipeline-harness.ts'

test('GitHub 仓库继续按团队权限浏览，写入入口及流水线校验个人仓库权限', { timeout: 90_000 }, async (t) => {
  let permissions = { pull: false, push: false }
  let allowsFork = false
  let challenge: string | null = null
  let refreshCount = 0
  const context = await setupPipelineContext(t, {
    async githubUserFetcher(input, init) {
      const url = new URL(input instanceof Request ? input.url : input)
      if (url.href === 'https://github.com/login/oauth/access_token') {
        assert.ok(init?.body instanceof URLSearchParams)
        if (init.body.get('grant_type') === 'refresh_token') {
          refreshCount += 1
          assert.equal(init.body.get('refresh_token'), 'fixture-refresh-token')
          return Response.json({
            access_token: 'fixture-updated-token',
            refresh_token: 'fixture-next-refresh',
            expires_in: 3600,
          })
        }
        const verifier = init.body.get('code_verifier')
        assert.ok(verifier)
        assert.equal(createHash('sha256').update(verifier).digest('base64url'), challenge)
        assert.equal(init.body.get('redirect_uri'), 'http://localhost:5173/api/v1/git-authorizations/github/callback')
        return Response.json({
          access_token: 'fixture-user-token',
          refresh_token: 'fixture-refresh-token',
          expires_in: 3600,
        })
      }
      const auth = new Headers(init?.headers).get('authorization')
      assert.ok(auth === 'Bearer fixture-user-token' || auth === 'Bearer fixture-updated-token')
      if (url.href === 'https://api.github.com/user') return Response.json({ id: 17, login: 'project-developer' })
      assert.equal(url.href, 'https://api.github.com/repos/acme/app')
      return Response.json({ private: true, allow_forking: allowsFork, permissions })
    },
  })
  const { app, projectId, repositoryId, developer, viewer } = context
  context.git.adapter.isRepositoryPublic = async () => false
  context.git.adapter.listPullRequests = async () => []
  const base = `/api/v1/projects/${projectId}`
  const repositoryPath = `${base}/repositories/${repositoryId}`
  const edit = { action: 'edit_file', branch: 'feature/main', path: 'src/a b.ts' }
  const start = (cookie: string, returnTo: string) =>
    injectJson(app, 'POST', '/api/v1/me/github-account/authorize', {
      cookie,
      payload: { returnTo },
    })
  const openAction = (payload: Record<string, unknown>, cookie = developer.cookie) =>
    injectJson(app, 'POST', `${repositoryPath}/github-action`, { cookie, payload })
  const trigger = () =>
    injectJson(app, 'POST', `${base}/pipeline-runs`, {
      cookie: developer.cookie,
      payload: { workflowPath: '.devops/workflows/ci.yml', ref: 'main', idempotencyKey: 'check-personal-read' },
    })

  for (const url of [base, `${repositoryPath}/file?path=README.md`, `${repositoryPath}/pull-requests`]) {
    expectSuccess(await injectJson(app, 'GET', url, { cookie: viewer.cookie }), url)
  }
  expectFailure(await openAction(edit, viewer.cookie), 'FORBIDDEN')
  expectFailure(await openAction(edit), 'GITHUB_ACCOUNT_REQUIRED')
  expectFailure(await trigger(), 'GITHUB_ACCOUNT_REQUIRED')
  expectFailure(await start(developer.cookie, '//outside.example'), 'VALIDATION_ERROR')
  assert.deepEqual(await app.db.select({ id: pipelineRun.id }).from(pipelineRun), [])

  const authorization = expectSuccess(await start(developer.cookie, `/projects/${projectId}/code`), '个人授权')
  const oauthUrl = new URL(stringField(authorization, 'authorizationUrl'))
  const state = oauthUrl.searchParams.get('state')
  challenge = oauthUrl.searchParams.get('code_challenge')
  assert.ok(state && challenge)
  assert.equal(oauthUrl.searchParams.get('code_challenge_method'), 'S256')
  const callback = `/api/v1/git-authorizations/github/callback?state=${encodeURIComponent(state)}&code=fixture-code`
  const wrongSession = await app.inject({ method: 'GET', url: callback, headers: { cookie: viewer.cookie } })
  assert.equal(wrongSession.statusCode, 302)
  assert.match(String(wrongSession.headers.location), /githubAccount=failed$/)
  const authorized = await app.inject({ method: 'GET', url: callback, headers: { cookie: developer.cookie } })
  assert.equal(authorized.statusCode, 302)
  assert.equal(authorized.headers.location, `http://localhost:5173/projects/${projectId}/code?githubAccount=connected`)
  const account = await injectJson(app, 'GET', '/api/v1/me/github-account', { cookie: developer.cookie })
  assert.deepEqual(expectSuccess(account, '绑定状态'), { login: 'project-developer', enabled: true })
  assert.doesNotMatch(account.body, /fixture-(?:user|refresh)-token/)

  expectFailure(await openAction(edit), 'GITHUB_REPOSITORY_FORBIDDEN')
  expectFailure(await trigger(), 'GITHUB_REPOSITORY_FORBIDDEN')
  assert.deepEqual(await app.db.select({ id: pipelineRun.id }).from(pipelineRun), [])
  expectFailure(await openAction({ ...edit, path: '../README.md' }), 'VALIDATION_ERROR')

  permissions = { pull: true, push: false }
  expectSuccess(await trigger(), '只有仓库读取权限也能触发流水线')
  expectFailure(await openAction(edit), 'GITHUB_REPOSITORY_FORBIDDEN')
  expectFailure(await openAction({ action: 'create_pull_request' }), 'GITHUB_REPOSITORY_FORBIDDEN')
  allowsFork = true
  assert.equal(
    stringField(expectSuccess(await openAction({ action: 'create_pull_request' }), '从 Fork 创建 PR'), 'url'),
    'https://github.com/acme/app/compare',
  )

  const codeChangeId = randomUUID()
  await app.db.insert(codeChange).values({
    id: codeChangeId,
    team_id: context.teamId,
    project_id: projectId,
    repository_id: repositoryId,
    invocation_id: randomUUID(),
    base_ref: 'main',
    base_sha: TEST_COMMIT_SHA,
    branch_name: 'work/fixture',
    commit_message: '测试变更',
    author_name: '开发者',
    author_email: 'developer@example.test',
    patch: '+fixture',
    patch_sha256: 'fixture',
    patch_size_bytes: 8,
    validation_workflow_path: '.devops/workflows/ci.yml',
    status: 'succeeded',
    created_by_user_id: developer.userId,
  })
  await app.db.insert(projectCapabilityGrant).values({
    id: randomUUID(),
    team_id: context.teamId,
    project_id: projectId,
    grantee_user_id: developer.userId,
    capability: 'create_pull_request',
    granted_by_user_id: context.admin.userId,
  })
  const createPr = async () =>
    app.inject({
      method: 'POST',
      url: `/api/v1/tools/code-changes/${codeChangeId}/pull-requests`,
      headers: { cookie: developer.cookie, 'idempotency-key': randomUUID() },
      payload: { title: '测试创建 PR' },
    })
  const originalCreate = context.git.adapter.createPullRequest
  assert.ok(originalCreate)
  let tokenUsed: string | undefined
  context.git.adapter.createPullRequest = async (input, token) => {
    tokenUsed = token
    return originalCreate(input, token)
  }
  assert.equal((await createPr()).json().code, 'GITHUB_REPOSITORY_FORBIDDEN')
  assert.equal(tokenUsed, undefined)

  permissions = { pull: true, push: true }
  const [stored] = await app.db.select({ ciphertext: gitHubUserAuthorization.ciphertext }).from(gitHubUserAuthorization)
  assert.ok(stored)
  assert.doesNotMatch(stored.ciphertext, /fixture-(?:user|refresh)-token/)
  await app.db
    .update(gitHubUserAuthorization)
    .set({ expires_at: new Date(0) })
    .where(eq(gitHubUserAuthorization.user_id, developer.userId))
  const editResults = await Promise.all([openAction(edit), openAction(edit)])
  for (const result of editResults) {
    assert.equal(
      stringField(expectSuccess(result, '授权后的编辑地址'), 'url'),
      'https://github.com/acme/app/edit/feature%2Fmain/src/a%20b.ts',
    )
  }
  assert.equal(refreshCount, 1)
  assert.equal((await createPr()).json().code, 'OK')
  assert.equal(tokenUsed, 'fixture-updated-token')

  permissions = { pull: false, push: false }
  expectFailure(await trigger(), 'GITHUB_REPOSITORY_FORBIDDEN')
  expectSuccess(
    await injectJson(app, 'GET', `${repositoryPath}/file?path=README.md`, { cookie: developer.cookie }),
    '权限收回后仍能浏览平台代码',
  )
})
