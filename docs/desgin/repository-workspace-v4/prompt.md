Use case: ui-mockup. Generate exactly ONE polished desktop WEB application screenshot, landscape 16:10, target 1920x1200, full-bleed flat rectangular interface. No browser or OS chrome. This is a repository-centric internal developer project and delivery management platform named "DevOps". Git REPOSITORY is the main working context. Project management supports repositories; a project can aggregate several repositories and services. It is not an AI autonomous coding dashboard.

REFERENCE IMAGES:
Image 1 (newly attached project board): information organization inspiration ONLY, including navigable work views, item details and resource context. Do not copy its browser chrome, enormous sparse board, account names or actual URLs.
Image 2 (DSH application screenshot): PRIMARY VISUAL STYLE reference for quiet navigation, near-white/light-gray surfaces, white content, hairlines, regular Chinese typography, blue links and active tabs, soft corners, clean desktop utility feel. Do not copy its logo, conversation, editor tools, layers panel, or design canvas.
Image 3 (last project-manager concept): continuity of product quality, flat structure and coherent task details. Reorganize it around the repository and the MVP requirements below.

MANDATORY PALETTE derived from DeepSeek Harness official LIGHT theme:
Blue accent exactly #4176E6 (official deepseek-500; link and info-button fill).
White content #FFFFFF.
Sidebar #F9FAFB (official neutral-bluish-50).
Soft modules #F5F6F7.
Selected neutral rows #EBEEF2.
Optional very limited selected accent fill #E4EDFD.
Primary text #0F1115.
Secondary text #61666B.
Tertiary #81858C.
Thin neutral hairlines black at 10% opacity, visually 0.5px.
Do not substitute electric cobalt, purple, teal, or a blue-tinted entire background. Blue only for key buttons, active text, active underline, links and small active icons. Neutral backgrounds remain neutral. Black and green/amber/red retain semantic text/status roles. 8/12/16px corners, rounded composer 20px. Chinese font like PingFang SC, normal body 14px, secondary 12px, section 16px medium, top repo title 22px. Avoid overly bold labels. Flat continuous white regions with fine separators, no floating giant cards or decorative dashboard tiles.

PRODUCT RULES from MVP:
Human developers work locally. Tasks have human business owners. Bots help with project/operations information, not automatic implementation. Do not show Codex/Claude developing or editing code, executing terminal commands or autonomous code progress.
The default home remains "我的工作台", collecting assigned PRD, Bug and independent todos. This screenshot is a SELECTED REPOSITORY's overview, not default home.
GitHub and Gitea connections are supported. A repository can serve multiple services. Project can aggregate several repos. Do not assert mandatory 1:1 repo-project-service mapping.
PRD and Bug progress is manually maintained; Git branch/commit/PR links are supporting evidence.
Pipeline execution is external. The platform displays final artifacts and delivery results. Never show run pipeline, deploy, retry build or publish production buttons. Latest artifact and currently running version MUST be separately labeled.
"提测" is only a business state change, never coupled to build/deploy. No built-in release execution.
Bot is available in discussions via @; it can summarize repository/project context. No AI assignee for automatic coding.
Everything is illustrative data, no real credentials or URLs.

LAYOUT — a coherent repository workbench, not an oversized metrics dashboard:
LEFT 230px full-height sidebar on #F9FAFB. Top simple small repository-outline logo plus "DevOps", workspace dropdown "研发团队". Compact navigation:
"我的工作台" with quiet count 5
"仓库" selected neutral gray rounded row, BLUE icon/text
"项目"
"Bot"
"Skills"
Thin separator, section "代码仓库" with search/plus small icons. Expanded "team / dev-ops" selected, small muted "GitHub" provider label; children "概览" blue active and "需求与 Bug" normal. Two other collapsed repositories "team / mobile-app" with "Gitea" and "team / miniapp". A separate subtle "项目" group lists "研发协作平台", "客户应用". Bottom settings and human avatar "林然". No full saturated-blue sidebar block.

CENTER about 960px in a nominal 1600px-wide image, white, clean dense enough but spacious:
Top breadcrumb "仓库 / team". Repository icon followed by "dev-ops" 22px medium, a small neutral "私有" badge. On right subtle outline "在 GitHub 查看" and one blue primary "+ 新建事项" button. Second line small gray text "项目：研发协作平台  ·  关联服务：Web、API". This is clear evidence repository is the main context.
Below 44px tabs: "概览" ACTIVE blue underline, "代码", "需求", "Bug", "PR", "产物与版本", "上下文". Use readable spacing, no crowded icons.
Under tabs a compact repo strip with branch icon and dropdown "main", latest short commit "a7c92e1", message "完善成员权限校验", relative time "20 分钟前". At right quiet link "3 个待审 PR". This is context, no large numeric metric tiles.
Main section "进行中的事项" with quiet "查看全部" at right. Toolbar small segmented "全部" active / "PRD" / "Bug", assignee filter "负责人". A table with columns "事项", "负责人", "业务进度", "代码关联". 5 rows, about 52px each:
PRD-024 "统一接口错误处理" / 林然 / 开发中 / "PR #42" SELECTED neutral gray with blue title.
BUG-018 "登录后权限未刷新" / 陈悦 / 修复中 / "PR #45".
PRD-026 "增加客户反馈入口" / 周宁 / 待提测 / "PR #39".
PRD-021 "完善项目成员管理" / 林然 / 测试中 / "PR #38".
BUG-015 "小程序反馈附件丢失" / 陈悦 / 待回归 / "PR #41".
Use tiny document/bug glyphs to identify types, modest neutral statuses with small colored semantic dots, readable clickable blue PR links. Show human avatars not robot faces.
Below with 28px separation a section "服务交付" and small right link "全部记录". Quiet table on continuous white surface with columns "服务", "最新构建产物", "测试环境运行版本", "生产环境运行版本". Two rows:
"Web" / "v0.4.2-build.18" with small "查看产物" link / "v0.4.2-build.17" with "访问环境" link / "v0.4.1".
"API" / "v0.3.6-build.08" with "查看产物" link / "v0.3.6-build.07" with "访问环境" link / "v0.3.5".
Versions MUST be distinct, latest artifacts are not deployed versions. This table is repository/service-level, not bound to an individual PRD. No build control buttons, no charts, no environment-edit form. Bottom subtle last synced line optional.

RIGHT task detail pane about 370px wide, white full height separated by a fine vertical line, no outer enclosing card:
Header "事项详情", expand and close outline icons.
Small gray "PRD-024"; medium heading "统一接口错误处理".
Tiny status control "开发中", simple two-column property rows "研发负责人" 林然, "协作成员" 陈悦, "所属项目" 研发协作平台, "仓库" team/dev-ops.
Description "统一接口错误响应与前端提示，保留现有状态码。"
Section "代码关联", Git branch icon "feat/error-handling", pull-request icon blue "#42 统一错误响应结构" with small "待审核", commit icon "a7c92e1". No code editor.
An understated outline action "标记提测" near current status or properties, not enormous blue card; it is a business action only. Do not add implementation warnings to product UI.
Tabs "讨论" active blue underline and "活动".
Compact human comment "林然" with "请补充兼容性说明，确认后交给测试。".
Compact project bot comment "项目助手" with small "Bot" marker: "已汇总关联 PR 与变更记录，可查看仓库交付信息。" This is information assistance only. No percentage, code-run steps, terminal, autonomous working status.
Bottom comfortable rounded message composer "补充说明，或 @ 项目助手…" plus paperclip and a small blue round send button.
Keep the whole screen legible, coherent and professionally composed. No fabricated claims of implementation. Exactly one screen, no explanatory text outside app.
