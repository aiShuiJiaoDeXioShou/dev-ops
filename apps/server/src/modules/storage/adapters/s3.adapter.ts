import { createHash, randomUUID } from 'node:crypto'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline as pipelineAsync } from 'node:stream/promises'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3'
import type { StorageAdapter, StorageProbeOutcome, StorageWriteResult } from './local.adapter.ts'
import type { StorageBucketCredentials } from '../storage.crypto.ts'

/** 探测写入的探针对象内容；固定值便于读回校验。 */
const PROBE_BODY = Buffer.from('dev-ops-storage-probe')

/** S3 兼容桶适配器配置。 */
export interface S3StorageAdapterOptions {
  /** 自定义接入地址；S3 兼容服务通常为内网或自建域名。 */
  endpoint: string
  /** 区域；MinIO 等兼容实现通常要求非空但取值不敏感。 */
  region: string
  /** 目标桶名；桶由管理员预先创建，适配器不调用 CreateBucket。 */
  bucketName: string
  /** 对象键前缀；用于隔离不同环境的附件，可为空。 */
  pathPrefix: string | null
  /** 已解密的访问凭据；只在内存中使用，禁止写入日志或错误消息。 */
  credentials: StorageBucketCredentials
  /** 探测超时（毫秒）；同时作为连接超时上限。 */
  probeTimeoutMs: number
  /** 单测可注入的替代客户端；省略时使用 @aws-sdk/client-s3。 */
  client?: S3ObjectClient
}

/** 写入对象参数。 */
export interface S3PutObjectInput {
  key: string
  body: Readable
  contentLength: number
}

/**
 * 最小的 S3 对象客户端端口。
 * @remarks 只暴露适配器需要的能力，使单测可以注入假实现而不依赖真实对象存储。
 */
export interface S3ObjectClient {
  /** 流式写入对象；必须携带内容长度，SDK 才能采用流式上传。 */
  putObject(input: S3PutObjectInput): Promise<void>
  /** 读取对象流。 */
  getObject(key: string): Promise<Readable>
  /** 删除对象；对象不存在时视为成功。 */
  removeObject(key: string): Promise<void>
}

/** 创建 S3 对象客户端的配置；超时由 NodeHttpHandler 落实。 */
export interface S3ObjectClientOptions {
  endpoint: string
  region: string
  bucketName: string
  credentials: StorageBucketCredentials
  /** 连接阶段超时（毫秒）；避免 DNS 或建连无响应时无限挂起。 */
  connectionTimeoutMs: number
  /** 请求超时（毫秒）；0 表示不限制单次请求总时长（仅用于大对象传输）。 */
  requestTimeoutMs: number
}

/** 对象客户端工厂；单测可注入记录配置的假工厂。 */
export type S3ObjectClientFactory = (options: S3ObjectClientOptions) => S3ObjectClient

/**
 * 构造 S3 客户端配置。
 * @param options 接入地址、桶与凭据、超时设置。
 * @returns 固定的 path-style 配置；S3 兼容服务通常不支持虚拟主机风格域名。
 * @remarks 对象形式的 requestHandler 参数会原样传给 NodeHttpHandler：
 * SDK 默认 requestTimeout 为 0（不超时），探测必须显式设置否则请求可能无限挂起。
 */
export function buildS3ClientConfig(options: S3ObjectClientOptions): S3ClientConfig {
  return {
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.credentials.accessKeyId,
      secretAccessKey: options.credentials.secretAccessKey,
    },
    requestHandler: {
      connectionTimeout: options.connectionTimeoutMs,
      ...(options.requestTimeoutMs > 0
        ? { requestTimeout: options.requestTimeoutMs, throwOnRequestTimeout: true }
        : {}),
    },
  }
}

/** 判断未知错误对象上的属性值。 */
function readProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || !(key in value)) return undefined
  return Reflect.get(value, key)
}

/** 读取字符串型错误属性。 */
function readStringProperty(value: unknown, key: string): string | undefined {
  const candidate = readProperty(value, key)
  return typeof candidate === 'string' ? candidate : undefined
}

/** 读取错误链上的 HTTP 状态码。 */
function readStatusCode(error: unknown): number | undefined {
  const statusCode = readProperty(readProperty(error, '$metadata'), 'httpStatusCode')
  return typeof statusCode === 'number' ? statusCode : undefined
}

/** S3 失败归类；用于把 SDK 错误收敛为探测结论。 */
type S3FailureKind = 'auth' | 'access_denied' | 'not_found' | 'network' | 'unknown'

const AUTH_ERROR_NAMES = new Set([
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'ExpiredToken',
  'InvalidToken',
  'AuthorizationHeaderMalformed',
  'RequestTimeTooSkewed',
])
const ACCESS_DENIED_NAMES = new Set(['AccessDenied', 'Forbidden'])
const NOT_FOUND_NAMES = new Set(['NoSuchKey', 'NotFound'])
const NETWORK_ERROR_NAMES = new Set(['TimeoutError', 'RequestTimeout', 'RequestTimeoutException', 'AbortError'])
const NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
])

/**
 * 把 S3 SDK 抛出的未知错误收敛为有限类别。
 * @param error SDK 错误实例；结构按 smithy 错误模型读取，不信任具体实现类型。
 * @returns 失败类别；无法识别时返回 unknown。
 */
export function classifyS3Failure(error: unknown): S3FailureKind {
  const name = readStringProperty(error, 'name') ?? readStringProperty(error, 'Code')
  const code = readStringProperty(error, 'code')
  const statusCode = readStatusCode(error)
  if (name && AUTH_ERROR_NAMES.has(name)) return 'auth'
  if (name && ACCESS_DENIED_NAMES.has(name)) return 'access_denied'
  if (statusCode === 401) return 'auth'
  if (name && NOT_FOUND_NAMES.has(name)) return 'not_found'
  if ((name && NETWORK_ERROR_NAMES.has(name)) || (code && NETWORK_ERROR_CODES.has(code))) return 'network'
  if (statusCode === 403) return 'access_denied'
  if (statusCode !== undefined && statusCode >= 500) return 'network'
  return 'unknown'
}

/** 按失败类别给出可读、不含凭据的探测说明。 */
function describeFailure(kind: S3FailureKind): string {
  switch (kind) {
    case 'auth':
      return '访问密钥无效或签名校验失败，请检查 Access Key ID 与 Secret Access Key'
    case 'access_denied':
      return '访问密钥没有该桶的操作权限，请检查桶策略'
    case 'not_found':
      return '桶不存在或对象键前缀无效，请检查桶名与路径前缀'
    case 'network':
      return '无法连接储存桶，请检查接入地址、网络与证书'
    case 'unknown':
      return '储存桶返回未知错误，无法形成明确结论'
  }
}

/**
 * 基于 @aws-sdk/client-s3 创建对象客户端。
 * @param options 接入配置与超时。
 * @returns 每次操作独立创建并销毁 S3Client，避免长连接与句柄泄漏。
 */
export function createDefaultS3ObjectClient(options: S3ObjectClientOptions): S3ObjectClient {
  async function withClient<T>(operation: (client: S3Client) => Promise<T>): Promise<T> {
    const client = new S3Client(buildS3ClientConfig(options))
    try {
      return await operation(client)
    } finally {
      client.destroy()
    }
  }

  return {
    async putObject(input) {
      await withClient((client) =>
        client.send(
          new PutObjectCommand({
            Bucket: options.bucketName,
            Key: input.key,
            Body: input.body,
            ContentLength: input.contentLength,
          }),
        ),
      )
    },
    async getObject(key) {
      return withClient(async (client) => {
        const response = await client.send(new GetObjectCommand({ Bucket: options.bucketName, Key: key }))
        const body: unknown = response.Body
        if (!isReadable(body)) throw new Error('储存桶响应缺少可读对象流')
        return body
      })
    },
    async removeObject(key) {
      await withClient((client) => client.send(new DeleteObjectCommand({ Bucket: options.bucketName, Key: key })))
    },
  }
}

/** 判断值是否为 Node 可读流。 */
function isReadable(value: unknown): value is Readable {
  return typeof value === 'object' && value !== null && 'pipe' in value && typeof value.pipe === 'function'
}

/** 计算对象键；前缀由服务层校验，这里只负责拼接与去重斜杠。 */
function objectKey(prefix: string | null, key: string): string {
  const normalizedPrefix = prefix?.replace(/^\/+|\/+$/g, '') ?? ''
  return normalizedPrefix.length > 0 ? `${normalizedPrefix}/${key}` : key
}

/** 读取探针对象并计算摘要与字节数；不把对象内容留在响应中。 */
async function readProbeBody(stream: Readable): Promise<{ sizeBytes: number; sha256: string }> {
  const hash = createHash('sha256')
  let sizeBytes = 0
  const sink = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length
      hash.update(chunk)
      callback()
    },
  })
  await pipelineAsync(stream, sink)
  return { sizeBytes, sha256: hash.digest('hex') }
}

/**
 * 创建 S3 兼容储存桶适配器。
 * @param options 接入配置、解密后的凭据与探测超时；凭据只在本闭包内使用。
 * @returns 实现 `StorageAdapter` 的适配器：流式写入、读取、删除与连接探测。
 * @remarks 普通对象读写只设置连接超时，避免固定请求超时误杀大文件传输；
 * 探测客户端额外设置 `STORAGE_PROBE_TIMEOUT_MS` 请求超时，防止测试连接挂起。
 */
export function createS3StorageAdapter(options: S3StorageAdapterOptions): StorageAdapter {
  const objectClient: S3ObjectClient =
    options.client ??
    createDefaultS3ObjectClient({
      endpoint: options.endpoint,
      region: options.region,
      bucketName: options.bucketName,
      credentials: options.credentials,
      connectionTimeoutMs: options.probeTimeoutMs,
      requestTimeoutMs: 0,
    })
  const probeClient: S3ObjectClient =
    options.client ??
    createDefaultS3ObjectClient({
      endpoint: options.endpoint,
      region: options.region,
      bucketName: options.bucketName,
      credentials: options.credentials,
      connectionTimeoutMs: options.probeTimeoutMs,
      requestTimeoutMs: options.probeTimeoutMs,
    })

  async function probe(): Promise<StorageProbeOutcome> {
    const key = objectKey(options.pathPrefix, `.probe-${randomUUID()}`)
    try {
      await probeClient.putObject({
        key,
        body: Readable.from([PROBE_BODY]),
        contentLength: PROBE_BODY.length,
      })
    } catch (error) {
      const kind = classifyS3Failure(error)
      if (kind !== 'access_denied') {
        return {
          result: kind === 'auth' ? 'auth_failed' : 'unreachable',
          message: describeFailure(kind),
        }
      }
      // 写被拒时尝试读取探针对象：返回“不存在”说明凭据可读且连接正常，只是没有写权限。
      try {
        const stream = await probeClient.getObject(key)
        stream.destroy()
        return { result: 'read_only', message: '储存桶可读但不可写，请检查访问密钥的写入权限' }
      } catch (readError) {
        const readKind = classifyS3Failure(readError)
        if (readKind === 'not_found') {
          return { result: 'read_only', message: '储存桶可读但不可写，请检查访问密钥的写入权限' }
        }
        if (readKind === 'auth') {
          return { result: 'auth_failed', message: describeFailure(readKind) }
        }
        return { result: 'unreachable', message: describeFailure(readKind) }
      }
    }

    try {
      const stream = await probeClient.getObject(key)
      const readback = await readProbeBody(stream)
      if (readback.sizeBytes !== PROBE_BODY.length || readback.sha256 !== hashProbeBody()) {
        return { result: 'unreachable', message: '探针对象读回内容不一致，请检查储存桶的读写一致性' }
      }
    } catch (error) {
      const kind = classifyS3Failure(error)
      await removeProbeQuietly(probeClient, key)
      if (kind === 'auth') return { result: 'auth_failed', message: describeFailure(kind) }
      return { result: 'unreachable', message: '储存桶写入成功但读取失败，请检查读取权限或网络' }
    }

    try {
      await removeObjectIfPresent(probeClient, key)
    } catch (error) {
      const kind = classifyS3Failure(error)
      return {
        result: kind === 'auth' ? 'auth_failed' : 'unreachable',
        message: '探针对象删除失败，请检查删除权限；未清理的探针对象可手动删除',
      }
    }
    return { result: 'read_write', message: '储存桶可读写' }
  }

  return {
    async put(key, source, sizeBytes): Promise<StorageWriteResult> {
      const hash = createHash('sha256')
      let written = 0
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      const body = source.pipe(meter)
      try {
        await objectClient.putObject({
          key: objectKey(options.pathPrefix, key),
          body,
          contentLength: sizeBytes,
        })
      } catch (error) {
        body.destroy()
        source.destroy()
        throw error
      }
      if (written !== sizeBytes) throw new Error('写入字节数与声明大小不一致')
      return { sizeBytes: written, sha256: hash.digest('hex') }
    },

    async get(key) {
      return objectClient.getObject(objectKey(options.pathPrefix, key))
    },

    async remove(key) {
      await removeObjectIfPresent(objectClient, objectKey(options.pathPrefix, key))
    },

    probe,
  }
}

/** 探针内容的 SHA-256；避免每次重算固定值。 */
function hashProbeBody(): string {
  return createHash('sha256').update(PROBE_BODY).digest('hex')
}

/** 删除对象；对象不存在视为成功，满足 StorageAdapter 的幂等删除约定。 */
async function removeObjectIfPresent(client: S3ObjectClient, key: string): Promise<void> {
  try {
    await client.removeObject(key)
  } catch (error) {
    if (classifyS3Failure(error) !== 'not_found') throw error
  }
}

/** 尽力清理探针对象；清理失败不覆盖主结论。 */
async function removeProbeQuietly(client: S3ObjectClient, key: string): Promise<void> {
  try {
    await removeObjectIfPresent(client, key)
  } catch {
    // 探测已失败；残留对象由管理员按提示手动清理，这里不改变探测结论。
  }
}
