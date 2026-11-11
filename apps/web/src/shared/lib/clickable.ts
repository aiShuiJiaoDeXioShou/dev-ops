/**
 * 判断点击目标是否落在嵌套的可交互元素内。
 * 整行/整卡点击用于扩大鼠标命中区域；内部按钮、链接、输入框仍应执行自己的行为，
 * 不能被外层“打开详情”覆盖。
 * @param target 事件目标节点。
 * @returns 目标位于原生控件或 ARIA 交互角色内时为 true。
 */
export function isNestedInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('button, a, input, select, textarea, [role="button"], [role="menuitem"], [role="tab"]'))
}
