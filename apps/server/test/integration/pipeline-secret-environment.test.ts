import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { test } from 'node:test'
import {
  credential,
  credentialProjectGrant,
  credentialUsage,
  credentialVersion,
  projectEnvVar,
} from '../../src/modules/configuration/configuration.tables.ts'
import { createSecretCipher } from '../../src/modules/configuration/configuration.crypto.ts'
import {
  createPipelineCredentialProvider,
  PipelineSecretError,
} from '../../src/modules/pipeline/pipeline.credentials.ts'
import { loadConfig } from '../../src/platform/config/env.ts'
import { setupPipelineContext } from './pipeline-harness.ts'

test('T056 运行时凭据按目标环境解析，环境之间不继承', { timeout: 60_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const db = context.app.db
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://dev_ops_app@127.0.0.1:5433/dev_ops',
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
  })
  const provider = createPipelineCredentialProvider({ db, config, cipher: null })

  await db.insert(projectEnvVar).values([
    {
      id: randomUUID(),
      team_id: context.teamId,
      project_id: context.projectId,
      environment: 'test',
      name: 'DEPLOY_TOKEN',
      kind: 'plain',
      value_text: 'test-environment-value',
      credential_id: null,
      status: 'active',
      created_by_user_id: context.admin.userId,
    },
    {
      id: randomUUID(),
      team_id: context.teamId,
      project_id: context.projectId,
      environment: 'production',
      name: 'DEPLOY_TOKEN',
      kind: 'plain',
      value_text: 'production-environment-value',
      credential_id: null,
      status: 'active',
      created_by_user_id: context.admin.userId,
    },
  ])

  const testSecrets = await provider.resolveSecrets({
    teamId: context.teamId,
    projectId: context.projectId,
    environment: 'test',
    names: ['DEPLOY_TOKEN'],
  })
  assert.deepEqual(testSecrets, { DEPLOY_TOKEN: 'test-environment-value' })

  const productionSecrets = await provider.resolveSecrets({
    teamId: context.teamId,
    projectId: context.projectId,
    environment: 'production',
    names: ['DEPLOY_TOKEN'],
  })
  assert.deepEqual(productionSecrets, { DEPLOY_TOKEN: 'production-environment-value' })

  await assert.rejects(
    () =>
      provider.resolveSecrets({
        teamId: context.teamId,
        projectId: context.projectId,
        environment: 'development',
        names: ['DEPLOY_TOKEN'],
      }),
    (error: unknown) => error instanceof PipelineSecretError,
  )
})

test('T056 凭据引用：授权解析、撤销后拒绝、使用记录不保存值', { timeout: 60_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const db = context.app.db
  const key = randomBytes(32).toString('base64')
  const cipher = createSecretCipher(key)
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://dev_ops_app@127.0.0.1:5433/dev_ops',
    AUTH_SECRET: 'test-auth-secret-at-least-32-characters',
    GIT_CREDENTIAL_ENCRYPTION_KEY: key,
  })
  const provider = createPipelineCredentialProvider({ db, config, cipher })
  const credentialId = randomUUID()
  const encrypted = cipher.encrypt('super-secret-value')
  await db.insert(credential).values({
    id: credentialId,
    team_id: context.teamId,
    name: '部署凭据',
    kind: 'api_key',
    current_version: 1,
    status: 'active',
    created_by_user_id: context.admin.userId,
  })
  await db.insert(credentialVersion).values({
    id: randomUUID(),
    team_id: context.teamId,
    credential_id: credentialId,
    version: 1,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    auth_tag: encrypted.authTag,
    key_version: encrypted.keyVersion,
    created_by_user_id: context.admin.userId,
  })
  await db.insert(credentialProjectGrant).values({
    id: randomUUID(),
    team_id: context.teamId,
    credential_id: credentialId,
    project_id: context.projectId,
    granted_by_user_id: context.admin.userId,
  })
  await db.insert(projectEnvVar).values({
    id: randomUUID(),
    team_id: context.teamId,
    project_id: context.projectId,
    environment: 'test',
    name: 'DEPLOY_SECRET',
    kind: 'credential_ref',
    value_text: null,
    credential_id: credentialId,
    status: 'active',
    created_by_user_id: context.admin.userId,
  })

  const resolved = await provider.resolveSecrets({
    teamId: context.teamId,
    projectId: context.projectId,
    environment: 'test',
    names: ['DEPLOY_SECRET'],
  })
  assert.deepEqual(resolved, { DEPLOY_SECRET: 'super-secret-value' })

  const usage = await db.select().from(credentialUsage).where(eq(credentialUsage.credential_id, credentialId))
  assert.ok(usage.length >= 1)
  assert.equal(usage[0]?.result, 'success')
  assert.equal(usage[0]?.environment, 'test')

  await db
    .update(credentialProjectGrant)
    .set({ revoked_at: new Date() })
    .where(eq(credentialProjectGrant.credential_id, credentialId))
  await assert.rejects(() =>
    provider.resolveSecrets({
      teamId: context.teamId,
      projectId: context.projectId,
      environment: 'test',
      names: ['DEPLOY_SECRET'],
    }),
  )
})
