export const REQUIREMENT_STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_development: '开发中',
  submitted: '待测试',
  in_testing: '测试中',
  passed: '已通过',
  cancelled: '已取消',
}
export const REQUIREMENT_STATUS_OPTIONS = Object.entries(REQUIREMENT_STATUS_LABELS)
export const SELF_TEST_LABELS: Record<string, string> = {
  passed: '通过',
  has_failures: '有失败',
  not_run: '未运行',
  not_applicable: '不适用',
}
