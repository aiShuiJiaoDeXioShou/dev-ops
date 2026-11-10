import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'

/** 项目环境固定集合；V0.2 不提供自定义环境。 */
export const ENVIRONMENTS = ['development', 'test', 'production'] as const
export type Environment = (typeof ENVIRONMENTS)[number]

/** 构建结果状态。 */
export const BUILD_RESULT_STATUSES = ['succeeded', 'failed', 'cancelled', 'unknown'] as const
export type BuildResultStatus = (typeof BUILD_RESULT_STATUSES)[number]

/** 构建上报来源。 */
export const BUILD_SOURCES = ['pipeline', 'local', 'external_system', 'manual'] as const
export type BuildSource = (typeof BUILD_SOURCES)[number]

/** 构建产物类型；V0.2 固定三类。 */
export const ARTIFACT_TYPES = ['mobile_package', 'mini_program_qr', 'web_test_url'] as const
export type ArtifactType = (typeof ARTIFACT_TYPES)[number]

/** 产物来源。 */
export const ARTIFACT_SOURCES = ['manual', 'pipeline', 'external_system'] as const
export type ArtifactSource = (typeof ARTIFACT_SOURCES)[number]

/** 产物状态。 */
export const ARTIFACT_STATUSES = ['available', 'expired', 'invalid'] as const
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number]

/** 构建记录可关联的事项类型。 */
export const TARGET_TYPES = ['requirement', 'bug'] as const
export type BuildTargetType = (typeof TARGET_TYPES)[number]

/** 运行版本核对状态；无法核对时不得用历史值冒充已确认。 */
export const VERIFICATION_STATUSES = ['confirmed', 'pending', 'unknown'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

/** 运行版本来源；V0.2 只支持人工确认，部署回执为预留枚举。 */
export const RUN_VERSION_SOURCES = ['manual', 'deployment_receipt'] as const
export type RunVersionSource = (typeof RUN_VERSION_SOURCES)[number]

/** 外部提审对象类型。 */
export const REVIEW_TARGET_TYPES = ['mini_program', 'mobile_app'] as const
export type ReviewTargetType = (typeof REVIEW_TARGET_TYPES)[number]

/** 外部审核状态；与发布结果分别表达。 */
export const REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'unknown'] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** 实际发布结果状态。 */
export const RELEASE_STATUSES = ['not_released', 'released', 'partially_released', 'unknown'] as const
export type ReleaseStatus = (typeof RELEASE_STATUSES)[number]

const ENVIRONMENT_SET = new Set<string>(ENVIRONMENTS)
const BUILD_STATUS_SET = new Set<string>(BUILD_RESULT_STATUSES)
const BUILD_SOURCE_SET = new Set<string>(BUILD_SOURCES)
const ARTIFACT_TYPE_SET = new Set<string>(ARTIFACT_TYPES)
const ARTIFACT_SOURCE_SET = new Set<string>(ARTIFACT_SOURCES)
const TARGET_TYPE_SET = new Set<string>(TARGET_TYPES)
const VERIFICATION_STATUS_SET = new Set<string>(VERIFICATION_STATUSES)
const RUN_VERSION_SOURCE_SET = new Set<string>(RUN_VERSION_SOURCES)
const REVIEW_TARGET_TYPE_SET = new Set<string>(REVIEW_TARGET_TYPES)
const REVIEW_STATUS_SET = new Set<string>(REVIEW_STATUSES)
const RELEASE_STATUS_SET = new Set<string>(RELEASE_STATUSES)

function validationError(message: string): never {
  throw new ApiError(ERROR_CODES.VALIDATION_ERROR, message)
}

/**
 * 校验并去除首尾空白的必填文本。
 * @param value 原始文本。
 * @param name 字段中文名，用于错误说明。
 * @param maxLength 最大长度。
 * @returns 清理后的文本。
 * @throws 为空或超长时抛出 VALIDATION_ERROR。
 */
export function requireText(value: string, name: string, maxLength: number): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    validationError(`${name}长度必须在 1-${maxLength} 个字符之间`)
  }
  return trimmed
}

/**
 * 校验可选文本；空字符串按未提供处理。
 * @param value 原始文本或空。
 * @param name 字段中文名。
 * @param maxLength 最大长度。
 * @returns 清理后的文本或 null。
 * @throws 超长时抛出 VALIDATION_ERROR。
 */
export function optionalText(value: string | null | undefined, name: string, maxLength: number): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > maxLength) validationError(`${name}不能超过 ${maxLength} 个字符`)
  return trimmed
}

/** 判断字符串是否为项目环境。 */
export function isEnvironment(value: string): value is Environment {
  return ENVIRONMENT_SET.has(value)
}

/** 校验项目环境。 */
export function validateEnvironment(value: string): Environment {
  if (!isEnvironment(value)) validationError('环境必须为开发、测试或生产')
  return value
}

/** 判断字符串是否为构建结果状态。 */
export function isBuildResultStatus(value: string): value is BuildResultStatus {
  return BUILD_STATUS_SET.has(value)
}

/** 校验构建结果状态。 */
export function validateBuildResultStatus(value: string): BuildResultStatus {
  if (!isBuildResultStatus(value)) validationError('构建结果状态不合法')
  return value
}

/** 判断字符串是否为构建来源。 */
export function isBuildSource(value: string): value is BuildSource {
  return BUILD_SOURCE_SET.has(value)
}

/** 校验构建来源。 */
export function validateBuildSource(value: string): BuildSource {
  if (!isBuildSource(value)) validationError('构建来源不合法')
  return value
}

/** 判断字符串是否为产物类型。 */
export function isArtifactType(value: string): value is ArtifactType {
  return ARTIFACT_TYPE_SET.has(value)
}

/** 校验产物类型。 */
export function validateArtifactType(value: string): ArtifactType {
  if (!isArtifactType(value)) validationError('产物类型不合法')
  return value
}

/** 判断字符串是否为产物来源。 */
export function isArtifactSource(value: string): value is ArtifactSource {
  return ARTIFACT_SOURCE_SET.has(value)
}

/** 校验产物来源。 */
export function validateArtifactSource(value: string): ArtifactSource {
  if (!isArtifactSource(value)) validationError('产物来源不合法')
  return value
}

/** 判断字符串是否为可关联事项类型。 */
export function isBuildTargetType(value: string): value is BuildTargetType {
  return TARGET_TYPE_SET.has(value)
}

/** 校验可关联事项类型。 */
export function validateBuildTargetType(value: string): BuildTargetType {
  if (!isBuildTargetType(value)) validationError('关联事项类型不合法')
  return value
}

/**
 * 校验外部访问引用：仅允许 http/https，禁止内嵌凭据与危险协议。
 * @param value 外部地址。
 * @param name 字段中文名，用于错误说明。
 * @returns 清理后的地址。
 * @throws 协议、凭据或长度不合法时抛出 VALIDATION_ERROR。
 */
export function validateExternalUrl(value: string, name: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 2000) validationError(`${name}长度必须在 1-2000 个字符之间`)
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    validationError(`${name}必须为完整的 http 或 https 地址`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    validationError(`${name}不能包含凭据，且只支持 http/https`)
  }
  return trimmed
}

/**
 * 校验产物访问地址。
 * @param value 产物访问地址。
 * @returns 清理后的地址。
 * @throws 协议、凭据或长度不合法时抛出 VALIDATION_ERROR。
 */
export function validateAccessUrl(value: string): string {
  return validateExternalUrl(value, '产物地址')
}

/**
 * 校验业务时间点：不早于 2000 年，不晚于当前时间 5 分钟。
 * @param value ISO 时间字符串。
 * @param name 字段中文名，用于错误说明。
 * @returns 解析后的时间。
 * @throws 格式或范围不合法时抛出 VALIDATION_ERROR。
 */
export function validateTimestamp(value: string, name: string): Date {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) validationError(`${name}格式不合法`)
  const lower = Date.parse('2000-01-01T00:00:00Z')
  const upper = Date.now() + 5 * 60 * 1000
  if (date.getTime() < lower || date.getTime() > upper) validationError(`${name}超出允许范围`)
  return date
}

/**
 * 校验采集时间。
 * @param value ISO 时间字符串。
 * @returns 解析后的时间。
 * @throws 格式或范围不合法时抛出 VALIDATION_ERROR。
 */
export function validateCollectedAt(value: string): Date {
  return validateTimestamp(value, '采集时间')
}

/**
 * 校验更正原因。
 * @param value 原因文本。
 * @returns 清理后的原因。
 * @throws 为空或超长时抛出 VALIDATION_ERROR。
 */
export function validateReason(value: string): string {
  return requireText(value, '原因', 1000)
}

/** 判断字符串是否为运行版本核对状态。 */
export function isVerificationStatus(value: string): value is VerificationStatus {
  return VERIFICATION_STATUS_SET.has(value)
}

/** 校验运行版本核对状态。 */
export function validateVerificationStatus(value: string): VerificationStatus {
  if (!isVerificationStatus(value)) validationError('核对状态必须为已确认、待核对或未知')
  return value
}

/** 判断字符串是否为运行版本来源。 */
export function isRunVersionSource(value: string): value is RunVersionSource {
  return RUN_VERSION_SOURCE_SET.has(value)
}

/** 校验运行版本来源。 */
export function validateRunVersionSource(value: string): RunVersionSource {
  if (!isRunVersionSource(value)) validationError('运行版本来源必须为人工确认或部署回执')
  return value
}

/** 判断字符串是否为外部提审对象类型。 */
export function isReviewTargetType(value: string): value is ReviewTargetType {
  return REVIEW_TARGET_TYPE_SET.has(value)
}

/** 校验外部提审对象类型。 */
export function validateReviewTargetType(value: string): ReviewTargetType {
  if (!isReviewTargetType(value)) validationError('提审对象必须为小程序或移动端应用')
  return value
}

/** 判断字符串是否为外部审核状态。 */
export function isReviewStatus(value: string): value is ReviewStatus {
  return REVIEW_STATUS_SET.has(value)
}

/** 校验外部审核状态。 */
export function validateReviewStatus(value: string): ReviewStatus {
  if (!isReviewStatus(value)) validationError('审核状态不合法')
  return value
}

/** 判断字符串是否为实际发布结果状态。 */
export function isReleaseStatus(value: string): value is ReleaseStatus {
  return RELEASE_STATUS_SET.has(value)
}

/** 校验实际发布结果状态。 */
export function validateReleaseStatus(value: string): ReleaseStatus {
  if (!isReleaseStatus(value)) validationError('发布结果状态不合法')
  return value
}

/**
 * 校验流水线起止时间：两边都有值时不得倒置。
 * @param startedAt 开始时间。
 * @param finishedAt 结束时间。
 * @returns 无返回值；合法时正常返回。
 * @throws 开始时间晚于结束时间时抛出 VALIDATION_ERROR。
 */
export function validateTimeRange(startedAt: Date | undefined, finishedAt: Date | undefined): void {
  if (startedAt && finishedAt && startedAt.getTime() > finishedAt.getTime()) {
    validationError('结束时间不能早于开始时间')
  }
}

/**
 * 将数据库中的环境值收窄为业务类型；不合法说明持久化异常。
 * @param value 数据库值。
 * @returns 环境。
 * @throws 数据不合法时抛出普通 Error。
 */
export function toEnvironment(value: string): Environment {
  if (!isEnvironment(value)) throw new Error(`数据库环境值不合法: ${value}`)
  return value
}

/**
 * 将数据库中的构建状态收窄为业务类型；不合法说明持久化异常。
 * @param value 数据库值。
 * @returns 构建结果状态。
 * @throws 数据不合法时抛出普通 Error。
 */
export function toBuildResultStatus(value: string): BuildResultStatus {
  if (!isBuildResultStatus(value)) throw new Error(`数据库构建状态不合法: ${value}`)
  return value
}

/**
 * 将数据库中的产物类型收窄为业务类型；不合法说明持久化异常。
 * @param value 数据库值。
 * @returns 产物类型。
 * @throws 数据不合法时抛出普通 Error。
 */
export function toArtifactType(value: string): ArtifactType {
  if (!isArtifactType(value)) throw new Error(`数据库产物类型不合法: ${value}`)
  return value
}

/**
 * 将数据库中的产物来源收窄为业务类型；不合法说明持久化异常。
 * @param value 数据库值。
 * @returns 产物来源。
 * @throws 数据不合法时抛出普通 Error。
 */
export function toArtifactSource(value: string): ArtifactSource {
  if (!isArtifactSource(value)) throw new Error(`数据库产物来源不合法: ${value}`)
  return value
}

/**
 * 将数据库中的产物状态收窄为业务类型；不合法说明持久化异常。
 * @param value 数据库值。
 * @returns 产物状态。
 * @throws 数据不合法时抛出普通 Error。
 */
export function toArtifactStatus(value: string): ArtifactStatus {
  if (!['available', 'expired', 'invalid'].includes(value)) throw new Error(`数据库产物状态不合法: ${value}`)
  return value as ArtifactStatus
}

/**
 * 将数据库中的运行版本核对状态收窄为业务类型；不合法说明持久化异常。
 * @param value 数据库值。
 * @returns 核对状态。
 * @throws 数据不合法时抛出普通 Error。
 */
export function toVerificationStatus(value: string): VerificationStatus {
  if (!isVerificationStatus(value)) throw new Error(`数据库核对状态不合法: ${value}`)
  return value
}

/**
 * 将数据库中的运行版本来源收窄为业务类型；不合法说明持久化异常。
 * @param value 数据库值。
 * @returns 运行版本来源。
 * @throws 数据不合法时抛出普通 Error。
 */
export function toRunVersionSource(value: string): RunVersionSource {
  if (!isRunVersionSource(value)) throw new Error(`数据库运行版本来源不合法: ${value}`)
  return value
}

/**
 * 将数据库中的提审对象类型收窄为业务类型；不合法说明持久化异常。
 * @param value 数据库值。
 * @returns 提审对象类型。
 * @throws 数据不合法时抛出普通 Error。
 */
export function toReviewTargetType(value: string): ReviewTargetType {
  if (!isReviewTargetType(value)) throw new Error(`数据库提审对象类型不合法: ${value}`)
  return value
}

/**
 * 将数据库中的审核状态收窄为业务类型；不合法说明持久化异常。
 * @param value 数据库值。
 * @returns 审核状态。
 * @throws 数据不合法时抛出普通 Error。
 */
export function toReviewStatus(value: string): ReviewStatus {
  if (!isReviewStatus(value)) throw new Error(`数据库审核状态不合法: ${value}`)
  return value
}

/**
 * 将数据库中的发布结果状态收窄为业务类型；不合法说明持久化异常。
 * @param value 数据库值。
 * @returns 发布结果状态。
 * @throws 数据不合法时抛出普通 Error。
 */
export function toReleaseStatus(value: string): ReleaseStatus {
  if (!isReleaseStatus(value)) throw new Error(`数据库发布结果状态不合法: ${value}`)
  return value
}

/**
 * 校验数据库中的外部访问引用仍为安全地址；不合法说明持久化异常。
 * @param value 数据库地址。
 * @param name 字段中文名，用于错误说明。
 * @returns 原地址。
 * @throws 数据库存量地址不合法时抛出普通 Error，不用用户输入错误掩盖数据异常。
 */
export function toExternalUrl(value: string, name: string): string {
  try {
    return validateExternalUrl(value, name)
  } catch {
    throw new Error(`数据库${name}不合法`)
  }
}
