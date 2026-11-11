import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createAgentClient } from '../src/agent.ts'
import { createPlatformHttp } from '../src/client.ts'
import { AgentApiError } from '../src/errors.ts'
import { createAgentLogger } from '../src/logger.ts'
import { createLogCollector } from '../src/logs.ts'
import { createSecretMasker } from '../src/masking.ts'
import { createLease, createRunPlan } from './helpers/fixtures.ts'
import { errorEnvelope, okEnvelope, startMockPlatform } from './helpers/platform-server.ts'

const REGISTRATION_TOKEN = 'registration-token-very-sensitive-0123456789'
const AGENT_TOKEN = 'agent-token-very-sensitive-01234567890123456789'

async function filesUnder(rootDir: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(rootDir, { withFileTypes: true })) {
    const target = join(rootDir, entry.name)
    if (entry.isDirectory()) result.push(...(await filesUnder(target)))
    else result.push(target)
  }
  return result
}

test('注册令牌与 Agent 令牌只存在内存，不写入磁盘也不出现在日志', async () => {
  const platform = await startMockPlatform((request) => {
    if (request.path === '/api/v1/agent/register') {
      return okEnvelope({
        nodeId: 'node-secure',
        agentToken: AGENT_TOKEN,
        protocolVersion: 2,
        heartbeatIntervalSeconds: 15,
        leaseTtlSeconds: 90,
      })
    }
    if (request.path === '/api/v1/agent/heartbeat') {
      return okEnvelope({ cancelLeaseIds: [], heartbeatIntervalSeconds: 15 })
    }
    return okEnvelope(null)
  })
  const workDir = await mkdtemp(join(tmpdir(), 'devops-agent-security-'))
  try {
    const lines: string[] = []
    const masker = createSecretMasker()
    const logger = createAgentLogger({ masker, write: (line) => lines.push(line) })
    const http = createPlatformHttp({ baseUrl: platform.url, timeoutMs: 2_000, sleep: async () => undefined })
    const client = createAgentClient({
      http,
      logger,
      masker,
      nodeName: 'secure-node',
      capabilities: ['linux'],
      registrationToken: REGISTRATION_TOKEN,
      artifactUploadTimeoutMs: 5_000,
    })
    await client.ensureRegistered()
    await client.heartbeat(null)
    assert.equal(client.hasAgentToken, true)

    const files = await filesUnder(workDir)
    assert.equal(files.length, 0, '工作目录不应写入任何令牌文件')
    const logs = lines.join('\n')
    assert.ok(!logs.includes(AGENT_TOKEN), '日志不得包含 Agent 令牌')
    assert.ok(!logs.includes(REGISTRATION_TOKEN), '日志不得包含注册令牌')
    assert.equal(masker.maskText(`token=${AGENT_TOKEN}`).includes(AGENT_TOKEN), false)
  } finally {
    await platform.close()
    await rm(workDir, { recursive: true, force: true })
  }
})

test('平台业务错误中的敏感信息在抛出前再次脱敏', async () => {
  const platform = await startMockPlatform(() =>
    errorEnvelope('AGENT_LEASE_INVALID', `租约请求携带了 ${REGISTRATION_TOKEN}`),
  )
  try {
    const masker = createSecretMasker()
    const logger = createAgentLogger({ masker, write: () => undefined })
    const http = createPlatformHttp({ baseUrl: platform.url, timeoutMs: 2_000, sleep: async () => undefined })
    const client = createAgentClient({
      http,
      logger,
      masker,
      nodeName: 'secure-node',
      capabilities: ['linux'],
      registrationToken: REGISTRATION_TOKEN,
      artifactUploadTimeoutMs: 5_000,
    })
    await assert.rejects(
      () => client.ensureRegistered(),
      (error: unknown) =>
        error instanceof AgentApiError &&
        error.code === 'AGENT_LEASE_INVALID' &&
        !error.message.includes(REGISTRATION_TOKEN),
    )
  } finally {
    await platform.close()
  }
})

test('日志收集器遮蔽运行计划中的密钥与 Git 凭据', async () => {
  const plan = createRunPlan({ secrets: { NPM_TOKEN: 'runtime-secret-value' } })
  const uploads: string[] = []
  const masker = createSecretMasker()
  masker.addSecrets([...Object.values(plan.secrets), plan.git.password])
  const logger = createAgentLogger({ masker, write: () => undefined })
  const collector = createLogCollector({
    masker,
    logger,
    chunkMaxBytes: 1_024,
    uploadLogs: async (chunks) => {
      uploads.push(...chunks.map((chunk) => chunk.content))
      return { acceptedThrough: {} }
    },
  })
  collector.append(
    0,
    `NPM_TOKEN=runtime-secret-value git-password=${plan.git.password} password=runtime-secret-value\n`,
  )
  await collector.flush(0)
  const content = uploads.join('')
  assert.ok(!content.includes('runtime-secret-value'), '运行时密钥必须脱敏')
  assert.ok(!content.includes(plan.git.password), 'Git 凭据必须脱敏')
  assert.ok(!content.includes('NPM_TOKEN=runtime-secret-value'))
})

test('长期令牌模式不发起注册请求，也不记录令牌', async () => {
  const lease = createLease()
  const platform = await startMockPlatform((request) => {
    if (request.path === '/api/v1/agent/register') throw new Error('不应发起注册请求')
    if (request.path === '/api/v1/agent/heartbeat') {
      return okEnvelope({ cancelLeaseIds: [], heartbeatIntervalSeconds: 15 })
    }
    return okEnvelope(null)
  })
  try {
    const lines: string[] = []
    const masker = createSecretMasker()
    const logger = createAgentLogger({ masker, write: (line) => lines.push(line) })
    const http = createPlatformHttp({ baseUrl: platform.url, timeoutMs: 2_000, sleep: async () => undefined })
    const client = createAgentClient({
      http,
      logger,
      masker,
      nodeName: 'token-node',
      capabilities: ['linux'],
      agentToken: AGENT_TOKEN,
      artifactUploadTimeoutMs: 5_000,
    })
    const session = await client.ensureRegistered()
    assert.equal(session.nodeId, '')
    await client.heartbeat(lease.leaseId)
    assert.ok(!lines.join('\n').includes(AGENT_TOKEN))
    const heartbeatRequest = platform.requests.find((request) => request.path === '/api/v1/agent/heartbeat')
    assert.ok(heartbeatRequest)
    assert.equal(heartbeatRequest.headers.authorization, `Bearer ${AGENT_TOKEN}`)
  } finally {
    await platform.close()
  }
})
