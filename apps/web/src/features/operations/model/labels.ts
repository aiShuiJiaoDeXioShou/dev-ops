/** 变更计划状态、操作类型与环境的中文标签与徽标语义。 */
export const PLAN_STATUS_LABELS: Record<string, string> = {
  pending: '待确认',
  approved: '已批准',
  executing: '执行中',
  verifying: '待验证',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export const PLAN_STATUS_TONES: Record<string, 'default' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  approved: 'default',
  executing: 'default',
  verifying: 'warning',
  completed: 'success',
  failed: 'danger',
  cancelled: 'default',
}

export const OPERATION_KIND_LABELS: Record<string, string> = {
  deploy_version: '部署版本',
  database_change: '数据库变更',
  server_cleanup: '服务器清理',
  cloud_resource_change: '云资源调整',
}

export const ENVIRONMENT_LABELS: Record<string, string> = {
  development: '开发',
  test: '测试',
  production: '生产',
}

export const EXECUTION_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '执行成功',
  failed: '执行失败',
  interrupted: '已中断',
  timed_out: '已超时',
  unverified: '已执行待验证',
}

export const VERIFICATION_STATUS_LABELS: Record<string, string> = {
  pending: '待验证',
  passed: '验证通过',
  failed: '验证失败',
}

/** 计划状态是否允许编辑与危险动作，与服务端 actions 互补但不替代鉴权。 */
export const ACTIVE_PLAN_STATUSES = new Set(['approved', 'executing', 'verifying'])
