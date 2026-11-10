export const BUG_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_fix: '修复中',
  in_regression: '待回归',
  resolved: '已解决',
  closed: '已关闭',
}
export const BUG_STATUS_OPTIONS = Object.entries(BUG_STATUS_LABELS)
export const REGRESSION_RESULT_LABELS: Record<string, string> = {
  pending: '待验证',
  passed: '通过',
  failed: '失败',
  withdrawn: '已撤回',
}
