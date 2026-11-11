import type { SecretCipher } from '../configuration/configuration.crypto.ts'

/** S3 兼容储存桶的访问凭据；只保存在密文中。 */
export interface StorageBucketCredentials {
  accessKeyId: string
  secretAccessKey: string
}

/** 储存桶凭据密文列。 */
export interface EncryptedBucketCredentials {
  ciphertext: string
  iv: string
  authTag: string
  keyVersion: number
}

/**
 * 加密储存桶凭据。
 * @param cipher 平台敏感值加解密器；未配置加密密钥时为 null。
 * @param credentials 访问凭据。
 * @returns 可写入数据库的密文列。
 * @throws cipher 为空时抛出错误，由调用方转换为业务错误。
 */
export function encryptBucketCredentials(
  cipher: SecretCipher | null,
  credentials: StorageBucketCredentials,
): EncryptedBucketCredentials {
  if (!cipher) throw new Error('未配置敏感值加密密钥，无法保存储存桶凭据')
  return cipher.encrypt(JSON.stringify(credentials))
}

/**
 * 解密储存桶凭据。
 * @param cipher 平台敏感值加解密器；未配置时为 null。
 * @param encrypted 数据库中的密文列。
 * @returns 访问凭据，只在服务端内存中使用。
 * @throws cipher 为空或密文损坏时抛出错误。
 */
export function decryptBucketCredentials(
  cipher: SecretCipher | null,
  encrypted: EncryptedBucketCredentials,
): StorageBucketCredentials {
  if (!cipher) throw new Error('未配置敏感值加密密钥，无法读取储存桶凭据')
  const parsed: unknown = JSON.parse(cipher.decrypt(encrypted))
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as StorageBucketCredentials).accessKeyId !== 'string' ||
    typeof (parsed as StorageBucketCredentials).secretAccessKey !== 'string'
  ) {
    throw new Error('储存桶凭据密文内容不合法')
  }
  return parsed as StorageBucketCredentials
}

/**
 * 生成仅用于展示的 Access Key 掩码。
 * @param accessKeyId 完整 Access Key ID。
 * @returns 首 4 位与末 4 位，中间以星号填充。
 */
export function maskAccessKeyId(accessKeyId: string): string {
  if (accessKeyId.length <= 8) return '****'
  return `${accessKeyId.slice(0, 4)}****${accessKeyId.slice(-4)}`
}
