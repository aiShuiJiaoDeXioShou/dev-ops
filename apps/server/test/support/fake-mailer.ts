import type { MailMessage, MailSender } from '../../src/adapters/mail/mail.types.ts'
import { MailDeliveryError } from '../../src/adapters/mail/mail.types.ts'

/** 进程内邮件替身；只记录待断言的消息，不访问网络。 */
export class FakeMailer implements MailSender {
  readonly sent: MailMessage[] = []
  failWith: MailDeliveryError | null = null

  async send(message: MailMessage): Promise<void> {
    if (this.failWith) throw this.failWith
    this.sent.push({ ...message })
  }

  reset(): void {
    this.sent.length = 0
    this.failWith = null
  }
}
