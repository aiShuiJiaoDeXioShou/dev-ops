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

/** 需求状态的视觉色调；文本仍由业务标签提供，颜色只作辅助。 */
export const REQUIREMENT_STATUS_TONES = {
  pending: 'warning',
  in_development: 'info',
  submitted: 'warning',
  in_testing: 'info',
  passed: 'success',
  cancelled: 'neutral',
} as const

/** 根据需求状态取视觉色调；未知状态按中性处理。 */
export function requirementStatusTone(status: string): 'neutral' | 'info' | 'success' | 'warning' {
  return REQUIREMENT_STATUS_TONES[status as keyof typeof REQUIREMENT_STATUS_TONES] ?? 'neutral'
}
