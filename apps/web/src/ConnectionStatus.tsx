import { useEffect, useState } from 'react'

type ConnectionState =
  | { status: 'checking' }
  | { status: 'connected'; requestId: string | null }
  | { status: 'failed'; message: string }

/**
 * 通过同源代理验证后端及数据库就绪状态。
 * @param signal 页面销毁或重试时用于取消请求的信号。
 * @returns 后端请求标识，用于关联服务端日志；缺少响应头时为 null。
 * @throws 网络失败、超时、非成功响应或响应不符合契约时抛出错误。
 */
async function checkConnection(signal: AbortSignal): Promise<string | null> {
  const timeout = AbortSignal.timeout(5_000)
  let response: Response

  try {
    response = await fetch('/api/v1/ready', {
      headers: { accept: 'application/json' },
      signal: AbortSignal.any([signal, timeout]),
    })
  } catch {
    throw new Error(timeout.aborted ? '连接检查超时，请稍后重试。' : '无法连接后端，请检查服务是否启动。')
  }

  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(response.status === 503
      ? '数据库尚未就绪，请检查数据库服务和迁移。'
      : `后端请求失败（HTTP ${response.status}），请稍后重试。`)
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error(timeout.aborted ? '连接检查超时，请稍后重试。' : '后端未返回有效 JSON。')
  }

  if (
    body === null ||
    typeof body !== 'object' ||
    !('status' in body) ||
    body.status !== 'ok' ||
    !('database' in body) ||
    body.database !== 'ok'
  ) {
    throw new Error('后端响应不符合就绪检查契约。')
  }

  return response.headers.get('x-request-id')
}

/**
 * 展示开发环境的前端、后端与数据库联通结果，并提供重试入口。
 * @returns 联通状态面板；挂载与重试时请求就绪接口，卸载时取消未完成请求。
 */
export default function ConnectionStatus() {
  const [attempt, setAttempt] = useState(0)
  const [connection, setConnection] = useState<ConnectionState>({ status: 'checking' })

  useEffect(() => {
    const controller = new AbortController()

    void checkConnection(controller.signal).then((requestId) => {
      if (!controller.signal.aborted) {
        setConnection({ status: 'connected', requestId })
      }
    }).catch((error: unknown) => {
      // 忽略已销毁页面的结果，避免旧请求覆盖新的检查状态。
      if (!controller.signal.aborted) {
        setConnection({
          status: 'failed',
          message: error instanceof Error ? error.message : '连接检查失败，请稍后重试。',
        })
      }
    })

    return () => { controller.abort() }
  }, [attempt])

  /**
   * 重置显示状态并触发新一轮检查，上一轮请求由 Effect 清理函数取消。
   * @returns 无返回值；更新当前面板状态。
   */
  function retryConnection() {
    setConnection({ status: 'checking' })
    setAttempt(value => value + 1)
  }

  return (
    <section className="connection-status" aria-labelledby="connection-title">
      <h2 id="connection-title">开发环境联通检查</h2>
      <p role="status" aria-live="polite">
        {connection.status === 'checking' && '正在检查后端与数据库…'}
        {connection.status === 'connected' && '已联通：前端 → API 代理 → 后端 → PostgreSQL'}
        {connection.status === 'failed' && connection.message}
      </p>
      {connection.status === 'connected' && connection.requestId && (
        <p className="connection-request-id">请求标识：{connection.requestId}</p>
      )}
      <button type="button" onClick={retryConnection} disabled={connection.status === 'checking'}>
        重新检查
      </button>
    </section>
  )
}
