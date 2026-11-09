import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export interface EncryptedSecret {
  ciphertext: string
  iv: string
  authTag: string
  keyVersion: number
}

export interface SecretCipher {
  encrypt(plaintext: string): EncryptedSecret
  decrypt(input: EncryptedSecret): string
}

function decodeKey(encodedKey: string | undefined): Buffer {
  if (!encodedKey) throw new Error('GIT_CREDENTIAL_ENCRYPTION_KEY 未配置，无法读写 Git 凭据')
  const key = Buffer.from(encodedKey, 'base64')
  if (key.length !== 32) throw new Error('GIT_CREDENTIAL_ENCRYPTION_KEY 必须是 32 字节 base64 值')
  return key
}

/**
 * 创建 AES-256-GCM 凭据加解密器。
 * @param encodedKey 32 字节 base64 密钥；缺失时加解密会抛错。
 * @returns 加密/解密方法与密钥版本。
 * @throws 密钥长度不合法时抛出错误。
 */
export function createSecretCipher(encodedKey: string | undefined): SecretCipher {
  const key = decodeKey(encodedKey)
  return {
    encrypt(plaintext: string): EncryptedSecret {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        keyVersion: 1,
      }
    },
    decrypt(input: EncryptedSecret): string {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(input.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(input.authTag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(input.ciphertext, 'base64')), decipher.final()]).toString(
        'utf8',
      )
    },
  }
}
