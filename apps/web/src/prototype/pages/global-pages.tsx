import { useNavigate } from 'react-router'
import { ProtoButton } from '@/prototype/components/proto-controls'
import { PrototypeIcon } from '@/prototype/icons/icon'

/** 渲染原型未匹配路由的恢复页。 */
export function PrototypeNotFoundPage() {
  const navigate = useNavigate()
  return (
    <div className="empty">
      <PrototypeIcon name="search" />
      <h3>原型页面不存在</h3>
      <p>当前地址没有对应的原型页面，可能是链接已过期或页面尚未迁移。</p>
      <ProtoButton variant="primary" onClick={() => navigate('/prototype/projects')}>
        返回项目列表
      </ProtoButton>
    </div>
  )
}
