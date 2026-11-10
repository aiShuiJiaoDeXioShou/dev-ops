/** 待发送的邮件内容；正文同时支持纯文本和可选 HTML。 */
export interface MailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

/** 邮件发送能力接口；由具体适配器实现，测试可替换。 */
export interface MailSender {
  /**
   * 发送一封邮件。
   * @param message 已校验的收件人、主题和正文。
   * @returns 投递请求被接受后完成；失败抛出 MailDeliveryError 或其他可展示错误。
   */
  send(message: MailMessage): Promise<void>
}

/** 邮件投递失败；不携带服务商凭据或原始敏感响应。 */
export class MailDeliveryError extends Error {
  readonly causeCode: string

  /**
   * 创建投递错误。
   * @param message 用户可读说明。
   * @param causeCode 可检索的失败类别，如 timeout、auth、rejected。
   */
  constructor(message: string, causeCode: string) {
    super(message)
    this.name = 'MailDeliveryError'
    this.causeCode = causeCode
  }
}
