# 邮件适配器

实现 identity 模块声明的邮件发送能力，供邀请、密码找回等场景使用。

- 本地开发：Mailpit（`smtp://127.0.0.1:1025`，只捕获不投递）。
- stg：Resend SMTP（`smtp.resend.com:465`，用户名 `resend`，密码为 Resend API Key）。
- 测试：进程内 fake mailer，不访问公网。

发送失败必须返回明确错误，不把成员标记为已加入；邮件内容不得记录完整敏感链接或凭据。当前仅初始化目录，未实现适配器。
