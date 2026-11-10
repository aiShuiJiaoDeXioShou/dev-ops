import { Button } from '@/shared/ui/controls/button'

/**
 * 列表分页控件：保持页码与筛选条件由调用方保存在 URL。
 * @param props.page 当前页（从 1 开始）；pageSize 每页数量；total 总条数。
 * @param props.onChange 页码变化回调；仅在合法范围内触发。
 * @returns 超过一页时显示上一页/下一页与页码，否则不渲染。
 */
export function Pagination({
  page,
  pageSize,
  total,
  onChange,
}: {
  page: number
  pageSize: number
  total: number
  onChange: (page: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (pageCount <= 1) return null
  return (
    <div className="pagination">
      <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </Button>
      <span className="quiet">
        第 {page} / {pageCount} 页
      </span>
      <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
        下一页
      </Button>
    </div>
  )
}
