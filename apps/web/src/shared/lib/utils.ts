import { cn as mergeClassNames } from 'cn'

/**
 * 合并条件类名并解决 Tailwind 工具类冲突。
 * @param inputs 字符串、条件对象或数组形式的类名。
 * @returns 可用于元素 className 的合并结果，无副作用。
 */
export function cn(...inputs: Parameters<typeof mergeClassNames>): string {
  return mergeClassNames(...inputs)
}
