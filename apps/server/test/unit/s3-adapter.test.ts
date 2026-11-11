import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { test } from 'node:test'
import {
  buildS3ClientConfig,
  classifyS3Failure,
  createS3StorageAdapter,
  type S3ObjectClient,
  type S3PutObjectInput,
} from '../../src/modules/storage/adapters/s3.adapter.ts'

const CREDENTIALS = { accessKeyId: 'AKIAEXAMPLEKEY0001', secretAccessKey: 'secret-value-for-tests' }

/** 把可读流读成 Buffer，模拟对象存储读回内容。 */
async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk)
      callback()
    },
  })
  await pipeline(stream, sink)
  return Buffer.concat(chunks)
}

/** 构造带 smithy 错误字段的异常；测试错误归因。 */
function s3Error(name: string, properties: Record<string, unknown> = {}): Error {
  const error = new Error(name)
  error.name = name
  for (const [key, value] of Object.entries(properties)) {
    Object.defineProperty(error, key, { value, enumerable: true, configurable: true })
  }
  return error
}

/** 记录调用的假 S3 客户端；默认内存读写，便于验证探测三步链路。 */
function createFakeClient(input: {
  failPut?: unknown
  failGet?: unknown
  failRemove?: unknown
  getReturnsMissing?: boolean
}): S3ObjectClient & { calls: { put: S3PutObjectInput[]; get: string[]; remove: string[] } } {
  const objects = new Map<string, Buffer>()
  const calls = { put: [] as S3PutObjectInput[], get: [] as string[], remove: [] as string[] }
  return {
    calls,
    async putObject(request) {
      calls.put.push(request)
      if (input.failPut) throw input.failPut
      objects.set(request.key, await readAll(request.body))
    },
    async getObject(key) {
      calls.get.push(key)
      if (input.failGet) throw input.failGet
      if (input.getReturnsMissing) throw s3Error('NoSuchKey')
      const content = objects.get(key)
      if (!content) throw s3Error('NoSuchKey', { $metadata: { httpStatusCode: 404 } })
      return Readable.from([content])
    },
    async removeObject(key) {
      calls.remove.push(key)
      if (input.failRemove) throw input.failRemove
      objects.delete(key)
    },
  }
}

/** 以固定配置创建适配器；所有用例都不访问真实网络。 */
function createAdapter(client: S3ObjectClient, pathPrefix: string | null = null) {
  return createS3StorageAdapter({
    endpoint: 'http://127.0.0.1:9000',
    region: 'us-east-1',
    bucketName: 'dev-ops-test',
    pathPrefix,
    credentials: CREDENTIALS,
    probeTimeoutMs: 5_000,
    client,
  })
}

test('S3 客户端配置固定 path-style、自定义 endpoint 与探测超时', () => {
  const config = buildS3ClientConfig({
    endpoint: 'https://minio.example.test:9000',
    region: 'cn-test-1',
    bucketName: 'attachments',
    credentials: CREDENTIALS,
    connectionTimeoutMs: 3_000,
    requestTimeoutMs: 8_000,
  })
  assert.equal(config.forcePathStyle, true)
  assert.equal(config.endpoint, 'https://minio.example.test:9000')
  assert.equal(config.region, 'cn-test-1')
  const credentials = config.credentials
  assert.ok(credentials)
  assert.equal('accessKeyId' in credentials ? credentials.accessKeyId : undefined, CREDENTIALS.accessKeyId)
  const handler = config.requestHandler
  assert.ok(handler)
  assert.equal('connectionTimeout' in handler ? handler.connectionTimeout : undefined, 3_000)
  assert.equal('requestTimeout' in handler ? handler.requestTimeout : undefined, 8_000)
  assert.equal('throwOnRequestTimeout' in handler ? handler.throwOnRequestTimeout : undefined, true)
})

test('S3 对象写入：带 ContentLength 的流式写入并返回服务端摘要', async () => {
  const client = createFakeClient({})
  const adapter = createAdapter(client, 'env/test')
  const content = Buffer.from('附件二进制内容')
  const result = await adapter.put('attachments/team/project/a1', Readable.from([content]), content.length)
  assert.equal(result.sizeBytes, content.length)
  assert.equal(result.sha256, createHash('sha256').update(content).digest('hex'))
  assert.equal(client.calls.put.length, 1)
  assert.equal(client.calls.put[0]?.key, 'env/test/attachments/team/project/a1')
  assert.equal(client.calls.put[0]?.contentLength, content.length)
})

test('S3 对象读取与删除都会应用路径前缀，删除不存在对象视为成功', async () => {
  const client = createFakeClient({ failRemove: s3Error('NoSuchKey') })
  const adapter = createAdapter(client, 'env/test')
  await assert.rejects(adapter.get('missing'), /NoSuchKey/)
  await adapter.remove('missing')
  assert.deepEqual(client.calls.get, ['env/test/missing'])
  assert.deepEqual(client.calls.remove, ['env/test/missing'])
})

test('探测：写、读回、删除全部成功归因为可读写', async () => {
  const client = createFakeClient({})
  const outcome = await createAdapter(client).probe()
  assert.equal(outcome.result, 'read_write')
  assert.equal(client.calls.put.length, 1)
  assert.equal(client.calls.get.length, 1)
  assert.equal(client.calls.remove.length, 1)
  // 探针对象使用隐藏前缀，避免与业务对象混淆。
  assert.match(client.calls.put[0]?.key ?? '', /^\.probe-/)
})

test('探测：写被拒但读可达归因为只读', async () => {
  const client = createFakeClient({ failPut: s3Error('AccessDenied') })
  const outcome = await createAdapter(client).probe()
  assert.equal(outcome.result, 'read_only')
  assert.match(outcome.message, /不可写/)
})

test('探测：凭据被拒归因为凭据无效', async () => {
  const client = createFakeClient({ failPut: s3Error('InvalidAccessKeyId') })
  const outcome = await createAdapter(client).probe()
  assert.equal(outcome.result, 'auth_failed')

  const signatureClient = createFakeClient({ failPut: s3Error('SignatureDoesNotMatch') })
  assert.equal((await createAdapter(signatureClient).probe()).result, 'auth_failed')
})

test('探测：网络错误与超时归因为连接失败', async () => {
  const refused = createFakeClient({ failPut: s3Error('Error', { code: 'ECONNREFUSED' }) })
  assert.equal((await createAdapter(refused).probe()).result, 'unreachable')

  const timeout = createFakeClient({ failPut: s3Error('TimeoutError') })
  assert.equal((await createAdapter(timeout).probe()).result, 'unreachable')
})

test('探测：写入成功但读取失败归因为连接失败，并尽力清理探针对象', async () => {
  const client = createFakeClient({ failGet: s3Error('AccessDenied') })
  const outcome = await createAdapter(client).probe()
  assert.equal(outcome.result, 'unreachable')
  assert.equal(client.calls.remove.length, 1)
})

test('探测：探针对象删除失败时不误报为可读写', async () => {
  const client = createFakeClient({ failRemove: s3Error('AccessDenied') })
  const outcome = await createAdapter(client).probe()
  assert.equal(outcome.result, 'unreachable')
  assert.match(outcome.message, /删除失败/)
})

test('探测：读回内容不一致时不登记为可读写', async () => {
  const client: S3ObjectClient = {
    async putObject() {
      // 假装写入成功，但读回内容与探针不一致。
    },
    async getObject() {
      return Readable.from([Buffer.from('tampered')])
    },
    async removeObject() {
      // 无需清理
    },
  }
  const outcome = await createAdapter(client).probe()
  assert.equal(outcome.result, 'unreachable')
  assert.match(outcome.message, /不一致/)
})

test('错误归因：HTTP 状态码与错误名共同参与判断', () => {
  assert.equal(classifyS3Failure(s3Error('AccessDenied')), 'access_denied')
  assert.equal(classifyS3Failure(s3Error('Unexpected', { $metadata: { httpStatusCode: 403 } })), 'access_denied')
  assert.equal(classifyS3Failure(s3Error('Unexpected', { $metadata: { httpStatusCode: 401 } })), 'auth')
  assert.equal(classifyS3Failure(s3Error('Unexpected', { $metadata: { httpStatusCode: 503 } })), 'network')
  assert.equal(classifyS3Failure(s3Error('Unexpected')), 'unknown')
  assert.equal(classifyS3Failure('not-an-error'), 'unknown')
})
