import nodemailer from 'nodemailer'
import type { AppConfig } from '../../platform/config/env.ts'
import { MailDeliveryError, type MailMessage, type MailSender } from './mail.types.ts'

const MAIL_TIMEOUT_MS = 10_000

function classifyFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown'
  const code = 'code' in error && typeof error.code === 'string' ? error.code : ''
  if (/timeout|ETIMEDOUT|ESOCKET/i.test(code) || /timeout/i.test(error.message)) return 'timeout'
  if (/auth|credential|535|534/i.test(code) || /auth/i.test(error.message)) return 'auth'
  if (/connect|ECONN|ENOTFOUND|EAI_AGAIN/i.test(code)) return 'network'
  return 'rejected'
}

/**
 * 创建基于 SMTP 的邮件发送器。
 * @param config 已校验配置；缺少 SMTP_URL 或 MAIL_FROM 时返回 null。
 * @returns 邮件发送器；配置不完整时由调用方决定功能不可用。
 * @remarks 使用连接、握手与 socket 超时限制；不记录邮件正文或凭据。
 */
export function createSmtpMailer(config: AppConfig): MailSender | null {
  if (!config.SMTP_URL || !config.MAIL_FROM) return null
  const url = new URL(config.SMTP_URL)
  const secure = url.protocol === 'smtps:'
  const transport = nodemailer.createTransport({
    host: url.hostname,
    port: Number(url.port || (secure ? 465 : 587)),
    secure,
    auth: url.username ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) } : undefined,
    connectionTimeout: MAIL_TIMEOUT_MS,
    greetingTimeout: MAIL_TIMEOUT_MS,
    socketTimeout: MAIL_TIMEOUT_MS,
  })

  return {
    async send(message: MailMessage): Promise<void> {
      try {
        await transport.sendMail({
          from: config.MAIL_FROM,
          to: message.to,
          subject: message.subject,
          text: message.text,
          ...(message.html === undefined ? {} : { html: message.html }),
        })
      } catch (error) {
        throw new MailDeliveryError('邮件发送失败，请稍后重试', classifyFailure(error))
      }
    },
  }
}
