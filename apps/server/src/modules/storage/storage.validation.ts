import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import type { SecretCipher } from '../configuration/configuration.crypto.ts'
import { encryptBucketCredentials, maskAccessKeyId, type StorageBucketCredentials } from './storage.crypto.ts'
import type { StorageBucketPatch, StorageBucketRow } from './storage.repository.ts'
import type { CreateStorageBucketInput, UpdateStorageBucketInput } from './storage.types.ts'

/** 桶名称长度上限；与契约和数据库列语义一致。 */
const MAX_NAME_LENGTH = 120
/** 接入地址长度上限；按部署实际域名长度保守取值。 */
const MAX_ENDPOINT_LENGTH = 2048
/** S3 桶名长度上限；S3 协议限制为 255。 */
const MAX_BUCKET_NAME_LENGTH = 255
/** 区域名称长度上限。 */
const MAX_REGION_LENGTH = 64
/** 对象键前缀长度上限；避免超出对象键总长度限制。 */
const MAX_PATH_PREFIX_LENGTH = 255
/** 未指定区域时的默认值；MinIO 等兼容实现同样接受。 */
const DEFAULT_REGION = 'us-east-1'

function requireText(value: string, label: string, maxLength: number): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${label}长度必须在 1-${maxLength} 个字符之间`)
  }
  return trimmed
}

/** 校验并规范化接入地址；不允许携带凭据、查询参数与片段，避免误把敏感值写入配置。 */
function normalizeEndpoint(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_ENDPOINT_LENGTH) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `接入地址长度必须在 1-${MAX_ENDPOINT_LENGTH} 个字符之间`)
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '接入地址必须是完整的 HTTP 或 HTTPS URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '接入地址只支持 HTTP 或 HTTPS')
  }
  if (url.username || url.password) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '接入地址不能包含凭据，请使用 Access Key 配置')
  }
  if (url.search || url.hash) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '接入地址不能包含查询参数或片段')
  }
  return trimmed.replace(/\/+$/, '')
}

/** 校验 S3 桶名；只允许安全字符，避免对象路径与签名不一致。 */
function normalizeBucketName(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_BUCKET_NAME_LENGTH) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `桶名长度必须在 1-${MAX_BUCKET_NAME_LENGTH} 个字符之间`)
  }
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '桶名只能包含字母、数字、点、下划线与连字符')
  }
  return trimmed
}

/** 校验区域；默认值由创建路径补齐。 */
function normalizeRegion(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_REGION_LENGTH) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `区域长度必须在 1-${MAX_REGION_LENGTH} 个字符之间`)
  }
  if (!/^[A-Za-z0-9-]+$/.test(trimmed)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '区域只能包含字母、数字与连字符')
  }
  return trimmed
}

/**
 * 规范化对象键前缀。
 * @param value 用户输入；undefined 表示保持原值，null 或空字符串表示清除前缀。
 * @returns 去掉首尾斜杠的前缀；无有效内容时为 null。
 */
function normalizePathPrefix(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '')
  if (trimmed.length === 0) return null
  if (trimmed.length > MAX_PATH_PREFIX_LENGTH) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `路径前缀长度不能超过 ${MAX_PATH_PREFIX_LENGTH} 个字符`)
  }
  for (const segment of trimmed.split('/')) {
    if (segment.length === 0 || segment === '.' || segment === '..') {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '路径前缀不能包含空段、"." 或 ".."')
    }
    if (!/^[A-Za-z0-9._-]+$/.test(segment)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '路径前缀只能包含字母、数字、点、下划线、连字符与斜杠')
    }
  }
  return trimmed
}

/** 校验 Access Key ID；不记录原值。 */
function normalizeAccessKeyId(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 256) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Access Key ID 长度必须在 1-256 个字符之间')
  }
  if (/\s/.test(trimmed)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Access Key ID 不能包含空白字符')
  return trimmed
}

/** 校验 Secret Access Key；不 trim，避免改变真实凭据。 */
function normalizeSecretAccessKey(value: string): string {
  if (value.length === 0 || value.length > 512) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, 'Secret Access Key 长度必须在 1-512 个字符之间')
  }
  return value
}

/** 读取唯一冲突的约束名；用于区分名称重复与默认桶并发切换。 */
function uniqueViolationConstraint(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const constraint = Reflect.get(error, 'constraint')
  if (typeof constraint === 'string') return constraint
  if (!('cause' in error)) return undefined
  return uniqueViolationConstraint(Reflect.get(error, 'cause'))
}

/** 名称唯一冲突与默认桶唯一冲突都来自唯一索引，需要按约束名分别转换。 */
export function translateUniqueViolation(error: unknown, fallbackMessage: string): ApiError {
  const constraint = uniqueViolationConstraint(error)
  if (constraint === 'uk_storage_bucket_name') {
    return new ApiError(ERROR_CODES.STORAGE_BUCKET_NAME_CONFLICT, '储存桶名称已存在')
  }
  return new ApiError(ERROR_CODES.VERSION_CONFLICT, fallbackMessage)
}

/** 凭据不可用时的统一业务错误；密钥未配置或密文损坏都返回该码。 */
function credentialsUnavailable(): ApiError {
  return new ApiError(ERROR_CODES.STORAGE_BUCKET_NOT_WRITABLE, '未配置敏感值加密密钥，无法保存储存桶凭据')
}

/**
 * 校验、规范化并加密创建输入。
 * @param input 路由层已通过 TypeBox 校验的创建请求。
 * @param cipher 敏感值加密器；缺失时抛出业务错误。
 * @returns 可直接写入数据库的字段、加密凭据与提示用掩码。
 * @throws 字段不合法时抛出 VALIDATION_ERROR；密钥未配置时抛出 STORAGE_BUCKET_NOT_WRITABLE。
 */
export function normalizeCreateInput(
  input: CreateStorageBucketInput,
  cipher: SecretCipher | null,
): {
  name: string
  endpoint: string
  bucketName: string
  region: string
  pathPrefix: string | null
  credentials: StorageBucketCredentials
  encrypted: { ciphertext: string; iv: string; authTag: string; keyVersion: number }
  accessKeyHint: string
} {
  if (input.kind !== 's3') throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '首期只允许创建 S3 兼容储存桶')
  if (!cipher) throw credentialsUnavailable()
  const credentials: StorageBucketCredentials = {
    accessKeyId: normalizeAccessKeyId(input.accessKeyId),
    secretAccessKey: normalizeSecretAccessKey(input.secretAccessKey),
  }
  return {
    name: requireText(input.name, '储存桶名称', MAX_NAME_LENGTH),
    endpoint: normalizeEndpoint(input.endpoint),
    bucketName: normalizeBucketName(input.bucketName),
    region: normalizeRegion(input.region ?? DEFAULT_REGION),
    pathPrefix: normalizePathPrefix(input.pathPrefix) ?? null,
    credentials,
    encrypted: encryptBucketCredentials(cipher, credentials),
    accessKeyHint: maskAccessKeyId(credentials.accessKeyId),
  }
}

/**
 * 校验并组装更新补丁与审计摘要。
 * @param existing 当前行；用于内置桶保护与变更对比。
 * @param input 更新请求。
 * @returns 只包含实际变更字段的数据库补丁与脱敏审计摘要。
 * @throws 内置桶被修改受保护字段时抛出 STORAGE_BUCKET_BUILTIN_PROTECTED；
 * 凭据只提供一半或字段不合法时抛出 VALIDATION_ERROR。
 * @remarks Secret 省略表示保留原值；凭据变更要求 Access Key 与 Secret 同时提供，避免展示掩码与密文不一致。
 */
export function prepareBucketUpdate(
  existing: StorageBucketRow,
  input: UpdateStorageBucketInput,
  cipher: SecretCipher | null,
): { patch: StorageBucketPatch; changes: Record<string, unknown> } {
  if (existing.is_builtin) {
    const forbiddenField = [
      input.endpoint,
      input.bucketName,
      input.region,
      input.pathPrefix,
      input.accessKeyId,
      input.secretAccessKey,
      input.status,
    ].some((value) => value !== undefined)
    if (forbiddenField) {
      throw new ApiError(ERROR_CODES.STORAGE_BUCKET_BUILTIN_PROTECTED, '内置本地储存桶只允许修改名称')
    }
  }

  const patch: StorageBucketPatch = {}
  const changes: Record<string, unknown> = {}
  if (input.name !== undefined) {
    patch.name = requireText(input.name, '储存桶名称', MAX_NAME_LENGTH)
    if (patch.name !== existing.name) changes.name = patch.name
  }
  if (input.endpoint !== undefined && !existing.is_builtin) {
    patch.endpoint = normalizeEndpoint(input.endpoint)
    if (patch.endpoint !== existing.endpoint) changes.endpoint = patch.endpoint
  }
  if (input.bucketName !== undefined && !existing.is_builtin) {
    patch.bucketName = normalizeBucketName(input.bucketName)
    if (patch.bucketName !== existing.bucket_name) changes.bucketName = patch.bucketName
  }
  if (input.region !== undefined && !existing.is_builtin) {
    patch.region = normalizeRegion(input.region)
    if (patch.region !== existing.region) changes.region = patch.region
  }
  if (input.pathPrefix !== undefined && !existing.is_builtin) {
    const pathPrefix = normalizePathPrefix(input.pathPrefix)
    patch.pathPrefix = pathPrefix ?? null
    if (patch.pathPrefix !== existing.path_prefix) changes.pathPrefix = patch.pathPrefix
  }
  if (input.status !== undefined && !existing.is_builtin) {
    patch.status = input.status
    if (patch.status !== existing.status) changes.status = patch.status
  }
  if (input.accessKeyId !== undefined || input.secretAccessKey !== undefined) {
    if (input.accessKeyId === undefined || input.secretAccessKey === undefined) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '修改访问密钥时必须同时提供 Access Key ID 与 Secret Access Key')
    }
    if (!cipher) throw credentialsUnavailable()
    const credentials: StorageBucketCredentials = {
      accessKeyId: normalizeAccessKeyId(input.accessKeyId),
      secretAccessKey: normalizeSecretAccessKey(input.secretAccessKey),
    }
    const encrypted = encryptBucketCredentials(cipher, credentials)
    patch.credentialCiphertext = encrypted.ciphertext
    patch.credentialIv = encrypted.iv
    patch.credentialAuthTag = encrypted.authTag
    patch.credentialKeyVersion = encrypted.keyVersion
    patch.accessKeyHint = maskAccessKeyId(credentials.accessKeyId)
    // 审计只记录字段名与掩码，绝不写入 Access Key ID 或 Secret。
    changes.accessKeyId = '***'
    changes.secretAccessKey = '***'
    changes.accessKeyHint = patch.accessKeyHint
  }
  return { patch, changes }
}
