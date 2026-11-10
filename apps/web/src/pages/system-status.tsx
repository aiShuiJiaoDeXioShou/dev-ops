import { ConnectionStatus } from '@/features/system/public'

/**
 * 展示后端与数据库连接详情，复用工作台的同一份查询缓存。
 * @returns 系统状态页面；刷新按钮触发真实就绪检查。
 */
export function Component() {
  return (
    <div className="catalog">
      <h1 className="sr-only">系统状态</h1>
      <ConnectionStatus />
    </div>
  )
}

export default Component
