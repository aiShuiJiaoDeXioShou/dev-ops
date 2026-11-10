export interface SuccessEnvelope<T> {
  success: true
  code: 'OK'
  message: string
  requestId: string
  data: T
}

/** 构造平台成功信封；message 固定 OK。 */
export function successEnvelope<T>(data: T, requestId: string): SuccessEnvelope<T> {
  return { success: true, code: 'OK', message: 'OK', requestId, data }
}

/** 把服务端裸数组归一化为列表分页结构；不截断、不伪造未返回数据。 */
export function normalizeList<T>(data: unknown): { items: T[]; page: number; pageSize: number; total: number } {
  if (Array.isArray(data)) {
    return { items: data as T[], page: 1, pageSize: data.length, total: data.length }
  }
  if (
    typeof data === 'object' &&
    data !== null &&
    'items' in data &&
    Array.isArray((data as { items: unknown }).items)
  ) {
    const value = data as { items: T[]; page?: number; pageSize?: number; total?: number }
    return {
      items: value.items,
      page: value.page ?? 1,
      pageSize: value.pageSize ?? value.items.length,
      total: value.total ?? value.items.length,
    }
  }
  return { items: [], page: 1, pageSize: 0, total: 0 }
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** 将对象/数组渲染为简单可读文本，供默认模式使用；不用于机器契约。 */
export function humanText(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return '（空）\n'
    return `${data.map((item) => formatValue(item)).join('\n')}\n`
  }
  if (typeof data === 'object' && data !== null) {
    return `${Object.entries(data)
      .map(([key, value]) => `${key}: ${formatValue(value)}`)
      .join('\n')}\n`
  }
  return `${formatValue(data)}\n`
}

/**
 * 输出命令成功结果。
 * @param context stdout/stderr 与 JSON 模式。
 * @param data 成功数据。
 * @param requestId 服务端请求标识；本地命令可传空字符串。
 * @param render 默认模式的渲染函数。
 */
export function printSuccess(
  context: { stdout: (message: string) => void; json: boolean },
  data: unknown,
  requestId: string,
  render: (data: unknown) => string = humanText,
): void {
  if (context.json) {
    context.stdout(`${JSON.stringify(successEnvelope(data, requestId))}\n`)
    return
  }
  context.stdout(render(data))
}
