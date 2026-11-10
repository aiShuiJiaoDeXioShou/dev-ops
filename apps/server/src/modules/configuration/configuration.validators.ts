import { ApiError } from '../../platform/http/errors.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'

/** 凭据分类：API 密钥、账号密码与 SSH 密钥。 */
export type CredentialKind = 'api_key' | 'account_password' | 'ssh_key'
/** 凭据在数据库中的状态；过期由 expires_at 派生，不写入状态列。 */
export type CredentialDbStatus = 'active' | 'revoked'
/** 对外展示的凭据状态：数据库状态或按期限派生的已过期。 */
export type CredentialStatus = CredentialDbStatus | 'expired'
/** 环境变量所属环境；环境之间不自动继承。 */
export type Environment = 'development' | 'test' | 'production'
/** 环境变量类型：普通变量或凭据引用。 */
export type EnvVarKind = 'plain' | 'credential_ref'
/** 环境变量状态：引用失效时为 invalid。 */
export type EnvVarStatus = 'active' | 'invalid'
/** 凭据与使用记录动作。 */
export type CredentialUsageAction =
  'use' | 'create' | 'rotate' | 'revoke' | 'grant' | 'revoke_grant' | 'read_metadata' | 'reveal'
/** 凭据使用结果；失败不保存密钥值。 */
export type CredentialUsageResult = 'success' | 'denied' | 'expired' | 'failed'

const CREDENTIAL_KINDS: ReadonlySet<string> = new Set(['api_key', 'account_password', 'ssh_key'])
const CREDENTIAL_DB_STATUSES: ReadonlySet<string> = new Set(['active', 'revoked'])
const ENVIRONMENTS: ReadonlySet<string> = new Set(['development', 'test', 'production'])
const ENV_VAR_KINDS: ReadonlySet<string> = new Set(['plain', 'credential_ref'])
const ENV_VAR_STATUSES: ReadonlySet<string> = new Set(['active', 'invalid'])
const USAGE_ACTIONS: ReadonlySet<string> = new Set([
  'use',
  'create',
  'rotate',
  'revoke',
  'grant',
  'revoke_grant',
  'read_metadata',
  'reveal',
])
const USAGE_RESULTS: ReadonlySet<string> = new Set(['success', 'denied', 'expired', 'failed'])

/** 变量名或取值疑似敏感配置时提示改用凭据引用，阻止把密钥存成普通变量。 */
const SENSITIVE_NAME_PATTERN =
  /(^|_)(PASSWORD|PASSWD|PWD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|ACCESS_KEY|CREDENTIAL|AUTH_KEY)($|_)/i
/** PEM 私钥内容绝不允许作为普通变量保存。 */
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/
/** 环境变量名使用 POSIX 环境变量形式，避免注入与展示歧义。 */
const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 判断字符串是否为凭据分类。 */
function isCredentialKind(value: string): value is CredentialKind {
  return CREDENTIAL_KINDS.has(value)
}

/** 判断字符串是否为数据库凭据状态。 */
function isCredentialDbStatus(value: string): value is CredentialDbStatus {
  return CREDENTIAL_DB_STATUSES.has(value)
}

/** 判断字符串是否为环境。 */
function isEnvironment(value: string): value is Environment {
  return ENVIRONMENTS.has(value)
}

/** 判断字符串是否为环境变量类型。 */
function isEnvVarKind(value: string): value is EnvVarKind {
  return ENV_VAR_KINDS.has(value)
}

/** 判断字符串是否为环境变量状态。 */
function isEnvVarStatus(value: string): value is EnvVarStatus {
  return ENV_VAR_STATUSES.has(value)
}

/** 判断字符串是否为凭据使用动作。 */
function isUsageAction(value: string): value is CredentialUsageAction {
  return USAGE_ACTIONS.has(value)
}

/** 判断字符串是否为凭据使用结果。 */
function isUsageResult(value: string): value is CredentialUsageResult {
  return USAGE_RESULTS.has(value)
}

/** 将用户输入的凭据分类收窄为业务类型。 */
export function validateCredentialKind(value: string): CredentialKind {
  if (!isCredentialKind(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '凭据分类不合法')
  return value
}

/** 将数据库凭据分类收窄为业务类型；不合法说明是持久化异常。 */
export function toCredentialKind(value: string): CredentialKind {
  if (!isCredentialKind(value)) throw new Error(`数据库凭据分类不合法: ${value}`)
  return value
}

/** 将数据库凭据状态收窄为业务类型；不合法说明是持久化异常。 */
export function toCredentialDbStatus(value: string): CredentialDbStatus {
  if (!isCredentialDbStatus(value)) throw new Error(`数据库凭据状态不合法: ${value}`)
  return value
}

/** 将用户输入的环境收窄为业务类型。 */
export function validateEnvironment(value: string): Environment {
  if (!isEnvironment(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '环境不合法')
  return value
}

/** 将数据库环境收窄为业务类型；不合法说明是持久化异常。 */
export function toEnvironment(value: string): Environment {
  if (!isEnvironment(value)) throw new Error(`数据库环境不合法: ${value}`)
  return value
}

/** 将用户输入的环境变量类型收窄为业务类型。 */
export function validateEnvVarKind(value: string): EnvVarKind {
  if (!isEnvVarKind(value)) throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '环境变量类型不合法')
  return value
}

/** 将数据库环境变量类型收窄为业务类型；不合法说明是持久化异常。 */
export function toEnvVarKind(value: string): EnvVarKind {
  if (!isEnvVarKind(value)) throw new Error(`数据库环境变量类型不合法: ${value}`)
  return value
}

/** 将数据库环境变量状态收窄为业务类型；不合法说明是持久化异常。 */
export function toEnvVarStatus(value: string): EnvVarStatus {
  if (!isEnvVarStatus(value)) throw new Error(`数据库环境变量状态不合法: ${value}`)
  return value
}

/** 将数据库使用动作收窄为业务类型；不合法说明是持久化异常。 */
export function toUsageAction(value: string): CredentialUsageAction {
  if (!isUsageAction(value)) throw new Error(`数据库凭据使用动作不合法: ${value}`)
  return value
}

/** 将数据库使用结果收窄为业务类型；不合法说明是持久化异常。 */
export function toUsageResult(value: string): CredentialUsageResult {
  if (!isUsageResult(value)) throw new Error(`数据库凭据使用结果不合法: ${value}`)
  return value
}

/**
 * 校验必填文本并去除首尾空格。
 * @param value 用户输入文本。
 * @param name 字段中文名，用于错误提示。
 * @param maxLength 允许的最大字符数。
 * @returns 去除首尾空格后的文本。
 * @throws 为空或超长时抛出 VALIDATION_ERROR。
 */
export function requireText(value: string, name: string, maxLength: number): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > maxLength) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}长度必须在 1-${maxLength} 个字符之间`)
  }
  return trimmed
}

/**
 * 校验可选文本；null 与未传都表示不设置。
 * @param value 用户输入文本或 null。
 * @param name 字段中文名，用于错误提示。
 * @param maxLength 允许的最大字符数。
 * @returns 去除首尾空格后的文本；空文本归一为 null。
 * @throws 超长时抛出 VALIDATION_ERROR。
 */
export function optionalText(value: string | null | undefined, name: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  if (trimmed.length > maxLength) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}不能超过 ${maxLength} 个字符`)
  }
  return trimmed.length === 0 ? null : trimmed
}

/**
 * 校验破坏性操作必填原因。
 * @param value 用户输入原因。
 * @returns 去除首尾空格后的原因。
 * @throws 为空或超长时抛出 VALIDATION_ERROR。
 */
export function validateReason(value: string): string {
  return requireText(value, '原因', 1000)
}

/**
 * 校验凭据明文值长度。
 * @param value 请求体中的凭据明文，只用于加密，不参与持久化明文。
 * @returns 原始明文值。
 * @throws 为空或超长时抛出 VALIDATION_ERROR。
 */
export function validateCredentialValue(value: string): string {
  if (value.length === 0 || value.length > 100_000) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '凭据内容长度必须在 1-100000 个字符之间')
  }
  return value
}

/**
 * 校验普通环境变量取值。
 * @param value 用户输入取值。
 * @returns 去除首尾空格后的取值。
 * @throws 为空或超长时抛出 VALIDATION_ERROR。
 */
export function validatePlainValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 4000) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '环境变量取值长度必须在 1-4000 个字符之间')
  }
  return trimmed
}

/**
 * 校验环境变量名，必须符合 POSIX 环境变量形式。
 * @param value 用户输入名称。
 * @returns 去除首尾空格后的名称。
 * @throws 不符合 `[A-Za-z_][A-Za-z0-9_]*` 或超长时抛出 VALIDATION_ERROR。
 */
export function validateVariableName(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > 120 || !VARIABLE_NAME_PATTERN.test(trimmed)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '环境变量名必须匹配 [A-Za-z_][A-Za-z0-9_]* 且不超过 120 个字符')
  }
  return trimmed
}

/**
 * 阻止把敏感值保存为普通环境变量。
 * @param name 环境变量名。
 * @param value 普通变量取值。
 * @returns 无返回值。
 * @throws 名称或取值疑似密钥时抛出 VALIDATION_ERROR，提示改用凭据引用。
 */
export function assertPlainValueNotSensitive(name: string, value: string): void {
  if (SENSITIVE_NAME_PATTERN.test(name)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '变量名疑似敏感配置，请改用凭据引用保存密钥值')
  }
  if (PRIVATE_KEY_PATTERN.test(value)) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '检测到私钥内容，普通变量不能保存密钥，请改用凭据引用')
  }
}

/**
 * 校验可选的未来时间点（凭据或授权期限），为空表示长期有效。
 * @param value ISO 8601 字符串；null 与未传都表示长期。
 * @param name 字段中文名，用于错误提示。
 * @returns 解析后的时间点或 null。
 * @throws 无法解析或不晚于当前时间时抛出 VALIDATION_ERROR。
 */
export function validateFutureTimestamp(value: string | null | undefined, name: string): Date | null {
  if (value === undefined || value === null) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}不是合法时间`)
  }
  if (parsed.getTime() <= Date.now()) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, `${name}必须晚于当前时间`)
  }
  return parsed
}

/**
 * 判断错误是否为唯一约束冲突；并发写入同名记录时转换为业务错误码。
 * @param error 捕获的未知错误。
 * @returns 是唯一约束冲突时为 true，并检查 cause 链。
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === '23505') return true
  return 'cause' in error && isUniqueConstraintError(error.cause)
}
