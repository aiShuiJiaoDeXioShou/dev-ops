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

/** Bug 状态的视觉色调；文本仍由业务标签提供，颜色只作辅助。 */
export const BUG_STATUS_TONES = {
  pending: 'warning',
  in_fix: 'info',
  in_regression: 'warning',
  resolved: 'success',
  closed: 'neutral',
} as const

/** 根据 Bug 状态取视觉色调；未知状态按中性处理。 */
export function bugStatusTone(status: string): 'neutral' | 'info' | 'success' | 'warning' {
  return BUG_STATUS_TONES[status as keyof typeof BUG_STATUS_TONES] ?? 'neutral'
}
