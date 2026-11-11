import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertAttachmentSize,
  assertSubmitAttachmentCount,
  normalizeAttachmentFileName,
  parseAttachmentContentLength,
} from '../../src/modules/attachments/attachments.policy.ts'
import { ApiError } from '../../src/platform/http/errors.ts'
import { ERROR_CODES } from '../../src/platform/http/error-codes.ts'

function assertApiCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof ApiError && error.code === code)
}

test('normalizeAttachmentFileName 规范化空白与 Unicode 并拒绝危险字符', () => {
  assert.equal(normalizeAttachmentFileName('  截图.png  '), '截图.png')
  assert.equal(normalizeAttachmentFileName('ｒｅｐｏｒｔ.pdf'), 'report.pdf')
  assertApiCode(() => normalizeAttachmentFileName('   '), ERROR_CODES.ATTACHMENT_INVALID)
  assertApiCode(() => normalizeAttachmentFileName('../etc/passwd'), ERROR_CODES.ATTACHMENT_INVALID)
  assertApiCode(() => normalizeAttachmentFileName('a\\b.txt'), ERROR_CODES.ATTACHMENT_INVALID)
  assertApiCode(() => normalizeAttachmentFileName('bad\u0000name.txt'), ERROR_CODES.ATTACHMENT_INVALID)
  assertApiCode(() => normalizeAttachmentFileName('x'.repeat(256)), ERROR_CODES.ATTACHMENT_INVALID)
})

test('assertAttachmentSize 拒绝空文件与超限文件', () => {
  assert.doesNotThrow(() => assertAttachmentSize(1_024, 52_428_800))
  assertApiCode(() => assertAttachmentSize(0, 52_428_800), ERROR_CODES.ATTACHMENT_INVALID)
  assertApiCode(() => assertAttachmentSize(52_428_801, 52_428_800), ERROR_CODES.ATTACHMENT_LIMIT_EXCEEDED)
})

test('assertSubmitAttachmentCount 同时约束单次与单记录上限', () => {
  const policy = { maxFilesPerSubmit: 10, maxFilesPerRecord: 50 }
  assert.doesNotThrow(() => assertSubmitAttachmentCount(10, 40, policy))
  assertApiCode(() => assertSubmitAttachmentCount(11, 0, policy), ERROR_CODES.ATTACHMENT_LIMIT_EXCEEDED)
  assertApiCode(() => assertSubmitAttachmentCount(1, 50, policy), ERROR_CODES.ATTACHMENT_LIMIT_EXCEEDED)
})

test('parseAttachmentContentLength 拒绝缺失与非法长度', () => {
  assert.equal(parseAttachmentContentLength('1024', 52_428_800), 1_024)
  assertApiCode(() => parseAttachmentContentLength(undefined, 52_428_800), ERROR_CODES.ATTACHMENT_INVALID)
  assertApiCode(() => parseAttachmentContentLength('abc', 52_428_800), ERROR_CODES.ATTACHMENT_INVALID)
  assertApiCode(() => parseAttachmentContentLength('0', 52_428_800), ERROR_CODES.ATTACHMENT_INVALID)
  assertApiCode(() => parseAttachmentContentLength('99999999', 52_428_800), ERROR_CODES.ATTACHMENT_LIMIT_EXCEEDED)
})
