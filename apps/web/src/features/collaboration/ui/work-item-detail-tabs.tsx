import type { ReactNode } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/controls/tabs'

/**
 * 在需求和 Bug 详情内按业务内容分组，窄屏可横向滚动页签。
 * @param props 读屏标签、页签定义和对应的内容。
 * @returns 使用统一下划线选中态的详情页签。
 */
export function WorkItemDetailTabs({
  label,
  tabs,
  children,
}: {
  label: string
  tabs: readonly (readonly [value: string, label: string])[]
  children: ReactNode
}) {
  return (
    <Tabs defaultValue="info">
      <TabsList
        aria-label={label}
        className="work-item-detail-tabs sticky top-0 z-20 flex w-full justify-start gap-2 overflow-x-auto rounded-none border-b border-border bg-background p-0 sm:gap-3"
      >
        {tabs.map(([value, text]) => (
          <TabsTrigger
            key={value}
            value={value}
            className="min-h-10 shrink-0 rounded-none border-b-2 border-transparent px-1.5 text-xs focus-visible:ring-inset aria-selected:border-primary aria-selected:bg-transparent! aria-selected:text-primary! aria-selected:shadow-none! sm:px-3 sm:text-sm"
          >
            {text}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  )
}
