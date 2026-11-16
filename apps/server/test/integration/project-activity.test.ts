import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { Client } from 'pg'
import {
  GitAdapterError,
  type GitAdapter,
  type GitCommitSummary,
  type GitPullRequestSummary,
} from '../../src/adapters/git/git.types.ts'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { gitRepository, projectRepository } from '../../src/modules/code/code.tables.ts'
import { gitConnection } from '../../src/modules/integrations/integrations.tables.ts'
import { createProjectDashboardSync } from '../../src/modules/projects/projects.dashboard-sync.ts'
import { DASHBOARD_SYNC_INTERVAL_MS } from '../../src/modules/projects/projects.dashboard.constants.ts'
import { projectDashboardRepository } from '../../src/modules/projects/projects.dashboard.tables.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

test('项目晴雨表：事项活动、项目摘要、筛选、来源未知与权限', { timeout: 90_000 }, async (t) => {
  const cleanup: Array<() => Promise<unknown>> = []
  t.after(async () => {
    const errors: unknown[] = []
    for (const dispose of cleanup.reverse()) {
      try {
        await dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, '测试资源清理失败')
  })
  const runtimeValue = process.env.DATABASE_URL
  const migrationValue = process.env.MIGRATION_DATABASE_URL
  const adminPassword = process.env.POSTGRES_PASSWORD
  assert.ok(runtimeValue && migrationValue && adminPassword, '请先执行 db:setup 和 db:up')
  const runtimeUrl = new URL(runtimeValue)
  const migrationUrl = new URL(migrationValue)
  const databaseName = `dev_ops_test_${randomBytes(8).toString('hex')}`
  const admin = new Client({
    host: runtimeUrl.hostname,
    port: Number(runtimeUrl.port || '5432'),
    user: 'postgres',
    password: adminPassword,
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  })
  await admin.connect()
  cleanup.push(async () => admin.end())
  await admin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
  cleanup.push(async () => admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`))
  await admin.query(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`)
  await admin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO dev_ops_app`)
  runtimeUrl.pathname = `/${databaseName}`
  migrationUrl.pathname = `/${databaseName}`
  await migrateDatabase(migrationUrl.href)
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    APP_ORIGIN: 'http://localhost:5173',
    AUTH_TRUSTED_ORIGINS: 'http://localhost:5173',
    DB_STATEMENT_TIMEOUT_MS: '1000',
    DB_LOCK_TIMEOUT_MS: '100',
  })
  let httpGitCalls = 0
  const app = createHttpApp(config, {
    mailer: new FakeMailer(),
    gitAdapterResolver: async () => {
      httpGitCalls += 1
      throw new Error('晴雨表 HTTP 请求不可读取 Git')
    },
  })
  cleanup.push(async () => app.close())

  const adminUser = await createAuthenticatedUser(app, { name: '管理员' })
  const viewerUser = await createAuthenticatedUser(app, { name: '浏览者' })
  const teamId = randomUUID()
  await app.db
    .insert(team)
    .values({ id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: adminUser.userId })
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: adminUser.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewerUser.userId, role: 'viewer', status: 'active' },
  ])
  const created = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/projects`,
    payload: { name: '晴雨表项目' },
    headers: { cookie: adminUser.cookie },
  })
  const projectId = created.json().data.id as string
  const requirement = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/requirements`,
    payload: { title: '需求一', contentMode: 'markdown', contentMarkdown: '正文' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(requirement.json().success, true, requirement.body)
  const bug = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectId}/bugs`,
    payload: { title: 'Bug 一', phenomenon: '现象', expectedBehavior: '预期', reproduction: '步骤' },
    headers: { cookie: adminUser.cookie },
  })
  assert.equal(bug.json().success, true, bug.body)
  const today = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const activity = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/project-activity?source=activity&from=${from}&to=${today}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(activity.json().success, true, activity.body)
  const data = activity.json().data
  assert.equal(data.timezone, 'UTC')
  assert.equal(data.source, 'activity')
  assert.equal(data.sourceStatus.code, 'unknown')
  assert.equal(data.sourceStatus.pullRequest, 'unknown')
  assert.equal(data.projects.length, 1)
  assert.equal(data.projects[0].items.total, 2)
  assert.equal(data.projects[0].pendingRequirements, 1)
  assert.equal(data.projects[0].pendingBugs, 1)
  assert.equal(data.projects[0].pendingPullRequests, null)
  assert.equal(data.projects[0].bots, null)
  assert.ok(data.days.length >= 7)
  assert.ok(data.days.some((day: { counts: { activity: number } }) => day.counts.activity > 0))

  const filtered = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/project-activity?search=不存在&from=${from}&to=${today}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(filtered.json().data.projects.length, 0)
  assert.equal(
    filtered.json().data.days.every((day: { total: number }) => day.total === 0),
    true,
  )

  const invalidWindow = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/project-activity?from=2024-01-01&to=${today}`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(invalidWindow.json().code, 'VALIDATION_ERROR')
  const forbidden = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${randomUUID()}/project-activity`,
    headers: { cookie: viewerUser.cookie },
  })
  assert.equal(forbidden.json().code, 'FORBIDDEN')

  await t.test('后台回填和增量同步写入本地，首页只读已授权仓库', async () => {
    const repositoryId = randomUUID()
    const connectionId = randomUUID()
    const anotherProject = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/projects`,
      payload: { name: '仓库复用项目' },
      headers: { cookie: adminUser.cookie },
    })
    assert.equal(anotherProject.json().success, true, anotherProject.body)
    const anotherProjectId: unknown = anotherProject.json().data.id
    assert.ok(typeof anotherProjectId === 'string')
    await app.db.insert(gitConnection).values({
      id: connectionId,
      team_id: teamId,
      provider_key: 'github',
      instance_url: 'https://github.com',
      name: '活动来源',
      auth_kind: 'github_cli',
      created_by_user_id: adminUser.userId,
    })
    await app.db.insert(gitRepository).values({
      id: repositoryId,
      team_id: teamId,
      connection_id: connectionId,
      provider_key: 'github',
      remote_repository_id: '123',
      namespace: 'example',
      name: 'source',
      web_url: 'https://github.com/example/source',
      default_branch: 'main',
    })
    await app.db.insert(projectRepository).values(
      [projectId, anotherProjectId].map((id) => ({
        id: randomUUID(),
        team_id: teamId,
        project_id: id,
        repository_id: repositoryId,
        created_by_user_id: adminUser.userId,
      })),
    )

    const getDashboard = async (source = 'all', search = '') => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/teams/${teamId}/project-activity?source=${source}&from=${from}&to=${today}&search=${encodeURIComponent(search)}`,
        headers: { cookie: viewerUser.cookie },
      })
      assert.equal(response.json().success, true, response.body)
      return response.json().data
    }
    const cold = await getDashboard()
    assert.deepEqual(cold.sourceStatus, { activity: 'ok', code: 'unknown', pullRequest: 'unknown' })
    assert.ok(cold.projects.every((row: { pendingPullRequests: number | null }) => row.pendingPullRequests === null))
    assert.equal(await app.db.$count(projectDashboardRepository), 0)

    let now = new Date()
    const commit = (letter: string): GitCommitSummary => ({
      sha: letter.repeat(40),
      title: '提交',
      authorName: '作者',
      committedAt: `${today}T08:00:00+08:00`,
      url: null,
    })
    const pr = (
      number: number,
      state: GitPullRequestSummary['state'],
      createdAt: string,
      updatedAt = createdAt,
    ): GitPullRequestSummary => ({
      number,
      state,
      createdAt,
      updatedAt,
      title: '合并请求',
      authorName: '作者',
      sourceBranch: 'work',
      targetBranch: 'main',
      reviewStatus: 'unknown',
      mergedAt: null,
      url: null,
    })
    const firstCommit = commit('a')
    const secondCommit = commit('b')
    const forcePushedCommit = commit('c')
    let commits = [firstCommit]
    const old = new Date(now.getTime() - 400 * 86_400_000).toISOString()
    const createdAt = `${today}T00:00:00.000Z`
    let pullRequests = [pr(2, 'open', createdAt, now.toISOString()), pr(1, 'open', old)]
    let recentCommitReads = 0
    let commitBackfills = 0
    let fastForwardReads = 0
    let failCommits = false
    const adapter: GitAdapter = {
      async checkConnection() {
        return { identity: 'example' }
      },
      async listRepositories() {
        return []
      },
      async getObject() {
        throw new Error('晴雨表不需要读取对象详情')
      },
      async listCommits(input) {
        if (failCommits) throw new GitAdapterError('unavailable', '测试来源不可用')
        if (!input.since) {
          recentCommitReads += 1
          return commits.slice(0, 1)
        }
        commitBackfills += 1
        assert.equal(input.ref, commits[0]?.sha)
        return input.page === 1 ? commits : []
      },
      async listFastForwardCommits(input) {
        fastForwardReads += 1
        if (input.base === firstCommit.sha && input.head === secondCommit.sha) return [secondCommit]
        return null
      },
      async listPullRequests(input) {
        assert.equal(input.sort, 'updated')
        const rows = pullRequests.filter((row) => input.state === 'all' || input.state === row.state)
        return rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
      },
    }
    const syncFailures: Array<Record<string, unknown>> = []
    const runSync = createProjectDashboardSync({
      db: app.db,
      resolveAdapter: async (connection) => {
        assert.equal(connection.id, connectionId)
        return adapter
      },
      now: () => now,
      log: (_message, context) => syncFailures.push(context),
    })
    const signal = new AbortController().signal
    const runNextSync = () => {
      now = new Date(now.getTime() + DASHBOARD_SYNC_INTERVAL_MS)
      return runSync(signal)
    }
    await Promise.all([runSync(signal), runSync(signal)])
    assert.equal(recentCommitReads, 1, '并发 Worker 只能领取一次')
    assert.equal(commitBackfills, 2)
    const initial = await getDashboard()
    assert.deepEqual(initial.sourceStatus, { activity: 'ok', code: 'ok', pullRequest: 'ok' })
    assert.equal(initial.days.at(-1).counts.code, 1, '同一个仓库关联两个项目也只计一次')
    assert.equal(initial.days.at(-1).counts.pullRequest, 1)
    assert.deepEqual(
      initial.projects.map((row: { pendingPullRequests: number }) => row.pendingPullRequests),
      [2, 2],
    )
    const onlyCode = await getDashboard('code', '晴雨表项目')
    assert.deepEqual(onlyCode.days.at(-1).counts, { activity: 0, code: 1, pullRequest: 0 })
    assert.equal(onlyCode.projects.length, 1)

    await runNextSync()
    assert.equal(recentCommitReads, 2)
    assert.equal(commitBackfills, 2, '分支头不变时跳过回填')
    assert.equal(fastForwardReads, 0)
    commits = [secondCommit, firstCommit]
    pullRequests = [
      pr(3, 'open', createdAt, now.toISOString()),
      pr(2, 'closed', createdAt, now.toISOString()),
      pr(1, 'closed', old, now.toISOString()),
    ]
    await runNextSync()
    assert.equal(fastForwardReads, 1)
    assert.equal(commitBackfills, 2, '快进只统计新增提交')
    await runNextSync()
    const updated = await getDashboard()
    assert.equal(updated.days.at(-1).counts.code, 2)
    assert.equal(updated.days.at(-1).counts.pullRequest, 2, '重复读取重叠窗口不重复累加 PR')
    assert.equal(updated.projects[0].pendingPullRequests, 1)

    failCommits = true
    await runNextSync()
    const partial = await getDashboard()
    assert.equal(partial.sourceStatus.code, 'unknown')
    assert.equal(partial.days.at(-1).counts.code, 0)
    assert.equal(partial.sourceStatus.pullRequest, 'ok')
    assert.deepEqual(syncFailures, [{ repositoryId, source: 'code', errorCode: 'unavailable' }])

    failCommits = false
    commits = [forcePushedCommit]
    await runNextSync()
    assert.equal(commitBackfills, 4)
    const rebuilt = await getDashboard()
    assert.equal(rebuilt.days.at(-1).counts.code, 1, '重写分支历史后替换旧统计')

    await app.db
      .update(gitRepository)
      .set({ default_branch: 'stable', updated_at: new Date() })
      .where(eq(gitRepository.id, repositoryId))
    const changedBranch = await getDashboard()
    assert.equal(changedBranch.sourceStatus.code, 'unknown')
    assert.equal(changedBranch.days.at(-1).counts.code, 0)
    await runNextSync()
    assert.equal(commitBackfills, 6, '默认分支变化时，即使分支头相同也重新核对')

    await app.db.delete(projectRepository).where(eq(projectRepository.project_id, projectId))
    const unlinked = await getDashboard('all', '晴雨表项目')
    assert.equal(unlinked.days.at(-1).counts.code, 0)
    assert.equal(unlinked.projects[0].pendingPullRequests, 0)
    await app.db
      .update(gitConnection)
      .set({ status: 'revoked', updated_at: new Date() })
      .where(eq(gitConnection.id, connectionId))
    const revoked = await getDashboard()
    assert.equal(revoked.days.at(-1).counts.code, 0)
    assert.equal(revoked.days.at(-1).counts.pullRequest, 0)
    assert.equal(revoked.sourceStatus.pullRequest, 'unknown')
    const readsBeforeRevokedSync = recentCommitReads
    await runNextSync()
    assert.equal(recentCommitReads, readsBeforeRevokedSync)
    assert.equal(httpGitCalls, 0)
  })
})
