import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { createSecretCipher } from '../../src/modules/configuration/configuration.crypto.ts'

test('凭据加解密：AES-256-GCM 往返、篡改失败与密钥版本', () => {
  const key = randomBytes(32).toString('base64')
  const cipher = createSecretCipher(key)
  const encrypted = cipher.encrypt('测试密钥值')
  assert.equal(encrypted.keyVersion, 1)
  assert.notEqual(encrypted.ciphertext, '测试密钥值')
  assert.equal(cipher.decrypt(encrypted), '测试密钥值')
  assert.throws(() => cipher.decrypt({ ...encrypted, ciphertext: Buffer.from('bad').toString('base64') }))
})
