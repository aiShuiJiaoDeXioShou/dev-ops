import { StorageBucketManagement } from '@/features/storage/ui/storage-bucket-management'

/**
 * 渲染平台级配置页面，由平台 root 路由门禁保护。
 * @returns 平台管理页及完整的储存桶管理区域。
 */
export function Component() {
  return (
    <div className="content pb-6">
      <header className="page-head px-0">
        <h1>平台管理</h1>
      </header>
      <StorageBucketManagement />
    </div>
  )
}
