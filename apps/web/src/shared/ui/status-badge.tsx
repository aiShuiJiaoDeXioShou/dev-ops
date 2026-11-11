/** 状态徽标色调；颜色由 token 提供，语义由调用方按业务状态决定。 */
export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/**
 * 渲染业务状态徽标：圆点 + 文本，颜色不单独承载语义。
 * @param props.tone 状态色调；children 为业务状态中文文案。
 * @returns 行内状态徽标；用于列表、详情与属性区保持一致。
 */
export function StatusBadge({ tone, children }: { tone: StatusTone; children: string }) {
  return (
    <span className={`status-pill status-pill-${tone}`}>
      <span className="status-pill-dot" aria-hidden="true" />
      {children}
    </span>
  )
}
