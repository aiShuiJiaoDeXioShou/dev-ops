import type { SVGProps } from 'react'
import { cn } from '@/shared/lib/utils'
import { iconPaths } from './icon-paths'

/** 原型图标名称；来自 HTML 原型的本地 Octicons 与品牌/能力图标。 */
export type PrototypeIconName = keyof typeof iconPaths

interface PrototypeIconProps extends Omit<SVGProps<SVGSVGElement>, 'dangerouslySetInnerHTML'> {
  /** 图标名称。 */
  name: PrototypeIconName
  /** 可选像素尺寸；默认沿用原型 19px，也可用 className 覆盖。 */
  size?: number
}

/**
 * 渲染与 HTML 原型完全一致的本地 SVG 图标。
 * @param props 图标名、可选尺寸及原生 SVG 属性。
 * @returns 使用原型 path 数据的内联 SVG；内容来自本地静态映射，不接收用户输入。
 * @remarks 图标路径来自项目原型文件，渲染时不会访问网络或执行脚本。
 */
export function PrototypeIcon({ name, size, className, style, ...props }: PrototypeIconProps) {
  const markup = iconPaths[name] ?? iconPaths.file ?? ''
  return (
    <svg
      {...props}
      viewBox="0 0 16 16"
      className={cn('icon', className)}
      style={size ? { width: size, height: size, ...style } : style}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  )
}
