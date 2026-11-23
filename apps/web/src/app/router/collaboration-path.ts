import { matchPath } from 'react-router'

/** 协作页允许直接打开指定会话。 */
export const collaborationRoutePath = 'collaboration/:conversationId?'

/**
 * 判断当前路径是否进入协作布局，包括默认跳转到协作的首页。
 * @param pathname 路由路径，不包含查询参数和片段。
 * @returns 路径属于协作工作区时为 true。
 */
export function isCollaborationPath(pathname: string) {
  return pathname === '/' || matchPath(`/${collaborationRoutePath}`, pathname) !== null
}
