import { Link } from 'react-router'
import { FileQuestion } from 'lucide-react'
import { EmptyState } from '@/shared/ui/page-state'

/**
 * 展示未匹配路径的恢复入口。
 * @returns 保留应用导航的页面不存在提示。
 */
export function NotFoundPage() {
  return (
    <div className="catalog">
      <EmptyState
        icon={<FileQuestion />}
        title="页面不存在"
        description="这个地址没有对应的页面。你可以检查链接，或回到项目列表继续工作。"
        action={
          <Link className="btn primary" to="/projects">
            返回项目列表
          </Link>
        }
        secondaryAction={
          <Link className="btn" to="/settings/team">
            团队管理
          </Link>
        }
      />
    </div>
  )
}
