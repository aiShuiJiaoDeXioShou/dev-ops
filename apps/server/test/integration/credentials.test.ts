import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { activity } from '../../src/modules/collaboration/collaboration.tables.ts'
import {
  credential,
  credentialProjectGrant,
  credentialUsage,
  credentialVersion,
  projectEnvVar,
} from '../../src/modules/configuration/configuration.tables.ts'
import { createSecretCipher } from '../../src/modules/configuration/configuration.crypto.ts'
import { team, teamMember } from '../../src/modules/identity/identity.tables.ts'
import { createAuthenticatedUser } from '../support/auth.ts'
import { registerConfigurationRoutes } from '../support/configuration-app.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>

/** 断言响应为成功信封并返回 data 字段，测试内保持宽松类型便于逐层断言。 */
function expectSuccess(response: InjectResponse) {
  const body = response.json()
  assert.equal(body.success, true, response.body)
  return body.data as Record<string, unknown>
}

/** 断言响应为指定业务错误码的失败信封（HTTP 仍为 200）。 */
function expectFailure(response: InjectResponse, code: string) {
  assert.equal(response.statusCode, 200, response.body)
  const body = response.json()
  assert.equal(body.success, false, response.body)
  assert.equal(body.code, code, response.body)
  return body as { message: string }
}

/** 断言响应体内不出现任何凭据明文。 */
function assertNoPlaintext(response: InjectResponse, plaintexts: string[]) {
  for (const plaintext of plaintexts) {
    assert.ok(!response.body.includes(plaintext), '响应不得包含凭据明文')
  }
}

/** 断言凭据视图只返回元数据与掩码。 */
function assertCredentialViewMasked(response: InjectResponse, view: Record<string, unknown>, plaintexts: string[]) {
  assert.equal(view.maskedValue, '••••••••')
  assert.ok(!('value' in view), '凭据响应不得包含 value 字段')
  assert.ok(!('ciphertext' in view), '凭据响应不得包含密文字段')
  assertNoPlaintext(response, plaintexts)
}

test('凭据库与环境变量：加密、授权、轮换、撤销、过期阻断、使用记录与权限', { timeout: 120_000 }, async (t) => {
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
  assert.equal(runtimeUrl.hostname, '127.0.0.1', '集成测试仅允许本机 Compose 数据库')
  assert.equal(migrationUrl.host, runtimeUrl.host)
  assert.equal(runtimeUrl.username, 'dev_ops_app')
  assert.equal(migrationUrl.username, 'dev_ops_migrator')

  const databaseName = `dev_ops_test_${randomBytes(8).toString('hex')}`
  const pgAdmin = new Client({
    host: runtimeUrl.hostname,
    port: Number(runtimeUrl.port || '5432'),
    user: 'postgres',
    password: adminPassword,
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  })
  await pgAdmin.connect()
  cleanup.push(async () => {
    await pgAdmin.end()
  })
  await pgAdmin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
  cleanup.push(async () => {
    await pgAdmin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
  })
  await pgAdmin.query(`REVOKE ALL ON DATABASE "${databaseName}" FROM PUBLIC`)
  await pgAdmin.query(`GRANT CONNECT ON DATABASE "${databaseName}" TO dev_ops_app`)
  runtimeUrl.pathname = `/${databaseName}`
  migrationUrl.pathname = `/${databaseName}`
  await migrateDatabase(migrationUrl.href)

  // 测试密钥只用于本次隔离数据库；bootstrap 不设置 GIT_CREDENTIAL_ENCRYPTION_KEY，
  // 由 helper 显式注册路由，避免与正式的条件注册重复。
  const encryptionKey = randomBytes(32).toString('base64')
  const cipher = createSecretCipher(encryptionKey)
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: runtimeUrl.href,
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    APP_ORIGIN: 'http://localhost:5173',
    AUTH_TRUSTED_ORIGINS: 'http://localhost:5173',
    DB_STATEMENT_TIMEOUT_MS: '2000',
    DB_LOCK_TIMEOUT_MS: '500',
  })
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  registerConfigurationRoutes(app, encryptionKey)
  cleanup.push(async () => {
    await app.close()
  })

  const admin = await createAuthenticatedUser(app, { name: '管理员' })
  const developer = await createAuthenticatedUser(app, { name: '开发者' })
  const viewer = await createAuthenticatedUser(app, { name: '浏览者' })
  const outsider = await createAuthenticatedUser(app, { name: '外团队管理员' })
  const teamId = randomUUID()
  const otherTeamId = randomUUID()
  await app.db.insert(team).values([
    { id: teamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: admin.userId },
    { id: otherTeamId, name: `team-${randomBytes(3).toString('hex')}`, created_by_user_id: outsider.userId },
  ])
  await app.db.insert(teamMember).values([
    { id: randomUUID(), team_id: teamId, user_id: admin.userId, role: 'admin', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: developer.userId, role: 'developer', status: 'active' },
    { id: randomUUID(), team_id: teamId, user_id: viewer.userId, role: 'viewer', status: 'active' },
    { id: randomUUID(), team_id: otherTeamId, user_id: outsider.userId, role: 'admin', status: 'active' },
  ])

  async function createProject(cookie: string, team: string, name: string) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${team}/projects`,
      payload: { name },
      headers: { cookie },
    })
    return expectSuccess(response).id as string
  }
  const projectA = await createProject(admin.cookie, teamId, '凭据测试项目 A')
  const projectB = await createProject(admin.cookie, teamId, '凭据测试项目 B')
  const projectC = await createProject(admin.cookie, teamId, '未授权项目 C')
  const otherProject = await createProject(outsider.cookie, otherTeamId, '其他团队项目')

  const originalValue = 'sk-live-original-secret-0001'
  const rotatedValue = 'sk-live-rotated-secret-0002'
  const secretValues = [originalValue, rotatedValue]

  // 1. 管理员创建凭据：响应只含元数据与掩码，密文按版本落库。
  const createCredentialResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/credentials`,
    payload: {
      name: '生产 API 密钥',
      kind: 'api_key',
      description: '部署流水线使用',
      value: originalValue,
      projectGrants: [{ projectId: projectA }],
    },
    headers: { cookie: admin.cookie },
  })
  const credentialView = expectSuccess(createCredentialResponse)
  assertCredentialViewMasked(createCredentialResponse, credentialView, secretValues)
  assert.equal(credentialView.name, '生产 API 密钥')
  assert.equal(credentialView.kind, 'api_key')
  assert.equal(credentialView.status, 'active')
  assert.equal(credentialView.currentVersion, 1)
  const credentialId = credentialView.id as string
  const grants = credentialView.grants as Array<Record<string, unknown>>
  assert.equal(grants.length, 1)
  assert.equal(grants[0]?.projectId, projectA)
  assert.equal(grants[0]?.projectName, '凭据测试项目 A')

  const versionRows = await app.db
    .select()
    .from(credentialVersion)
    .where(eq(credentialVersion.credential_id, credentialId))
  assert.equal(versionRows.length, 1)
  const firstVersion = versionRows[0]
  assert.ok(firstVersion)
  assert.notEqual(firstVersion.ciphertext, originalValue)
  assert.ok(!firstVersion.ciphertext.includes(originalValue))
  assert.equal(
    cipher.decrypt({
      ciphertext: firstVersion.ciphertext,
      iv: firstVersion.iv,
      authTag: firstVersion.auth_tag,
      keyVersion: firstVersion.key_version,
    }),
    originalValue,
  )

  // 2. 名称冲突与跨团队授权被拒绝，且不产生部分保存。
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/credentials`,
      payload: { name: '生产 API 密钥', kind: 'api_key', value: 'another-secret' },
      headers: { cookie: admin.cookie },
    }),
    'CREDENTIAL_NAME_DUPLICATE',
  )
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/credentials`,
      payload: {
        name: '跨团队凭据',
        kind: 'api_key',
        value: 'another-secret',
        projectGrants: [{ projectId: otherProject }],
      },
      headers: { cookie: admin.cookie },
    }),
    'FORBIDDEN',
  )
  const credentialsAfterFailure = await app.db
    .select({ id: credential.id })
    .from(credential)
    .where(and(eq(credential.team_id, teamId), eq(credential.name, '跨团队凭据')))
  assert.equal(credentialsAfterFailure.length, 0, '失败的创建操作不得部分保存')

  // 3. 权限：开发者不能创建，浏览者不能访问凭据库，跨团队一律拒绝。
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/teams/${teamId}/credentials`,
      payload: { name: '开发者创建', kind: 'api_key', value: 'x' },
      headers: { cookie: developer.cookie },
    }),
    'FORBIDDEN',
  )
  expectFailure(
    await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${teamId}/credentials`,
      headers: { cookie: viewer.cookie },
    }),
    'FORBIDDEN',
  )
  expectFailure(
    await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${teamId}/credentials`,
      headers: { cookie: outsider.cookie },
    }),
    'FORBIDDEN',
  )

  // 4. 开发者只能看到已授权凭据元数据，未授权凭据不可见也不可查详情。
  const ungrantedCredentialResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${teamId}/credentials`,
    payload: { name: '未授权团队密钥', kind: 'ssh_key', value: 'ssh-secret-value' },
    headers: { cookie: admin.cookie },
  })
  const ungrantedCredentialId = expectSuccess(ungrantedCredentialResponse).id as string
  const developerList = expectSuccess(
    await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${teamId}/credentials`,
      headers: { cookie: developer.cookie },
    }),
  )
  const developerItems = developerList.items as Array<Record<string, unknown>>
  assert.deepEqual(
    developerItems.map((item) => item.id),
    [credentialId],
  )
  const developerDetail = await app.inject({
    method: 'GET',
    url: `/api/v1/teams/${teamId}/credentials/${credentialId}`,
    headers: { cookie: developer.cookie },
  })
  const developerDetailView = expectSuccess(developerDetail)
  assertCredentialViewMasked(developerDetail, developerDetailView, secretValues)
  assert.ok(Array.isArray(developerDetailView.recentUsage))
  expectFailure(
    await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${teamId}/credentials/${ungrantedCredentialId}`,
      headers: { cookie: developer.cookie },
    }),
    'FORBIDDEN',
  )

  // 5. 追加项目授权并记录授权活动。
  const grantResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/credentials/${credentialId}/grants`,
    payload: { projectId: projectB },
    headers: { cookie: admin.cookie },
  })
  const grantedView = expectSuccess(grantResponse)
  assert.equal((grantedView.grants as unknown[]).length, 2)

  // 6. 环境变量：普通变量可维护，密钥引用只保存引用；名称同项目同环境唯一。
  const envVarCreateResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectA}/environments/development/variables`,
    payload: { name: 'APP_NAME', kind: 'plain', value: 'web-demo' },
    headers: { cookie: developer.cookie },
  })
  const appNameView = expectSuccess(envVarCreateResponse)
  assert.equal(appNameView.kind, 'plain')
  assert.equal(appNameView.valuePreview, 'web-demo')
  assert.equal(appNameView.masked, false)
  assert.equal(appNameView.status, 'active')
  assert.equal(appNameView.version, 1)
  assert.equal(appNameView.credential, null)
  const appNameId = appNameView.id as string

  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectA}/environments/development/variables`,
      payload: { name: 'APP_NAME', kind: 'plain', value: 'duplicated' },
      headers: { cookie: developer.cookie },
    }),
    'ENV_VAR_NAME_DUPLICATE',
  )
  // 环境之间不自动继承，同名变量可分别存在于不同环境。
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectA}/environments/test/variables`,
      payload: { name: 'APP_NAME', kind: 'plain', value: 'web-demo-test' },
      headers: { cookie: developer.cookie },
    }),
  )

  const refCreateResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/projects/${projectA}/environments/development/variables`,
    payload: { name: 'API_TOKEN', kind: 'credential_ref', credentialId },
    headers: { cookie: developer.cookie },
  })
  const refView = expectSuccess(refCreateResponse)
  assert.equal(refView.kind, 'credential_ref')
  assert.equal(refView.valuePreview, null)
  assert.equal(refView.masked, true)
  assert.equal((refView.credential as Record<string, unknown>).id, credentialId)
  assert.equal((refView.credential as Record<string, unknown>).currentVersion, 1)
  const refVariableId = refView.id as string
  assertNoPlaintext(refCreateResponse, secretValues)

  // 未授权项目引用被拒绝，并留下拒绝使用记录（不含明文）。
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectC}/environments/development/variables`,
      payload: { name: 'API_TOKEN', kind: 'credential_ref', credentialId },
      headers: { cookie: developer.cookie },
    }),
    'CREDENTIAL_NOT_GRANTED',
  )
  const deniedUsage = await app.db
    .select()
    .from(credentialUsage)
    .where(and(eq(credentialUsage.credential_id, credentialId), eq(credentialUsage.result, 'denied')))
  assert.equal(deniedUsage.length, 1)
  assert.equal(deniedUsage[0]?.error_code, 'CREDENTIAL_NOT_GRANTED')
  assert.equal(deniedUsage[0]?.project_id, projectC)
  assert.equal(deniedUsage[0]?.environment, 'development')

  // 普通变量不能保存疑似密钥值。
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectA}/environments/development/variables`,
      payload: { name: 'DATABASE_PASSWORD', kind: 'plain', value: 'should-use-ref' },
      headers: { cookie: developer.cookie },
    }),
    'VALIDATION_ERROR',
  )
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectA}/environments/development/variables`,
      payload: {
        name: 'PRIVATE_KEY',
        kind: 'plain',
        value: '-----BEGIN RSA PRIVATE KEY-----content',
      },
      headers: { cookie: developer.cookie },
    }),
    'VALIDATION_ERROR',
  )

  // 7. 浏览者只看到名称与配置状态，不能写入；跨团队不能读取。
  const viewerListResponse = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/${projectA}/environments/development/variables`,
    headers: { cookie: viewer.cookie },
  })
  const viewerItems = expectSuccess(viewerListResponse).items as Array<Record<string, unknown>>
  const viewerAppName = viewerItems.find((item) => item.name === 'APP_NAME')
  const viewerRef = viewerItems.find((item) => item.name === 'API_TOKEN')
  assert.ok(viewerAppName && viewerRef)
  assert.equal(viewerAppName.valuePreview, null)
  assert.equal(viewerAppName.masked, true)
  assert.equal(viewerRef.credential, null)
  assert.equal(viewerRef.masked, true)
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectA}/environments/development/variables`,
      payload: { name: 'VIEWER_WRITE', kind: 'plain', value: 'x' },
      headers: { cookie: viewer.cookie },
    }),
    'FORBIDDEN',
  )
  expectFailure(
    await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectA}/environments/development/variables`,
      headers: { cookie: outsider.cookie },
    }),
    'FORBIDDEN',
  )

  // 8. 轮换：保持引用标识、递增版本、历史版本可追溯，旧版本不再作为当前版本使用。
  const rotateResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/credentials/${credentialId}/rotate`,
    payload: { value: rotatedValue, reason: '定期轮换' },
    headers: { cookie: admin.cookie },
  })
  const rotatedView = expectSuccess(rotateResponse)
  assertCredentialViewMasked(rotateResponse, rotatedView, secretValues)
  assert.equal(rotatedView.currentVersion, 2)
  assert.equal((rotatedView.grants as unknown[]).length, 2)
  const versionsAfterRotate = await app.db
    .select()
    .from(credentialVersion)
    .where(eq(credentialVersion.credential_id, credentialId))
  assert.equal(versionsAfterRotate.length, 2)
  const secondVersion = versionsAfterRotate.find((row) => row.version === 2)
  assert.ok(secondVersion)
  assert.equal(secondVersion.rotated_from_version, 1)
  assert.equal(
    cipher.decrypt({
      ciphertext: secondVersion.ciphertext,
      iv: secondVersion.iv,
      authTag: secondVersion.auth_tag,
      keyVersion: secondVersion.key_version,
    }),
    rotatedValue,
  )
  const envListAfterRotate = expectSuccess(
    await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectA}/environments/development/variables`,
      headers: { cookie: developer.cookie },
    }),
  )
  const refAfterRotate = (envListAfterRotate.items as Array<Record<string, unknown>>).find(
    (item) => item.name === 'API_TOKEN',
  )
  assert.ok(refAfterRotate)
  assert.equal((refAfterRotate.credential as Record<string, unknown>).currentVersion, 2)
  assert.equal(refAfterRotate.status, 'active')

  // 9. 项目授权撤销后引用立即失效，恢复授权后恢复可用。
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/grants/${projectA}/revoke`,
      payload: { reason: '暂停项目使用' },
      headers: { cookie: admin.cookie },
    }),
  )
  async function findRefVariable(): Promise<Record<string, unknown> | undefined> {
    const list = expectSuccess(
      await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectA}/environments/development/variables`,
        headers: { cookie: developer.cookie },
      }),
    )
    return (list.items as Array<Record<string, unknown>>).find((item) => item.name === 'API_TOKEN')
  }
  const refAfterGrantRevoke = await findRefVariable()
  assert.ok(refAfterGrantRevoke)
  assert.equal(refAfterGrantRevoke.status, 'invalid')
  assert.equal(refAfterGrantRevoke.invalidReason, 'grant_revoked')
  const storedInvalid = await app.db
    .select({ status: projectEnvVar.status })
    .from(projectEnvVar)
    .where(eq(projectEnvVar.id, refVariableId))
  assert.equal(storedInvalid[0]?.status, 'invalid')
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/grants`,
      payload: { projectId: projectA },
      headers: { cookie: admin.cookie },
    }),
  )
  const refAfterRegrant = await findRefVariable()
  assert.ok(refAfterRegrant)
  assert.equal(refAfterRegrant.status, 'active')
  assert.equal(refAfterRegrant.invalidReason, null)

  // 10. 授权到期后引用失效（通过数据库把期限回拨到过去，避免等待真实时间）。
  await app.db
    .update(credentialProjectGrant)
    .set({ expires_at: new Date(Date.now() - 60_000), updated_at: new Date() })
    .where(and(eq(credentialProjectGrant.credential_id, credentialId), eq(credentialProjectGrant.project_id, projectA)))
  const refAfterGrantExpired = await findRefVariable()
  assert.ok(refAfterGrantExpired)
  assert.equal(refAfterGrantExpired.invalidReason, 'grant_expired')
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/grants`,
      payload: { projectId: projectA },
      headers: { cookie: admin.cookie },
    }),
  )

  // 11. 凭据到期后引用失效并阻断新的引用；过期状态仍保留，不删除历史。
  await app.db
    .update(credential)
    .set({ expires_at: new Date(Date.now() - 60_000), updated_at: new Date() })
    .where(eq(credential.id, credentialId))
  const detailAfterExpiry = expectSuccess(
    await app.inject({
      method: 'GET',
      url: `/api/v1/teams/${teamId}/credentials/${credentialId}`,
      headers: { cookie: admin.cookie },
    }),
  )
  assert.equal(detailAfterExpiry.status, 'expired')
  const refAfterCredentialExpired = await findRefVariable()
  assert.ok(refAfterCredentialExpired)
  assert.equal(refAfterCredentialExpired.invalidReason, 'credential_expired')
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectA}/environments/test/variables`,
      payload: { name: 'EXPIRED_TOKEN', kind: 'credential_ref', credentialId },
      headers: { cookie: developer.cookie },
    }),
    'CREDENTIAL_UNAVAILABLE',
  )
  const expiredUsage = await app.db
    .select()
    .from(credentialUsage)
    .where(and(eq(credentialUsage.credential_id, credentialId), eq(credentialUsage.result, 'expired')))
  assert.ok(expiredUsage.length >= 1)

  // 清除期限后继续验证撤销流程。
  await app.db
    .update(credential)
    .set({ expires_at: null, updated_at: new Date() })
    .where(eq(credential.id, credentialId))
  assert.equal((await findRefVariable())?.status, 'active')

  // 12. 撤销凭据：后续引用被阻断，相关环境变量显示失效，历史使用记录保留。
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/revoke`,
      payload: { reason: '凭据泄露处置' },
      headers: { cookie: admin.cookie },
    }),
  )
  const refAfterCredentialRevoke = await findRefVariable()
  assert.ok(refAfterCredentialRevoke)
  assert.equal(refAfterCredentialRevoke.status, 'invalid')
  assert.equal(refAfterCredentialRevoke.invalidReason, 'credential_revoked')
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectA}/environments/test/variables`,
      payload: { name: 'REVOKED_TOKEN', kind: 'credential_ref', credentialId },
      headers: { cookie: developer.cookie },
    }),
    'CREDENTIAL_UNAVAILABLE',
  )
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/revoke`,
      payload: { reason: '重复撤销' },
      headers: { cookie: admin.cookie },
    }),
    'INVALID_TRANSITION',
  )
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/credentials/${credentialId}/rotate`,
      payload: { value: 'sk-live-third-secret' },
      headers: { cookie: admin.cookie },
    }),
    'INVALID_TRANSITION',
  )
  // 撤销不删除历史版本与使用记录。
  assert.equal(
    (await app.db.select().from(credentialVersion).where(eq(credentialVersion.credential_id, credentialId))).length,
    2,
  )

  // 13. 使用记录：管理员可看全部，开发者只看到已授权项目范围，均不含明文。
  const usageResponse = await app.inject({
    method: 'GET',
    url: `/api/v1/credentials/${credentialId}/usage`,
    headers: { cookie: admin.cookie },
  })
  const usageData = expectSuccess(usageResponse)
  const usageItems = usageData.items as Array<Record<string, unknown>>
  const usageActions = new Set(usageItems.map((item) => item.action))
  for (const action of ['create', 'grant', 'rotate', 'revoke', 'revoke_grant', 'use']) {
    assert.ok(usageActions.has(action), `使用记录缺少动作 ${action}`)
  }
  for (const plaintext of secretValues) {
    assert.ok(!usageResponse.body.includes(plaintext), '使用记录不得包含明文')
  }
  const rotateUsage = usageItems.find((item) => item.action === 'rotate')
  assert.equal(rotateUsage?.credentialVersion, 2)
  const developerUsage = expectSuccess(
    await app.inject({
      method: 'GET',
      url: `/api/v1/credentials/${credentialId}/usage`,
      headers: { cookie: developer.cookie },
    }),
  )
  for (const item of developerUsage.items as Array<Record<string, unknown>>) {
    assert.ok(
      item.projectId === null || item.projectId === projectA || item.projectId === projectB,
      '开发者不得查看未授权项目的使用记录',
    )
  }
  expectFailure(
    await app.inject({
      method: 'GET',
      url: `/api/v1/credentials/${ungrantedCredentialId}/usage`,
      headers: { cookie: developer.cookie },
    }),
    'FORBIDDEN',
  )

  // 14. 环境变量更新使用乐观锁，改名/改值写活动但不记录取值。
  const updateAppName = expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/v1/project-variables/${appNameId}/update`,
      payload: { version: 1, value: 'web-demo-v2' },
      headers: { cookie: developer.cookie },
    }),
  )
  assert.equal(updateAppName.version, 2)
  assert.equal(updateAppName.valuePreview, 'web-demo-v2')
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/project-variables/${appNameId}/update`,
      payload: { version: 1, value: 'stale-write' },
      headers: { cookie: developer.cookie },
    }),
    'VERSION_CONFLICT',
  )
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/project-variables/${refVariableId}/update`,
      payload: { version: 1, credentialId: ungrantedCredentialId },
      headers: { cookie: developer.cookie },
    }),
    'CREDENTIAL_NOT_GRANTED',
  )
  expectSuccess(
    await app.inject({
      method: 'POST',
      url: `/api/v1/project-variables/${appNameId}/remove`,
      payload: { reason: '变量下线' },
      headers: { cookie: developer.cookie },
    }),
  )
  const listAfterRemove = expectSuccess(
    await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectA}/environments/development/variables`,
      headers: { cookie: developer.cookie },
    }),
  )
  assert.ok(
    !(listAfterRemove.items as Array<Record<string, unknown>>).some((item) => item.name === 'APP_NAME'),
    '删除后列表不得再出现该变量',
  )

  // 15. 跨团队凭据引用被拒绝：其他团队凭据不能进入本项目环境变量。
  const otherCredentialResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/teams/${otherTeamId}/credentials`,
    payload: {
      name: '其他团队密钥',
      kind: 'api_key',
      value: 'other-team-secret-value',
      projectGrants: [{ projectId: otherProject }],
    },
    headers: { cookie: outsider.cookie },
  })
  const otherCredentialId = expectSuccess(otherCredentialResponse).id as string
  expectFailure(
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectA}/environments/development/variables`,
      payload: { name: 'CROSS_TEAM_TOKEN', kind: 'credential_ref', credentialId: otherCredentialId },
      headers: { cookie: developer.cookie },
    }),
    'CREDENTIAL_NOT_GRANTED',
  )

  // 16. 数据库保证密钥引用不复制值；活动与使用记录均不含明文。
  const refRow = await app.db.select().from(projectEnvVar).where(eq(projectEnvVar.id, refVariableId))
  assert.equal(refRow[0]?.value_text, null)
  assert.equal(refRow[0]?.credential_id, credentialId)
  const plainRow = await app.db
    .select()
    .from(projectEnvVar)
    .where(and(eq(projectEnvVar.project_id, projectA), eq(projectEnvVar.environment, 'test')))
  const plainTestRow = plainRow.find((row) => row.name === 'APP_NAME')
  assert.ok(plainTestRow)
  assert.equal(plainTestRow.credential_id, null)

  const activityRows = await app.db
    .select()
    .from(activity)
    .where(
      and(
        eq(activity.team_id, teamId),
        inArray(activity.entity_type, ['credential', 'credential_grant', 'project_env_var']),
      ),
    )
  assert.ok(activityRows.length > 0)
  const activityText = JSON.stringify(activityRows)
  for (const plaintext of secretValues) {
    assert.ok(!activityText.includes(plaintext), '活动记录不得包含凭据明文')
  }
  assert.ok(!activityText.includes('web-demo-v2'), '活动记录不得包含普通变量取值')
  assert.ok(!activityText.includes('should-use-ref'), '活动记录不得包含被拒绝的敏感取值')

  const usageRows = await app.db.select().from(credentialUsage).where(eq(credentialUsage.team_id, teamId))
  const usageText = JSON.stringify(usageRows)
  for (const plaintext of secretValues) {
    assert.ok(!usageText.includes(plaintext), '使用记录不得包含凭据明文')
  }
  const usageColumns = Object.keys(usageRows[0] ?? {})
  assert.ok(!usageColumns.includes('value'), '使用记录不得保存取值字段')
})
