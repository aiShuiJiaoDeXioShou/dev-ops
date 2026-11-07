/**
 * 校验 PostgreSQL 连接地址，错误消息仅包含配置项名称。
 * @param value 待校验的连接地址。
 * @param name 配置项名称，用于定位错误，不能传入连接地址或密码。
 * @returns 校验通过时不返回值，也不建立连接。
 * @throws 协议、主机或数据库名称缺失或不合法时抛出中文错误。
 */
export function validateDatabaseUrl(value: string, name: string): void {
  try {
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname
      || !url.pathname.slice(1) || url.pathname.slice(1).includes('/') || url.hash) {
      throw new Error('连接地址格式错误')
    }
  } catch {
    throw new Error(`${name} 必须是包含主机和数据库名的 PostgreSQL URL`)
  }
}
