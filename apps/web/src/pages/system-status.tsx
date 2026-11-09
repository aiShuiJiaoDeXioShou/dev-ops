import { ConnectionStatus } from '@/features/system/public'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/controls/card'

/**
 * 展示后端与数据库连接详情，复用工作台的同一份查询缓存。
 * @returns 系统状态页面；刷新按钮触发真实就绪检查。
 */
export function Component() {
  return (
    <div className="space-y-8">
      <div>
        <p className="mb-2 text-xs font-medium tracking-wider text-primary">运行状态</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">系统状态</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">检查应用服务与数据库是否可以正常响应。</p>
      </div>
      <ConnectionStatus />
      <Card>
        <CardHeader>
          <CardTitle>检查范围</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
          <p>就绪检查通过同源 API 验证后端、数据库连接及业务 schema 的访问权限。</p>
          <p>结果显示最近一次检查状态，不代表持续监控。需要确认当前状态时，请重新检查。</p>
        </CardContent>
      </Card>
    </div>
  )
}
