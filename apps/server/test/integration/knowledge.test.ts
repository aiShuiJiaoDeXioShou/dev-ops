import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { sql } from 'drizzle-orm'
import { Client } from 'pg'
import { createHttpApp } from '../../src/bootstrap/create-http-app.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { migrateDatabase } from '../../src/platform/database/migrate.ts'
import { createKnowledgeService } from '../../src/modules/knowledge/knowledge.service.ts'
import { seedKnowledgeFixture } from '../support/knowledge-fixtures.ts'
import { FakeMailer } from '../support/fake-mailer.ts'

type Cookie = { cookie: string }

test('知识资产管理、项目选用、快照与阶段 B 解析', { timeout: 90_000 }, async (t) => {
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
  const admin = new Client({
    host: runtimeUrl.hostname,
    port: Number(runtimeUrl.port || '5432'),
    user: 'postgres',
    password: adminPassword,
    database: 'postgres',
    connectionTimeoutMillis: 5_000,
  })
  await admin.connect()
  cleanup.push(async () => {
    await admin.end()
  })
  await admin.query(`CREATE DATABASE "${databaseName}" OWNER dev_ops_migrator`)
  cleanup.push(async () => {
    await admin.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`)
  })
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
  const app = createHttpApp(config, { mailer: new FakeMailer() })
  cleanup.push(async () => {
    await app.close()
  })

  const { adminUser, devUser, viewerUser, otherUser, teamId, otherTeamId } = await seedKnowledgeFixture(app)

  async function inject(method: 'GET' | 'POST', url: string, cookie: Cookie, payload?: unknown) {
    return app.inject({
      method,
      url,
      headers: { cookie: cookie.cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    })
  }

  const projectResponse = await inject('POST', `/api/v1/teams/${teamId}/projects`, adminUser, {
    name: '知识资产项目',
  })
  assert.equal(projectResponse.json().success, true, projectResponse.body)
  const projectId = projectResponse.json().data.id as string

  // 技能发布、检索、编辑与启停
  const skillCreated = await inject('POST', `/api/v1/teams/${teamId}/skills`, devUser, {
    name: '代码评审',
    identifier: 'code-review',
    category: 'engineering',
    contentVersion: '1.0.0',
    summary: '提交前检查风险',
    content: '阅读变更，列出风险与验证建议。',
    files: [
      { path: 'references/checklist.md', content: '- 检查风险', encoding: 'utf8' },
      { path: 'scripts/lint.sh', content: '#!/bin/sh\necho ok', encoding: 'utf8' },
    ],
  })
  assert.equal(skillCreated.json().success, true, skillCreated.body)
  const skill = skillCreated.json().data
  assert.equal(skill.enabled, true)
  assert.equal(skill.contentVersion, '1.0.0')
  assert.equal(skill.version, 1)
  assert.equal(skill.files.length, 2)
  assert.equal(skill.files[0].path, 'references/checklist.md')
  assert.equal(skill.files[1].path, 'scripts/lint.sh')
  assert.ok(skill.files[0].sizeBytes > 0)

  const skillList = await inject('GET', `/api/v1/teams/${teamId}/skills?search=评审`, viewerUser)
  assert.equal(skillList.json().data.total, 1)
  assert.equal(skillList.json().data.items[0].identifier, 'code-review')

  const viewerCreate = await inject('POST', `/api/v1/teams/${teamId}/skills`, viewerUser, {
    name: '浏览者技能',
    identifier: 'viewer-skill',
    category: 'product',
    contentVersion: '1.0.0',
    summary: '不应创建',
    content: '不应创建',
  })
  assert.equal(viewerCreate.json().code, 'FORBIDDEN')

  const skillEdited = await inject('POST', `/api/v1/skills/${skill.id}/update`, devUser, {
    version: 1,
    name: '代码评审',
    category: 'engineering',
    contentVersion: '1.1.0',
    summary: '提交前检查风险与测试',
    content: '阅读变更，列出风险、缺失测试与验证建议。',
    files: [
      { path: 'references/checklist.md', content: '- 检查风险\n- 检查测试', encoding: 'utf8' },
      { path: 'scripts/lint.sh', content: '#!/bin/sh\necho ok', encoding: 'utf8' },
    ],
  })
  assert.equal(skillEdited.json().success, true, skillEdited.body)
  assert.equal(skillEdited.json().data.contentVersion, '1.1.0')
  assert.equal(skillEdited.json().data.files.length, 2)

  const staleUpdate = await inject('POST', `/api/v1/skills/${skill.id}/update`, devUser, {
    version: 1,
    name: '旧版本',
    category: 'engineering',
    contentVersion: '1.2.0',
    summary: '旧版本',
    content: '旧版本内容',
  })
  assert.equal(staleUpdate.json().code, 'VERSION_CONFLICT')

  const skillVersions = await inject('GET', `/api/v1/skills/${skill.id}/versions`, viewerUser)
  assert.equal(skillVersions.json().data.total, 2)
  assert.equal(skillVersions.json().data.items[0].contentVersion, '1.1.0')
  const firstVersion = skillVersions.json().data.items[0]
  const firstVersionDetail = await inject('GET', `/api/v1/skills/${skill.id}/versions/${firstVersion.id}`, viewerUser)
  assert.equal(firstVersionDetail.json().data.files.length, 2)
  assert.match(firstVersionDetail.json().data.files[0].content, /检查测试/)

  // 资源文件路径非法、重复或与 SKILL.md 冲突时整次保存被拒绝
  const invalidFile = await inject('POST', `/api/v1/teams/${teamId}/skills`, devUser, {
    name: '非法技能',
    identifier: 'invalid-files',
    category: 'engineering',
    contentVersion: '1.0.0',
    summary: '校验资源路径',
    content: '正文',
    files: [{ path: '../secret.md', content: 'x', encoding: 'utf8' }],
  })
  assert.equal(invalidFile.json().code, 'VALIDATION_ERROR')
  const reservedFile = await inject('POST', `/api/v1/skills/${skill.id}/update`, devUser, {
    version: 2,
    name: '代码评审',
    category: 'engineering',
    contentVersion: '1.2.0',
    summary: '校验资源路径',
    content: '正文',
    files: [{ path: 'SKILL.md', content: 'x', encoding: 'utf8' }],
  })
  assert.equal(reservedFile.json().code, 'VALIDATION_ERROR')

  const sensitive = await inject('POST', `/api/v1/teams/${teamId}/skills`, devUser, {
    name: '敏感内容',
    identifier: 'sensitive-skill',
    category: 'engineering',
    contentVersion: '1.0.0',
    summary: '不应保存',
    content: 'api_key = sk-abcdefghijklmnopqrstuvwxyz123456',
  })
  assert.equal(sensitive.json().code, 'VALIDATION_ERROR')
  assert.equal(sensitive.json().message.includes('sk-abcdefghijklmnopqrstuvwxyz123456'), false)

  const disabled = await inject('POST', `/api/v1/skills/${skill.id}/disable`, devUser, { version: 2 })
  assert.equal(disabled.json().data.enabled, false)
  assert.equal(disabled.json().data.version, 3)

  const crossTeamSkill = await inject('GET', `/api/v1/skills/${skill.id}`, otherUser)
  assert.equal(crossTeamSkill.json().code, 'NOT_FOUND')

  // 模板新建、名称大小写唯一、编辑、副本
  const templateCreated = await inject('POST', `/api/v1/teams/${teamId}/agent-templates`, devUser, {
    name: '默认协作约定',
    tag: '团队',
    description: '默认约定',
    content: '# AGENTS.md\n\n## 协作约定\n- 先阅读需求',
  })
  assert.equal(templateCreated.json().success, true, templateCreated.body)
  const template = templateCreated.json().data
  assert.equal(template.contentVersion, 1)

  const duplicateName = await inject('POST', `/api/v1/teams/${teamId}/agent-templates`, adminUser, {
    name: '默认协作约定',
    tag: '团队',
    content: '重复名称',
  })
  assert.equal(duplicateName.json().code, 'VALIDATION_ERROR')

  const caseTemplate = await inject('POST', `/api/v1/teams/${teamId}/agent-templates`, adminUser, {
    name: 'DEFAULT',
    tag: '团队',
    content: '大小写不同',
  })
  assert.equal(caseTemplate.json().success, true)
  const caseDuplicateName = await inject('POST', `/api/v1/teams/${teamId}/agent-templates`, adminUser, {
    name: 'default',
    tag: '团队',
    content: '仅大小写不同',
  })
  assert.equal(caseDuplicateName.json().code, 'VALIDATION_ERROR')

  const templateEdited = await inject('POST', `/api/v1/agent-templates/${template.id}/update`, devUser, {
    version: 1,
    name: '默认协作约定',
    tag: '团队',
    description: '默认约定 v2',
    content: '# AGENTS.md\n\n## 协作约定\n- 先阅读需求\n- 记录验证',
  })
  assert.equal(templateEdited.json().success, true, templateEdited.body)
  assert.equal(templateEdited.json().data.contentVersion, 2)

  const templateVersions = await inject('GET', `/api/v1/agent-templates/${template.id}/versions`, viewerUser)
  assert.equal(templateVersions.json().data.total, 2)

  const duplicated = await inject('POST', `/api/v1/agent-templates/${template.id}/duplicate`, devUser, {
    name: '默认协作约定 副本',
  })
  assert.equal(duplicated.json().success, true, duplicated.body)
  assert.equal(duplicated.json().data.contentVersion, 1)
  const copiedTemplate = duplicated.json().data

  // 项目选用与切换
  const applied = await inject('POST', `/api/v1/projects/${projectId}/agent-template/apply`, devUser, {
    templateId: template.id,
    version: 0,
  })
  assert.equal(applied.json().success, true, applied.body)
  assert.equal(applied.json().data.selection.templateName, '默认协作约定')
  assert.equal(applied.json().data.selection.contentVersion, 2)

  const switched = await inject('POST', `/api/v1/projects/${projectId}/agent-template/apply`, devUser, {
    templateId: copiedTemplate.id,
    version: 1,
  })
  assert.equal(switched.json().success, true, switched.body)
  assert.equal(switched.json().data.selection.templateId, copiedTemplate.id)

  const selection = await inject('GET', `/api/v1/projects/${projectId}/agent-template`, viewerUser)
  assert.equal(selection.json().data.selection.templateId, copiedTemplate.id)

  const templatesWithSelection = await inject('GET', `/api/v1/teams/${teamId}/agent-templates`, viewerUser)
  const selectedTemplateItem = templatesWithSelection
    .json()
    .data.items.find((item: { id: string }) => item.id === copiedTemplate.id)
  assert.equal(selectedTemplateItem.selectedProjectCount, 1)
  const unselectedTemplateItem = templatesWithSelection
    .json()
    .data.items.find((item: { id: string }) => item.id === template.id)
  assert.equal(unselectedTemplateItem.selectedProjectCount, 0)
  const copiedDetail = await inject('GET', `/api/v1/agent-templates/${copiedTemplate.id}`, viewerUser)
  assert.equal(copiedDetail.json().data.selectedProjectCount, 1)

  const cleared = await inject('POST', `/api/v1/projects/${projectId}/agent-template/clear`, devUser, { version: 2 })
  assert.equal(cleared.json().data.selection, null)
  assert.equal(cleared.json().data.version, 0)

  // 跨团队模板不能选用
  const otherTemplate = await inject('POST', `/api/v1/teams/${otherTeamId}/agent-templates`, otherUser, {
    name: '其他团队模板',
    tag: '团队',
    content: '# AGENTS.md\n其他团队',
  })
  const crossTeamApply = await inject('POST', `/api/v1/projects/${projectId}/agent-template/apply`, adminUser, {
    templateId: otherTemplate.json().data.id,
    version: 0,
  })
  assert.equal(crossTeamApply.json().code, 'PRECONDITION_FAILED')

  // 快照固定版本与团队隔离
  await inject('POST', `/api/v1/projects/${projectId}/agent-template/apply`, devUser, {
    templateId: template.id,
    version: 0,
  })
  const link = await inject('POST', `/api/v1/agent-templates/${template.id}/snapshot-links`, devUser)
  assert.equal(link.json().success, true, link.body)
  const token = link.json().data.token as string
  assert.equal(link.json().data.contentVersion, 2)

  const snapshot = await inject('GET', `/api/v1/template-snapshot-links/${token}`, viewerUser)
  assert.equal(snapshot.json().success, true, snapshot.body)
  assert.equal(snapshot.json().data.contentVersion, 2)

  await inject('POST', `/api/v1/agent-templates/${template.id}/update`, devUser, {
    version: 2,
    name: '默认协作约定',
    tag: '团队',
    description: '默认约定 v3',
    content: '# AGENTS.md\n\n## 协作约定\n- 先阅读需求\n- 记录验证\n- 提交证据',
  })
  const snapshotAfterEdit = await inject('GET', `/api/v1/template-snapshot-links/${token}`, viewerUser)
  assert.equal(snapshotAfterEdit.json().data.contentVersion, 2)
  assert.match(snapshotAfterEdit.json().data.content, /记录验证/)

  assert.equal((await inject('GET', `/api/v1/template-snapshot-links/${token}`, otherUser)).json().code, 'NOT_FOUND')
  assert.equal(
    (await inject('GET', '/api/v1/template-snapshot-links/not-a-real-token', viewerUser)).json().code,
    'NOT_FOUND',
  )

  // 阶段 B 解析函数
  const knowledge = createKnowledgeService({ db: app.db })
  const enabledSkill = await inject('POST', `/api/v1/skills/${skill.id}/enable`, devUser, { version: 3 })
  assert.equal(enabledSkill.json().data.enabled, true)
  const resolved = await knowledge.resolveSkillsForRun({
    teamId,
    skillIds: [skill.id, randomUUID(), otherTemplate.json().data.id],
  })
  assert.equal(resolved.skills.length, 1)
  assert.equal(resolved.skills[0]?.identifier, 'code-review')
  assert.equal(resolved.skills[0]?.contentVersion, '1.1.0')
  assert.ok(resolved.missing.every((item) => item.reason === 'not_found'))
  const assignable = await knowledge.listAssignableSkillsForBotConfig(teamId)
  assert.equal(assignable.length, 1)
  const projectTemplate = await knowledge.resolveProjectTemplateForRun({ teamId, projectId })
  assert.equal(projectTemplate.status, 'selected')
  if (projectTemplate.status === 'selected') {
    assert.equal(projectTemplate.template.templateId, template.id)
    assert.equal(projectTemplate.template.contentVersion, 3)
  }
  assert.equal((await knowledge.resolveProjectTemplateForRun({ teamId: otherTeamId, projectId })).status, 'unavailable')

  const activities = await app.db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM app.activity WHERE entity_id IN (${skill.id}, ${template.id}, ${projectId})`,
  )
  assert.ok((activities.rows[0]?.count ?? 0) >= 8)
  const tokenInActivity = await app.db.execute<{ count: number }>(
    sql`SELECT count(*)::int AS count FROM app.activity WHERE changes::text LIKE ${`%${token}%`}`,
  )
  assert.equal(tokenInActivity.rows[0]?.count, 0)
})
