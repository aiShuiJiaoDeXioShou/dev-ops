import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadAgentConfig } from '../src/config.ts'

test('解析平台地址、标签与工作目录', () => {
  const config = loadAgentConfig({
    PLATFORM_URL: 'https://devops.example.com/',
    AGENT_REGISTRATION_TOKEN: 'registration-token',
    AGENT_WORK_DIR: '/tmp/agent',
    AGENT_LABELS: 'linux, docker',
  })
  assert.equal(config.platformUrl, 'https://devops.example.com')
  assert.deepEqual(config.labels, ['linux', 'docker'])
  assert.equal(config.registrationToken, 'registration-token')
})

test('缺少令牌、URL 或工作目录时拒绝启动', () => {
  assert.throws(
    () => loadAgentConfig({ PLATFORM_URL: 'https://devops.example.com', AGENT_WORK_DIR: '/tmp' }),
    /令牌|AGENT_TOKEN/,
  )
  assert.throws(
    () => loadAgentConfig({ PLATFORM_URL: 'ftp://x', AGENT_TOKEN: 'token', AGENT_WORK_DIR: '/tmp' }),
    /PLATFORM_URL/,
  )
  assert.throws(() => loadAgentConfig({ PLATFORM_URL: 'https://x', AGENT_TOKEN: 'token' }), /AGENT_WORK_DIR/)
})

test('默认轮询、超时与容器资源限制', () => {
  const config = loadAgentConfig({
    PLATFORM_URL: 'https://devops.example.com',
    AGENT_TOKEN: 'token-value',
    AGENT_WORK_DIR: '/tmp/agent',
  })
  assert.equal(config.pollWaitSeconds, 20)
  assert.equal(config.controlTimeoutMs, 15_000)
  assert.equal(config.artifactUploadTimeoutMs, 300_000)
  assert.equal(config.artifactMaxBytes, 524_288_000)
  assert.equal(config.logChunkMaxBytes, 65_536)
  assert.deepEqual(config.container, { cpus: 1, memoryBytes: 2_048 * 1_024 * 1_024, pidsLimit: 512 })
  assert.equal(config.nodeName.length > 0, true, '节点名缺省取主机名')
})

test('按环境变量覆盖容器限制与容器用户', () => {
  const config = loadAgentConfig({
    PLATFORM_URL: 'http://127.0.0.1:3001',
    AGENT_TOKEN: 'token-value',
    AGENT_WORK_DIR: '/tmp/agent',
    AGENT_NAME: 'node-a',
    AGENT_CONTAINER_CPUS: '1.5',
    AGENT_CONTAINER_MEMORY_MB: '4096',
    AGENT_CONTAINER_PIDS_LIMIT: '1024',
    AGENT_CONTAINER_USER: '1000:1000',
    AGENT_LOG_CHUNK_MAX_BYTES: '32768',
    AGENT_POLL_WAIT_SECONDS: '5',
  })
  assert.equal(config.nodeName, 'node-a')
  assert.deepEqual(config.container, { cpus: 1.5, memoryBytes: 4096 * 1_024 * 1_024, pidsLimit: 1024 })
  assert.equal(config.containerUser, '1000:1000')
  assert.equal(config.logChunkMaxBytes, 32_768)
  assert.equal(config.pollWaitSeconds, 5)
})

test('非法数值配置拒绝启动且错误信息不含令牌', () => {
  assert.throws(
    () =>
      loadAgentConfig({
        PLATFORM_URL: 'http://127.0.0.1:3001',
        AGENT_TOKEN: 'token-value',
        AGENT_WORK_DIR: '/tmp/agent',
        AGENT_CONTAINER_CPUS: '0',
      }),
    (error: unknown) => error instanceof Error && error.message.includes('AGENT_CONTAINER_CPUS'),
  )
  assert.throws(
    () =>
      loadAgentConfig({
        PLATFORM_URL: 'http://127.0.0.1:3001',
        AGENT_TOKEN: 'token-value',
        AGENT_WORK_DIR: '/tmp/agent',
        AGENT_CONTAINER_USER: 'root',
      }),
    (error: unknown) => error instanceof Error && error.message.includes('AGENT_CONTAINER_USER'),
  )
})
