import { isRouteErrorResponse, Link, useRouteError } from 'react-router'
import { PageError } from '@/shared/ui/page-state'
import { Button } from '@/shared/ui/controls/button'
import { Card, CardContent } from '@/shared/ui/controls/card'

/**
 * 显示路由加载或渲染失败的兜底界面，不向用户输出堆栈。
 * @returns 可重新加载当前地址或返回工作台的错误页。
 */
export function RouteErrorPage() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404

  /**
   * 重新加载当前地址，让路由模块与数据重新初始化。
   * @returns 无返回值；触发浏览器整页加载。
   */
  function reloadPage() {
    window.location.reload()
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg">
        <CardContent className="space-y-6 pt-6">
          <PageError
            title={notFound ? '页面不存在' : '页面暂时无法加载'}
            description={notFound ? '请检查地址，或返回工作台。' : '页面加载或运行时遇到问题，请重新加载后再试。'}
            onRetry={reloadPage}
            retryLabel="重新加载"
          />
          <Button variant="ghost" asChild><Link to="/">返回工作台</Link></Button>
        </CardContent>
      </Card>
    </main>
  )
}
