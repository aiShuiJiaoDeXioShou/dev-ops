import { ShieldAlert } from 'lucide-react'
import { StorageBucketManagement } from '@/features/storage/public'
import { useSession } from '@/features/identity/public'
import { EmptyState } from '@/shared/ui/page-state'

/**
 * 平台储存桶管理页。
 * 仅平台管理员可用；非管理员直接访问时展示权限说明，不渲染管理控件也不请求接口。
 * @returns 储存桶管理界面或权限提示。
 */
export function Component() {
  const { isPlatformAdmin } = useSession()
  if (!isPlatformAdmin) {
    return (
      <div className="catalog">
        <h1 className="sr-only">储存桶管理</h1>
        <EmptyState
          icon={<ShieldAlert />}
          title="仅平台管理员可管理储存桶"
          description="储存桶是平台级配置，涉及所有团队附件的写入位置。如需调整，请联系平台管理员。"
        />
      </div>
    )
  }
  return <StorageBucketManagement />
}

export default Component
