import { PageFailure } from '@/shared/ui/page-failure'

/**
 * 展示未匹配路径，并保留应用导航与返回项目的入口。
 * @returns 平台 Bot 404 页面。
 */
export function NotFoundPage() {
  return (
    <div className="catalog">
      <PageFailure status={404} />
    </div>
  )
}
