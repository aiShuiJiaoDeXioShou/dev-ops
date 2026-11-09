Use case: precise-object-edit. Produce ONE edited desktop UI screenshot using the attached existing v5 design as exact base. Preserve its full landscape aspect ratio, three-column boundaries, quiet DeepSeek-style white/light-gray surfaces, existing blue accent, typography, button geometry, spacing and right-hand detail design. Only apply requested navigation/default-page changes below. Do not create a new visual direction.

USER REQUEST: Merge repository and project into "项目"; delete overview; show requirements by default; rename Agent to lowercase "bots" and move it to the front.

1 LEFT NAV: Replace the existing separate "仓库" selected row and "项目" row with ONE selected "项目" row, using an outline folder icon, blue text/icon and the original neutral-gray selected background. Remove the redundant second row and close the gap. Keep "Bot" and "Skills" below as before, preserving their names. Keep DevOps brand, workspace "研发团队", settings and user 林然. No repo tree, no personal dashboard, no other sidebar groups.

2 CENTRAL PROJECT HEADER: Change top breadcrumb from "仓库 / team" to "项目 / team". Keep main title "dev-ops" and neutral "私有" badge. Use a simple project folder outline icon instead of the GitHub emblem beside this title. Replace subtitle with "GitHub · team/dev-ops  ·  关联服务：Web、API" so the project still has clear linked Git context. Keep outline "在 GitHub 查看" action. Change the blue primary action from "+ 新建事项" to "+ 新建需求".

3 TOP TABS: Completely delete "概览". Rename final "Agent" to EXACT lowercase "bots" and move it to the FIRST position in the tab strip. Final tab sequence MUST be exactly:
"bots"  "需求"  "代码"  "Bug"  "PR"  "产物与版本".
The DEFAULT ACTIVE tab is "需求", using the existing BLUE label and BLUE underline. "bots" is inactive dark gray, even though placed first. No overview, no context, no Agent tab.

4 CENTRAL PAGE DEFAULT REQUIREMENTS VIEW:
Keep the small Git branch/main and latest commit context strip below the tabs, quiet and compact.
Replace the overview section title "进行中的事项" with "需求" and a small quiet count "5".
Replace the old filter "全部 / PRD / Bug" with a requirements-state filter group "全部" selected, "开发中", "待提测", "测试中"; keep small assignee dropdown "负责人" and add a subtle search control "搜索需求".
The main content becomes ONE requirements list taking the central pane. Keep column style, spacing and selected-row appearance, with headers "需求", "负责人", "业务进度", "代码关联".
Display exactly 5 PRD rows, no BUG rows in default requirements page:
PRD-024 统一接口错误处理 / 林然 / 开发中 / PR #42 [selected row, gray background, title blue]
PRD-026 增加客户反馈入口 / 周宁 / 待提测 / PR #39
PRD-021 完善项目成员管理 / 林然 / 测试中 / PR #38
PRD-028 优化需求筛选 / 陈悦 / 开发中 / PR #46
PRD-029 补充测试交付说明 / 周宁 / 待开始 / —.
Use document outline icons, consistent row height about 50px and delicate separators. All owners are human, status labels are small with restrained blue/green/gray dots. Preserve exact sample task titles in clear Simplified Chinese.
Remove the overview's "服务交付" table from this default requirement view. The "产物与版本" tab remains its access point, don't add another table. Use quiet blank white space below the requirements list with no filler cards, stats, charts or large empty-state illustration. At the bottom show a subtle "共 5 项需求" and small "数据已同步 · 5 分钟前". No requirement detail should be hidden.

5 RIGHT DETAIL: Keep selected PRD-024 detail content, Git links, owner, collaborators, description, tabs and discussion/composer exactly as base. Change top header from "事项详情" to "需求详情". Keep "所属项目" property but value becomes "dev-ops", and retain "仓库" property value "team/dev-ops" because Git linkage remains relevant even after consolidating navigation. Keep "标记提测" button and current "开发中" status. Bot is only information assistance, not coding automation.

IMPORTANT: Left global "Bot" stays as the original; top repository/project-scoped new label is lowercase "bots" as user requested. Do not select bots, do not draw a bot catalog. Requirement tab is the default selected view. Do not insert annotations or explanation on the screenshot. No browser chrome, no new background tint, no marketing material, exactly ONE clean full app screen.
