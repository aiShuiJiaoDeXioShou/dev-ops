import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { ConnectionStatus } from '@/features/system/public'
import { EmptyState } from '@/shared/ui/page-state'
import { Button } from '@/shared/ui/controls/button'
import { Card, CardContent } from '@/shared/ui/controls/card'

/**
 * 展示工作台入口及真实系统状态，不使用模拟业务数据。
 * @returns 工作台页面；查询状态由共享 QueryClient 管理。
 */
export function Component() {
  return (
    <div className="space-y-8">
      <div>
        <p className="mb-2 text-xs font-medium tracking-wider text-primary">工作区</p>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">工作台</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">在这里组织项目工作，并查看当前服务状态。</p>
      </div>
      <Card>
        <CardContent>
          <EmptyState
            mascot="project"
            title="项目功能尚未开放"
            description="项目、需求和 Bug 管理将在后续版本接入。当前可以先查看系统连接状态。"
            action={
              <Button asChild>
                <Link to="/system/status">
                  查看系统状态 <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
      <ConnectionStatus />
    </div>
  )
}
