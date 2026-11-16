import { Link } from 'react-router'
import { Button } from '@/shared/ui/controls/button'
import { EmptyState, type EmptyStateMascot } from './page-state'

interface FailureContent {
  title: string
  description: string
  mascot: EmptyStateMascot
}

const FAILURES: Partial<Record<number, FailureContent>> = {
  401: { title: '登录状态已失效', description: '请重新登录后继续。', mascot: 'orbit' },
  403: { title: '没有访问权限', description: '请联系管理员确认访问权限，或返回项目列表。', mascot: 'prism' },
  404: {
    title: '页面不存在',
    description: '请检查链接是否正确，或返回项目列表。',
    mascot: 'aperture',
  },
  429: { title: '请求过于频繁', description: '请稍等片刻后重新加载页面。', mascot: 'signal' },
  500: { title: '页面暂时无法加载', description: '服务处理请求时出错，请重新加载后再试。', mascot: 'orbit' },
  502: {
    title: '暂时无法连接服务',
    description: '上游服务未返回有效响应（HTTP 502），请稍后重新加载。',
    mascot: 'signal',
  },
  503: { title: '服务暂时不可用', description: '服务可能正在维护或繁忙（HTTP 503），请稍后重试。', mascot: 'signal' },
  504: { title: '服务响应超时', description: '等待上游服务响应超时（HTTP 504），请稍后重试。', mascot: 'signal' },
}

/**
 * 渲染平台的 Bot 错误页，并为不同错误提供相应的恢复入口。
 * @param props 错误状态码、重试操作及是否独立占据整个页面。
 * @returns 带错误说明和恢复操作的界面；只使用本地定义的安全文案。
 */
export function PageFailure({
  status,
  onRetry,
  fullPage = false,
}: {
  status?: number
  onRetry?: () => void
  fullPage?: boolean
}) {
  const { title, description, mascot } = (status === undefined ? undefined : FAILURES[status]) ?? {
    title: '页面暂时无法加载',
    description: '请重新加载页面，或返回项目列表。',
    mascot: 'orbit',
  }
  const canRetry = onRetry && (status === undefined || status === 429 || status >= 500)
  const projects = (
    <Button variant={canRetry || status === 401 ? 'outline' : 'default'} asChild>
      <Link to="/projects">返回项目列表</Link>
    </Button>
  )
  const content = (
    <EmptyState
      headingLevel={1}
      mascot={mascot}
      title={title}
      description={description}
      action={
        status === 401 ? (
          <Button asChild>
            <Link to="/login">重新登录</Link>
          </Button>
        ) : canRetry ? (
          <Button type="button" onClick={onRetry}>
            重新加载
          </Button>
        ) : (
          projects
        )
      }
      secondaryAction={canRetry || status === 401 ? projects : undefined}
    />
  )

  return fullPage ? (
    <main className="grid min-h-svh place-items-center bg-background p-6">
      <div role="alert">{content}</div>
    </main>
  ) : (
    content
  )
}
