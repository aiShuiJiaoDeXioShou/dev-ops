import { Link } from 'react-router'
import { EmptyState } from '@/shared/ui/page-state'
import { Button } from '@/shared/ui/controls/button'
import { Card, CardContent } from '@/shared/ui/controls/card'

/**
 * 展示未匹配路径的恢复入口。
 * @returns 保留应用导航的页面不存在提示。
 */
export function NotFoundPage() {
  return (
    <Card>
      <CardContent>
        <EmptyState
          title="页面不存在"
          description="这个地址没有对应的页面，请检查链接或返回工作台。"
          action={
            <Button asChild>
              <Link to="/">返回工作台</Link>
            </Button>
          }
        />
      </CardContent>
    </Card>
  )
}
