import { Outlet } from 'react-router'

/** 能力模块外壳：各页面自行渲染原型式页头与内容，快照页复用同一路由层级。 */
export function Component() {
  return <Outlet />
}

export default Component
