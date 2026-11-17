/**
 * 显示协作导航的 Bot 图标。身体和眼睛分层以保留原型的摆动、眨眼和悬停反馈。
 * @returns 装饰图标，导航名称由外层链接提供。
 */
export function CollaborationNavIcon() {
  return (
    <svg className="icon size-4.5 shrink-0" viewBox="0 0 16 16" aria-hidden="true">
      <g transform="translate(-1.5 -1.8) scale(.2)">
        <g className="nav-bot-body">
          <path
            fill="var(--foreground)"
            d="M22 25C25 13 39 13 46 17 58 10 76 19 78 32c8 8 7 22 1 29-2 16-18 21-29 17-12 5-28 0-30-12C7 57 9 39 22 25Z"
          />
          <g className="nav-bot-eyes" fill="var(--background)">
            <rect x="35" y="38" width="7" height="14" rx="3.5" />
            <rect x="53" y="38" width="7" height="14" rx="3.5" />
          </g>
        </g>
      </g>
    </svg>
  )
}
