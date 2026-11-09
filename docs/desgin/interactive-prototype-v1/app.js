import {icon} from './modules/icons.js?v=20261108-30';
import {createTeamWorkspace} from './workspace.js?v=20261108-30';
import {loadTeamContext,createTeamAdmin} from './modules/team.js?v=20261108-30';
import {createVault} from './modules/vault.js?v=20261108-30';
(() => {
  'use strict';
  const teamContext=loadTeamContext();
  const storageKey = teamContext.storageKey;
  const people = ['林然', '陈悦', '周宁', '许嘉'];
  const stages = ['待开始', '开发中', '待提测', '测试中', '修复中', '待回归', '已完成'];
  const projects = [
    { id: 'dev-ops', name: '研发协作平台', repo: 'team/dev-ops', provider: 'GitHub', services: ['Web', 'API'] },
    { id: 'mobile-app', name: '客户应用', repo: 'team/mobile-app', provider: 'Gitea', services: ['iOS', 'Android'] },
  ];
  /** 将演示文本转义为 HTML，避免讨论或标题被解析为代码。@param {unknown} value 文本。@returns {string} 安全文本。 */
  function esc(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
  /** 构造用于重置的独立示例记录。@returns {object} 初始数据；不访问远端。 */
  function seed() {
    const rows = [
      ['PRD-024', '统一接口错误处理', '林然', '开发中', '42'],
      ['PRD-026', '增加客户反馈入口', '周宁', '待提测', '39'],
      ['PRD-021', '完善项目成员管理', '林然', '测试中', '38'],
      ['PRD-028', '优化需求筛选', '陈悦', '开发中', '46'],
      ['PRD-029', '补充测试交付说明', '周宁', '待开始', ''],
      ['BUG-018', '登录后权限未刷新', '陈悦', '修复中', '45'],
      ['BUG-015', '客户反馈附件丢失', '周宁', '待回归', '41'],
    ].map(([id, title, owner, status, pr]) => ({ id, title, owner, status, pr, kind: id.startsWith('PRD') ? '需求' : 'Bug', project: 'dev-ops', collaborators: '陈悦', tester: status === '测试中' ? '许嘉' : '', description: id === 'PRD-024' ? '统一接口错误响应与前端提示，保留现有状态码。\n\n覆盖登录、项目管理与成员权限场景，补充兼容性说明及失败路径验证。' : `记录「${title}」的处理过程、验收说明与代码关联。`, branch: id === 'PRD-024' ? 'feat/error-handling' : 'feat/project-updates', external: '', comments: [{ author: '林然', text: '请补充兼容性说明，确认后交给测试。', time: '11月09日 14:20' }, { author: '项目助手', text: '已汇总关联 PR 与变更记录，可查看项目交付信息。', time: '11月09日 14:35', bot: true }], activity: ['示例记录：研发已关联代码变更。'] }));
    rows.push({ ...rows[0], id: 'PRD-008', title: '完善移动端登录体验', project: 'mobile-app', pr: '12', comments: [], activity: [] });
    return { version: 1, rows, skills: { '交付摘要': true, '需求梳理': true, '发布核对': false } };
  }
  let data = seed();
  let persistenceWarning = '';
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const parsed = JSON.parse(saved);
      const valid = parsed.version === 1 && Array.isArray(parsed.rows) && parsed.rows.every(row => ['id','title','owner','status','project','description','kind','branch','external','collaborators','tester','pr'].every(key => typeof row[key] === 'string') && Array.isArray(row.comments) && row.comments.every(comment => typeof comment.text === 'string' && typeof comment.author === 'string' && typeof comment.time === 'string') && Array.isArray(row.activity) && row.activity.every(item => typeof item === 'string')) && parsed.skills && ['交付摘要','需求梳理','发布核对'].every(key => typeof parsed.skills[key] === 'boolean');
      if (!valid) throw new Error('演示数据格式不兼容');
      data = parsed;
    }
  } catch (error) { persistenceWarning = '无法读取本地记录，已加载初始示例；修改可能仅在当前页面保留。'; console.warn('原型本地存储读取失败：', error.message); }
  let workspace,teamAdmin,vault;
  const state = { page: 'collaboration', project: 'dev-ops', tab: '需求', selected: null, detailTab: '讨论', filter: '全部', owner: '全部负责人', query: '', branch: 'main', file: 'README.md', expanded: false, role: teamContext.role, failure: false, menu: false, activeBot: '项目助手' };
  const app = document.getElementById('app');
  const modal = document.getElementById('modal');
  let toastTimer;
  let routeInitialized = false;
  let routeRestoring = false;
  /** 显示非阻塞反馈。@param {string} message 反馈文案。@returns {void} 更新提示区域。 */
  function toast(message) { const el = document.getElementById('toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 3200); }
  /** 保存演示数据；存储不可用时保留内存并显示提示。@returns {void} 仅写浏览器本地存储。 */
  function persist() { if (Array.isArray(state.threads)) data.conversations = {threads:state.threads,threadByProject:state.threadByProject}; try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch (error) { persistenceWarning = '本地存储不可用，本次修改仅在当前页面保留。'; toast(persistenceWarning); console.warn('原型本地存储写入失败：', error.message); } }
  /** 获取当前项目。@returns {object} 已知演示项目。 */
  function project() { return projects.find(item => item.id === state.project) || projects[0]; }
  /** 检查演示角色；只读模式拒绝写入。@returns {boolean} 是否允许修改。 */
  function editable() { if (state.role === '浏览者') { toast('浏览者为只读角色'); return false; } return true; }
  /** 输出表单选项。@param {string[]} values 选项。@param {string} selected 当前值。@returns {string} 选项标记。 */
  function options(values, selected) { return values.map(value => `<option ${value === selected ? 'selected' : ''}>${esc(value)}</option>`).join(''); }
  /** 输出业务状态标记。@param {string} value 状态。@returns {string} 状态标记。 */
  function status(value) { const color = ['开发中','待审核','进行中'].includes(value) ? 'blue' : ['测试中','已完成','已合并'].includes(value) ? 'green' : ['修复中','已暂停'].includes(value) ? 'amber' : ''; return `<span class="status"><span class="dot ${color}"></span>${esc(value)}</span>`; }
  /** 生成成员头像。@param {string} name 成员名。@returns {string} 头像标记。 */
  function avatar(name) { return `<span class="avatar">${esc(name.slice(0,1))}</span>`; }
  /** 输出通用操作按钮。@param {string} action 动作。@param {string} label 文案。@param {string} glyph 图标名。@param {string} cls 样式。@returns {string} 按钮标记。 */
  function button(action, label, glyph = '', cls = 'btn') { return `<button type="button" class="${cls}" data-action="${action}">${glyph ? icon(glyph) : ''}${label}</button>`; }
  /** 输出侧栏，保持项目入口与团队能力管理分离。@returns {string} 侧栏标记。 */
  function sidebar() { const active = ['Bot','Skills','memory','connections'].includes(state.page) ? 'Bot' : state.page === 'project' ? 'projects' : state.page; return `<aside class="sidebar"><div class="brand"><img src="assets/brand.svg?v=20261107-13" width="29" height="29" alt="">DevOps</div><nav class="nav" aria-label="主导航">${[['projects','项目','folder'],['collaboration','协作','bot-live'],['operations','运维','activity'],['Bot','能力','capabilities'],['vault','凭据库','lock']].map(([page,label,glyph]) => `<button class="nav-btn ${active === page ? 'active' : ''}" data-page="${page}">${icon(glyph)}${label}</button>`).join('')}</nav><div class="side-bottom"><div class="demo-mark"><span class="dot"></span>交互原型 · 本地演示</div>${state.role==='管理员'?'<button class="nav-btn" data-page="team-admin">'+icon('users')+'团队管理</button>':''}${button('settings','设置','settings','nav-btn')}<div class="user">${avatar('林然')}<span>林然</span><span class="spacer"></span><span class="badge">${state.role}</span></div>${teamAdmin.switcher()}</div></aside>`; }
  /** 输出项目头部与页签。@returns {string} 头部标记。 */
  function header() { const p = project(); return `<header class="project-header"><div class="breadcrumb">${button('menu','<span class="sr-only">展开导航</span>','menu','icon-btn mobile-menu')}<button data-page="projects" class="muted">项目</button><span>/</span><span>${esc(p.repo)}</span></div><div class="row spread"><div class="project-title">${icon('repo')}<select class="project-select" aria-label="当前项目" data-change="project">${projects.map(item => `<option value="${item.id}" ${item.id === p.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select><span class="badge">私有</span></div><div class="row header-actions">${button('remote',`在 ${p.provider} 查看 ${icon('external')}`,'','btn external')}${button('project-settings','<span class="sr-only">项目设置</span>','settings','icon-btn')}${['需求','Bug'].includes(state.tab) ? `<button class="btn primary" data-action="new" ${state.role === '浏览者' ? 'disabled' : ''}>${icon('plus')}新建${state.tab}</button>` : ''}</div></div><div class="tabs" role="tablist" aria-label="项目功能">${['需求','bots','代码','Bug','PR','流水线','产物与版本','环境变量'].map(tab => `<button class="tab" role="tab" aria-selected="${state.tab === tab}" data-tab="${tab}">${tab === 'bots' ? '协作' : tab}</button>`).join('')}</div></header>`; }
  /** 读取项目的独立示例 PR，关联事项的编辑不修改 PR 标题或状态。@param {string} projectId 项目标识，默认当前项目。@returns {object[]} PR 展示数据。 */
  function pullRequests(projectId = state.project) {
    if (Array.isArray(data.remotePrs)) return data.remotePrs.filter(pr => pr.project === projectId);
    const rows = data.rows.filter(row => row.project === projectId && row.pr);
    return [...new Map(rows.map(row => [row.pr,{id:row.pr,project:projectId,title:row.pr === '42' ? '统一错误响应结构' : row.title,author:row.owner,branch:row.branch,status:['38','41'].includes(row.pr) ? '已合并' : row.pr === '46' ? '草稿' : '待审核'}])).values()];
  }
  /** 输出仓库摘要，分支只影响代码视图。@returns {string} 摘要标记。 */
  function gitStrip() { return `<div class="git-strip">${icon('branch')}<select aria-label="代码分支" data-change="branch">${options([...new Set(['main',...data.rows.filter(r => r.project === state.project).map(r => r.branch),...(data.workspace?.codeChanges||[]).filter(change=>change.project===state.project).map(change=>change.branch)])],state.branch)}</select><span class="divider"></span>${icon('commit')}<button class="text-btn" data-action="commit">${state.branch === 'main' ? 'a7c92e1' : 'b8d304f'}</button><span class="commit-message">${state.branch === 'main' ? '完善成员权限校验' : '统一错误响应结构'}</span><span class="git-time quiet">20 分钟前</span><span class="spacer"></span><button class="text-btn row" data-tab="PR">${icon('pr')}${pullRequests().filter(pr => pr.status === '待审核').length} 个待审 PR</button></div>`; }
  /** 返回当前筛选对应的事项。@returns {object[]} 筛选结果，不修改源数据。 */
  function filteredRows() { return data.rows.filter(row => row.project === state.project && row.kind === state.tab && (state.filter === '全部' || state.filter === '未完成' && row.status !== '已完成' || state.filter === '进行中' && row.status !== '已完成' && row.status !== '待开始' || state.filter === row.status) && (state.owner === '全部负责人' || row.owner === state.owner) && `${row.id} ${row.title}`.toLowerCase().includes(state.query.toLowerCase())); }
  /** 输出需求与 Bug 列表；演示业务状态与外部状态分别展示。@returns {string} 列表标记。 */
  function itemsPage() { const rows = filteredRows(); return `<div class="section-heading"><h2>${state.tab === 'Bug' ? '项目 Bug' : '需求列表'}</h2><span class="counter">${data.rows.filter(row => row.project === state.project && row.kind === state.tab).length}</span></div><div class="filters"><div class="segments">${['全部','未完成','进行中','已完成'].map(value => `<button class="segment ${state.filter === value ? 'active' : ''}" data-filter="${value}">${value}</button>`).join('')}</div><select class="filter-select" aria-label="负责人筛选" data-change="owner">${options(['全部负责人',...people],state.owner)}</select><label class="search">${icon('search')}<input id="item-search" aria-label="搜索事项" placeholder="搜索标题或编号" value="${esc(state.query)}"></label></div>${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>事项</th><th>负责人</th><th>业务进度</th><th>代码关联</th></tr></thead><tbody>${rows.map(row => `<tr class="${state.selected === row.id ? 'selected' : ''}"><td><div class="item-cell">${icon(row.kind === 'Bug' ? 'bug' : 'file')}<button class="item-title" data-item="${row.id}"><span class="item-id">${row.id}</span>${esc(row.title)}</button></div></td><td><span class="row">${avatar(row.owner)}${row.owner}</span></td><td>${status(row.status)}</td><td>${row.pr ? `<button class="text-btn" data-pr="${row.pr}">PR #${row.pr}</button>` : '<span class="quiet">—</span>'}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${icon('search')}<h3>${data.rows.some(r => r.project === state.project && r.kind === state.tab) ? '没有符合条件的事项' : `还没有${state.tab}`}</h3><p>${data.rows.some(r => r.project === state.project && r.kind === state.tab) ? '试试其他关键词或负责人。' : '创建第一条事项，开始记录目标与进展。'}</p>${data.rows.some(r => r.project === state.project && r.kind === state.tab) ? button('clear','清除筛选') : state.role === '浏览者' ? '<span class="badge">浏览者只读</span>' : button('new',`新建${state.tab}`,'plus','btn primary')}</div>`}`; }
  /** 输出示例文件内容，分支切换有独立可见结果。@returns {string} 文件纯文本。 */
  function fileContent() { const change=data.workspace?.codeChanges?.find(item=>item.project===state.project&&item.branch===state.branch&&item.path===state.file);if(change)return change.content;const files = { 'README.md': `# ${project().name}\n\n以 Git 仓库为核心的项目协作平台。\n\n## 本地开发\n\npnpm install\npnpm dev\n\n## 目录\n\napps/web    Web 前端\nserver      后端 API\ndocs/prd    产品需求\n\n当前分支：${state.branch}\n\n此内容是原型示例，不是从远端读取的真实代码。`, 'src/api.ts': state.branch === 'main' ? '// 示例：当前主分支的响应定义\nexport interface ApiResponse {\n  success: boolean;\n  message: string;\n}\n' : '// 示例：统一错误响应的开发分支\nexport interface ApiError {\n  code: string;\n  message: string;\n  requestId: string;\n}\n', 'docs/prd/mvp.md': '# MVP 需求（演示摘要）\n\n- 项目关联已有 GitHub / Gitea 仓库\n- 默认进入协作，群组和任务共享项目上下文\n- 业务提测与构建流水线独立\n- 构建产物不代表环境运行版本\n\n完整规范以项目 docs/prd/mvp.md 为准。', 'package.json': '{\n  "name": "dev-ops-demo",\n  "private": true,\n  "description": "仅用于界面原型的示例文件"\n}' }; return files[state.file]; }
  /** 输出只读文件浏览器与可恢复错误态。@returns {string} 代码页标记。 */
  function codePage() { if (state.project.startsWith('project-')) return `<div class="empty">${icon('repo')}<h3>等待代码平台接入</h3><p>关联关系已保存，原型中还没有这个仓库的文件数据。</p>${button('project-settings','查看关联设置')}</div>`; if (state.failure) return `<div class="empty">${icon('repo')}<h3>暂时无法读取仓库</h3><p>模拟连接失败，现有业务记录仍然保留。</p>${button('retry','重试读取','refresh')}</div>`; return `<div class="section-heading"><h2>代码</h2><span class="badge">只读</span><span class="spacer"></span><span class="small quiet">${project().provider} · ${esc(state.branch)}</span></div><div class="file-browser"><nav class="file-tree" aria-label="文件目录">${['README.md','src/api.ts','docs/prd/mvp.md','package.json'].map(file => `<button class="file ${state.file === file ? 'active' : ''}" data-file="${file}">${icon('file')}${file}</button>`).join('')}</nav><section style="min-width:0"><div class="file-head"><span>${state.file}</span><span class="row"><button class="text-btn" data-action="copy-file">复制内容</button><button class="text-btn" data-action="download-file">下载文件</button></span></div><pre class="code"><code>${esc(fileContent())}</code></pre></section></div>`; }
  /** 输出 PR 列表，只提供查看能力。@returns {string} 列表标记。 */
  function prPage() {
    if (state.failure) return `<div class="empty">${icon('pr')}<h3>暂时无法读取 PR</h3><p>代码平台连接异常，平台事项仍然保留。</p>${button('retry','重试读取','refresh')}</div>`;
    const all = pullRequests(), records = all.filter(pr => (state.prFilter === '全部' || pr.status === state.prFilter) && `${pr.id} ${pr.title} ${pr.author}`.toLowerCase().includes(state.prQuery.toLowerCase()));
    return `<div class="section-heading"><h2>Pull Requests</h2><span class="counter">${all.length}</span></div><div class="filters"><select class="btn" aria-label="PR 状态" data-change="prFilter">${options(['全部','待审核','草稿','已合并'],state.prFilter)}</select><label class="search">${icon('search')}<input id="pr-search" aria-label="搜索 PR" placeholder="搜索编号、标题或作者" value="${esc(state.prQuery)}"></label></div>${records.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>标题</th><th>作者</th><th>远端状态</th><th>目标分支</th></tr></thead><tbody>${records.map(pr => `<tr><td><button class="item-title" data-pr="${pr.id}"><span class="item-id">#${pr.id}</span>${esc(pr.title)}</button></td><td>${esc(pr.author)}</td><td>${status(pr.status)}</td><td>${esc(pr.targetBranch||'main')}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${icon('pr')}<h3>${all.length ? '没有匹配的 PR' : '还没有关联 PR'}</h3><p>${all.length ? '调整状态或关键词后重试。' : '关联代码平台的 PR 后在这里查看。'}</p>${all.length ? button('clear-prs','清除筛选') : ''}</div>`}`;
  }
  /** 获取服务交付展示值，环境版本与运维核对结果共用记录。@param {string} service 服务名称。@returns {object} 构建、测试与生产版本；未接入的服务使用既有示例值。 */
  function serviceVersions(service) {
    const index=project().services.indexOf(service), records=data.workspace?.services||[];
    return {artifact:`v0.${index+4}.2-build.18`,test:records.find(item=>item.project===state.project&&item.name===service&&item.environment==='测试')?.version||`v0.${index+4}.2-build.17`,production:records.find(item=>item.project===state.project&&item.name===service&&item.environment==='生产')?.version||`v0.${index+4}.1`};
  }
  /** 输出最新产物与环境版本，部署核对不会伪造构建记录。@returns {string} 产物页标记。 */
  function artifactsPage() { if (!project().services.length) return `<div class="empty">${icon('box')}<h3>还没有服务与产物</h3><p>项目尚未收到构建或环境版本信息。</p>${button('project-settings','查看项目设置')}</div>`; return `<div class="section-heading"><h2>服务交付</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>服务</th><th>最新构建产物</th><th>测试环境运行版本</th><th>生产环境运行版本</th></tr></thead><tbody>${project().services.map(service => `<tr><td><span class="row">${icon('box')}${service}</span></td><td>${esc(serviceVersions(service).artifact)}<br><button class="text-btn" data-artifact="${service}">查看产物</button></td><td>${esc(serviceVersions(service).test)}<br><button class="text-btn" data-environment="${service}">查看环境信息</button></td><td>${esc(serviceVersions(service).production)}</td></tr>`).join('')}</tbody></table></div>`; }
  /** 生成团队技能目录的默认数据。@returns {object[]} 独立的演示技能记录。 */
  function defaultLibrary() {
    return [
      ['requirements','需求梳理','产品','将需求整理成目标、验收标准与待确认事项。','梳理背景与目标；列出验收标准；标注尚未确认的问题。','1.2.0'],
      ['pr-review','PR 审阅','研发','结合变更文件，整理评审重点与验证建议。','读取指定 PR 的变更；归纳影响范围；提出需要验证的边界条件。','1.1.0'],
      ['release-summary','交付摘要','交付','核对构建产物与环境版本，准备测试交接。','区分构建产物与运行版本；整理差异；输出测试交接要点。','1.0.2'],
      ['bug-triage','Bug 分析','研发','整理复现步骤、影响范围与关联事项。','读取指定 Bug；归纳复现条件；标注缺失信息；建议验证步骤。','1.0.0'],
      ['api-contract','接口核对','研发','检查接口约定、错误码与兼容性说明。','核对请求和响应契约；识别不兼容变化；输出需补充的说明。','1.0.0'],
      ['release-check','发布核对','交付','核对版本与人工放行信息。','核对产物版本、目标环境和人工放行信息；不执行部署或发布。','0.9.0'],
    ].map(([id,name,category,description,instructions,version]) => ({id,name,category,description,instructions,version,source:'团队维护',enabled:id !== 'release-check'}));
  }
  let agentTemplates = [
    {id:'team-default',name:'团队通用',tag:'通用',description:'适合日常项目协作，统一沟通、权限与交付边界。',content:'# AGENTS.md\n\n## 协作约定\n- 使用中文沟通，明确事实与待确认事项。\n- 通过 @ 引用仓库、文件与 PR，避免猜测上下文。\n- 优先调用团队已启用的 Skills。\n\n## 工作边界\n- 保留他人尚未完成的修改。\n- 提测状态不触发流水线。\n- 发布前遵循团队人工放行流程。'},
    {id:'web-team',name:'Web 研发',tag:'React / TypeScript',description:'前端项目的类型约束、组件职责与验证要求。',content:'# AGENTS.md\n\n## Web 研发约定\n- 使用 TypeScript，保持类型准确。\n- 组件聚焦展示与交互，避免重复状态。\n- 遵循项目已有样式和可访问性规范。\n- 修改后运行项目约定的检查和构建。\n\n## 协作\n- 通过 @ 引用文件、需求与 PR。\n- 仅调用团队已启用的 Skills。'},
    {id:'service-team',name:'服务端研发',tag:'API / 数据库',description:'接口契约、权限校验、数据一致性与迁移约定。',content:'# AGENTS.md\n\n## 服务端研发约定\n- 在服务端校验身份、资源归属和权限。\n- 外部输入必须校验，外部调用必须设置超时。\n- 数据库变更使用版本化迁移。\n- 不向客户端暴露凭据、SQL 或内部堆栈。\n\n## 验证\n- 覆盖权限、失败路径和并发边界。\n- 使用团队 Skills 辅助核对接口契约。'},
  ];
  // 扩展原型数据时保留已有事项与旧版技能开关，不覆盖用户的本地修改。
  const libraryValid = Array.isArray(data.library) && data.library.every(skill => ['id','name','category','description','instructions','version','source'].every(key => typeof skill[key] === 'string') && /^[a-z0-9-]+$/.test(skill.id) && typeof skill.enabled === 'boolean');
  if (!libraryValid) {
    data.library = defaultLibrary();
    const legacyNames = {'requirements':'需求梳理','release-summary':'交付摘要','release-check':'发布核对'};
    data.library.forEach(skill => { if (legacyNames[skill.id]) skill.enabled = data.skills[legacyNames[skill.id]]; });
  }
  if (!data.projectTemplates || typeof data.projectTemplates !== 'object' || Array.isArray(data.projectTemplates)) data.projectTemplates = {};
  Object.assign(state, { skillTab:'技能库', skillCategory:'全部', skillQuery:'', threads:[], threadByProject:{}, mentionQuery:null, mentionCategory:'全部', mentionIndex:0, chatError:'' });

  /** 初始团队智能体；状态和运行环境均为演示数据。@returns {object[]} 智能体定义。 */
  function defaultBots() {
    return [
      {id:'product',name:'小李',role:'产品助手',owner:'林然',mark:'orbit',scope:'team',enabled:true,runtime:'团队执行器',online:true,model:'DeepSeek',instructions:'梳理需求、验收标准与待确认问题，帮助团队明确工作范围。',skills:['requirements','bug-triage'],lastActive:'刚刚'},
      {id:'engineer',name:'小林',role:'研发助手',owner:'林然',mark:'prism',scope:'team',enabled:true,runtime:'团队执行器',online:true,model:'默认模型',instructions:'结合代码和 PR 整理评审重点，检查接口约定与验证边界。',skills:['pr-review','api-contract','bug-triage'],lastActive:'12 分钟前'},
      {id:'delivery',name:'小渡',role:'交付助手',owner:'陈悦',mark:'signal',scope:'team',enabled:true,runtime:'本地节点',online:false,model:'默认模型',instructions:'核对构建产物与环境版本，整理测试交接，不执行部署和发布。',skills:['release-summary','release-check'],lastActive:'2 小时前'},
      {id:'mobile',name:'星野',role:'移动端助手',owner:'周宁',mark:'aperture',scope:'mobile-app',enabled:true,runtime:'团队执行器',online:true,model:'默认模型',instructions:'整理移动端需求、问题复现步骤与测试范围。',skills:['requirements','bug-triage'],lastActive:'昨天'},
    ];
  }
  /** 初始项目绑定，只在绑定层保存项目差异。@returns {object[]} 项目绑定记录。 */
  function defaultBindings() { return [{botId:'product',projectId:'dev-ops',enabled:true,repoAccess:true,skills:['requirements','bug-triage'],notes:''},{botId:'engineer',projectId:'dev-ops',enabled:true,repoAccess:true,skills:['pr-review','api-contract','bug-triage'],notes:''},{botId:'delivery',projectId:'dev-ops',enabled:true,repoAccess:true,skills:['release-summary'],notes:''},{botId:'product',projectId:'mobile-app',enabled:true,repoAccess:true,skills:['requirements','bug-triage'],notes:''},{botId:'mobile',projectId:'mobile-app',enabled:true,repoAccess:true,skills:['requirements','bug-triage'],notes:''}]; }
  const botDataValid = Array.isArray(data.bots) && data.bots.every(bot => ['id','name','role','owner','mark','scope','runtime','model','instructions','lastActive'].every(key => typeof bot[key] === 'string') && typeof bot.enabled === 'boolean' && typeof bot.online === 'boolean' && Array.isArray(bot.skills) && bot.skills.every(id => typeof id === 'string'));
  if (!botDataValid) data.bots = defaultBots();
  if (!Array.isArray(data.bindings) || !data.bindings.every(binding => typeof binding.botId === 'string' && typeof binding.projectId === 'string' && typeof binding.enabled === 'boolean' && typeof binding.repoAccess === 'boolean' && typeof binding.notes === 'string' && Array.isArray(binding.skills) && binding.skills.every(id => typeof id === 'string'))) data.bindings = defaultBindings();
  if (!Array.isArray(data.botRuns) || !data.botRuns.every(run => ['botId','projectId','title','time','result'].every(key => typeof run[key] === 'string'))) data.botRuns = [{botId:'product',projectId:'dev-ops',title:'整理本轮需求与待确认事项',time:'今天 09:42',result:'已完成'},{botId:'engineer',projectId:'dev-ops',title:'核对 PR #42 的兼容性说明',time:'今天 09:30',result:'已完成'},{botId:'delivery',projectId:'dev-ops',title:'汇总测试环境运行版本',time:'昨天 18:10',result:'运行环境离线'}];
  Object.assign(state,{activeBot:'product',botFilter:'全部智能体',botQuery:'',rosterQuery:'',botDetail:null,botDetailTab:'配置',rosterOpen:false});

  /** 获取当前项目已绑定的智能体，包括停用项以便查看历史。@returns {object[]} 智能体列表。 */
  function projectBots() { return data.bots.filter(bot => data.bindings.some(binding => binding.botId === bot.id && binding.projectId === state.project)); }
  /** 取得当前选中智能体，切换项目时选择该项目的第一个。@returns {object|undefined} 无绑定时返回空。 */
  function currentBot() { const bots = projectBots(); let bot = bots.find(item => item.id === state.activeBot); if (!bot) { bot = bots[0]; state.activeBot = bot?.id || ''; } return bot; }
  /** 获取指定 Bot 的当前项目绑定。@param {string} id 智能体标识。@returns {object|undefined} 绑定。 */
  function bindingFor(id) { return data.bindings.find(binding => binding.botId === id && binding.projectId === state.project); }
  /** 绘制智能体角色头像；未停用角色呼吸与眨眼，动效不代表环境在线。@param {object} bot 智能体。@param {string} size 尺寸样式。@returns {string} 本地 SVG 头像。 */
  function botAvatar(bot,size = '') { const mark = ['orbit','prism','signal','aperture'].includes(bot?.mark) ? bot.mark : 'orbit'; return `<img class="bot-avatar ${size}" src="assets/bot-${mark}${bot?.enabled !== false ? '-live' : ''}.svg?v=20261107-11" alt="" width="40" height="40">`; }
  /** 返回可读状态，区分全局停用与运行环境不可用。@param {object} bot 智能体。@param {boolean} projectScope 是否包含项目状态。@returns {string} 状态。 */
  function botStatus(bot,projectScope = false) { if (!bot.enabled) return '已停用'; if (projectScope && !bindingFor(bot.id)?.enabled) return '项目已停用'; if (!bot.online) return '环境离线'; return '可用'; }
  /** 输出简洁状态标识。@param {object} bot 智能体。@param {boolean} projectScope 是否包含项目状态。@returns {string} 状态标记。 */
  function botStatusLabel(bot,projectScope = false) { const label = botStatus(bot,projectScope); return `<span class="bot-status"><span class="dot ${label === '可用' ? 'green' : ''}"></span>${label}</span>`; }
  /** 判断当前会话是否可以发送。@returns {boolean} 根据演示角色、绑定及可用状态限制。 */
  function canChat() { const bot = currentBot(); return state.role !== '浏览者' && !!bot && botStatus(bot,true) === '可用'; }
  /** 获取当前智能体可用的项目技能。@returns {object[]} 同时满足团队、Bot 和项目配置的技能。 */
  function availableSkills() { const bot = currentBot(), binding = bot && bindingFor(bot.id); return data.library.filter(skill => skill.enabled && bot?.skills.includes(skill.id) && binding?.skills.includes(skill.id)); }
  /** 为会话创建项目和智能体联合键。@returns {string} 联合键。 */
  function threadKey() { return `${state.project}:${currentBot()?.id || ''}`; }
  /** 选择项目智能体，保留各自草稿与对话。@param {string} id 智能体标识。@returns {void} 切换工作区。 */
  function selectBot(id) { workspace?.openBot(state.project,id); state.activeBot = id; state.mentionQuery = null; state.chatError = ''; state.rosterOpen = false; render(); }
  /** 全局智能体表格，配置与项目使用共享同一记录。@returns {string} 管理页面。 */
  function botsCatalog() {
    const bots = data.bots.filter(bot => (state.botFilter !== '我负责的' || bot.owner === '林然') && `${bot.name} ${bot.role} ${bot.owner}`.toLowerCase().includes(state.botQuery.toLowerCase()));
    return `<header class="agent-page-header"><div class="row">${button('menu','<span class="sr-only">展开导航</span>','menu','icon-btn mobile-menu')}<h1 class="sr-only">智能体</h1></div><div class="agent-filters"><div class="tabs" role="tablist" aria-label="智能体筛选">${['全部智能体','我负责的'].map(filter => `<button class="tab" role="tab" aria-selected="${state.botFilter === filter}" data-bot-filter="${filter}">${filter}</button>`).join('')}</div><label class="search">${icon('search')}<input id="bot-search" aria-label="搜索智能体" placeholder="搜索名称、职责或负责人" value="${esc(state.botQuery)}"></label><button class="btn primary new-agent-btn" data-action="new-bot" ${state.role === '浏览者' ? 'disabled' : ''}>${icon('plus')}创建智能体</button></div></header><div class="agent-catalog"><div class="table-wrap"><table class="table agent-table"><thead><tr><th>智能体</th><th>状态</th><th>使用范围</th><th>运行环境</th><th>模型</th><th>最近活跃</th><th><span class="sr-only">操作</span></th></tr></thead><tbody>${bots.map(bot => `<tr class="${state.botDetail === bot.id ? 'selected' : ''}"><td><button class="agent-name" data-bot-detail="${esc(bot.id)}">${botAvatar(bot)}<span><strong>${esc(bot.name)}</strong><small>${esc(bot.role)}<span> · ${esc(bot.owner)}</span></small></span></button></td><td>${botStatusLabel(bot)}</td><td><span class="scope-tag">${icon(bot.scope === 'team' ? 'users' : 'folder')}${'独立 Bot'}</span></td><td><span class="runtime-cell">${icon('terminal')}${esc(bot.runtime)}</span></td><td><span class="muted small">${esc(bot.model)}</span></td><td><span class="quiet small">${esc(bot.lastActive)}</span></td><td><button class="icon-btn" aria-label="管理${esc(bot.name)}" data-bot-detail="${esc(bot.id)}">${icon('more')}</button></td></tr>`).join('')}</tbody></table></div>${bots.length ? '' : `<div class="empty">${icon('search')}<h3>没有找到智能体</h3><p>试试其他名称或负责人。</p>${button('clear-bots','清除筛选')}</div>`}</div>`;
  }
  /** 全局 Bot 详情，项目差异配置由项目绑定承担。@returns {string} 详情侧栏。 */
  function botDetails() {
    if (state.page !== 'Bot' || !state.botDetail) return '';
    const bot = data.bots.find(item => item.id === state.botDetail); if (!bot) return '';
    const bindings = data.bindings.filter(binding => binding.botId === bot.id), runs = data.botRuns.filter(run => run.botId === bot.id);
    let body = '';
    if (state.botDetailTab === '配置') body = `<p class="agent-purpose">${esc(bot.instructions)}</p><dl class="properties"><dt>${icon('user')}负责人</dt><dd>${esc(bot.owner)}</dd><dt>${icon('terminal')}运行环境</dt><dd>${esc(bot.runtime)}</dd><dt>${icon('model')}模型</dt><dd>${esc(bot.model)}</dd><dt>${icon('shield')}使用范围</dt><dd>${'独立 Bot'}</dd></dl><div class="agent-section"><h3>可用 Skills <span class="counter">${bot.skills.length}</span></h3><div class="agent-skills">${bot.skills.map(id => {const skill = data.library.find(item => item.id === id);return skill ? `<button data-skill-detail="${esc(id)}">${icon('skill')}<span>${esc(skill.name)}</span><span class="quiet">${skill.enabled ? '↗' : '已停用'}</span></button>` : '';}).join('') || '<p class="quiet small">尚未配置技能</p>'}</div></div><div class="agent-section"><h3>工具权限</h3><div class="tool-pills"><span>${icon('repo')}读取项目资源</span><span>${icon('chat')}项目协作</span></div></div>`;
    if (state.botDetailTab === '项目') body = `<div class="row" style="margin-bottom:20px"><span class="small muted">项目授权</span><span class="spacer"></span><button class="btn" data-work="tool-grants" data-id="${bot.id}" ${state.role === '浏览者' ? 'disabled' : ''}>${icon('plus')}项目能力授权</button></div><div class="binding-list">${bindings.map(binding => {const p = projects.find(item => item.id === binding.projectId);return `<div class="binding-card"><div class="row">${icon('folder')}<strong>${esc(p?.name || binding.projectId)}</strong><span class="spacer"></span><span class="badge">${binding.enabled ? '已授权' : '已停用'}</span></div><p>${esc(p?.repo || '')}</p><button class="text-btn" data-open-agent="${esc(bot.id)}" data-agent-project="${binding.projectId}">进入项目对话 ${icon('arrow')}</button></div>`;}).join('') || '<div class="empty"><p>还没有关联项目</p></div>'}</div>`;
    if (state.botDetailTab === '运行记录') body = `<div class="run-list">${runs.map(run => `<article><div class="row">${icon(run.result === '已完成' ? 'check' : 'clock')}<strong>${esc(run.title)}</strong></div><p>${esc(projects.find(p => p.id === run.projectId)?.name || run.projectId)} · ${esc(run.time)}</p><span class="badge ${run.result === '已完成' ? 'green' : ''}">${esc(run.result)}</span></article>`).join('') || '<div class="empty"><p>还没有运行记录</p></div>'}</div>`;
    return `<aside class="details agent-details" aria-label="智能体详情"><div class="detail-top"><h2>智能体详情</h2><span class="spacer"></span>${button('close-bot-detail','<span class="sr-only">关闭智能体详情</span>','close','icon-btn')}</div><div class="agent-profile">${botAvatar(bot,'large')}<div><h2>${esc(bot.name)}</h2><p>${esc(bot.role)}</p></div><span class="spacer"></span>${botStatusLabel(bot)}</div><div class="agent-detail-tabs tabs" role="tablist" aria-label="智能体详情内容">${['配置','项目','运行记录'].map(tab => `<button class="tab" role="tab" aria-selected="${state.botDetailTab === tab}" data-agent-detail-tab="${tab}">${tab}</button>`).join('')}</div><div class="detail-scroll">${body}</div><div class="agent-detail-actions"><button class="btn" data-edit-bot="${esc(bot.id)}" ${state.role === '浏览者' ? 'disabled' : ''}>${icon('edit')}编辑配置</button><button class="icon-btn" title="${bot.enabled ? '全局停用' : '全局启用'}" aria-label="${bot.enabled ? '全局停用' : '全局启用'}" data-toggle-bot="${esc(bot.id)}" ${state.role === '浏览者' ? 'disabled' : ''}>${icon(bot.enabled ? 'pause' : 'check')}</button><span class="spacer"></span><button class="btn primary" data-global-chat="${esc(bot.id)}">打开对话</button></div></aside>`;
  }
  /** 生成技能选择项；仅从现有技能库选择。@param {string[]} ids 已选标识。@param {string[]} allowed 允许选择的标识。@returns {string} 多选项。 */
  function skillChoices(ids,allowed = data.library.map(skill => skill.id)) { return `<div class="skill-checkboxes">${data.library.filter(skill => allowed.includes(skill.id)).map(skill => `<label><input type="checkbox" name="skills" value="${esc(skill.id)}" ${ids.includes(skill.id) ? 'checked' : ''}>${icon('skill')}<span>${esc(skill.name)}</span>${!skill.enabled ? '<small>已停用</small>' : ''}</label>`).join('') || '<p class="small quiet">该 Bot 尚未配置技能</p>'}</div>`; }
  /** 新建或编辑独立 Bot 定义；项目能力单独授权。@param {string} id 可选 Bot 标识。@param {boolean} scoped 是否从项目入口新建，不决定 Bot 归属。@returns {void} 显示配置表单。 */
  function editBot(id = '',scoped = false) {
    if (!editable()) return;
    const bot = data.bots.find(item => item.id === id);
    dialog(bot ? '编辑智能体' : '创建智能体',`<form id="bot-form" data-edit-id="${esc(id)}" data-scoped="${scoped}"><div class="avatar-choices">${['orbit','prism','signal','aperture'].map(mark => `<label><input type="radio" name="mark" aria-label="${({orbit:'珊瑚小团子',prism:'薄荷小豆',signal:'暖黄小芽',aperture:'紫色小星'})[mark]}" value="${mark}" ${(bot?.mark || 'orbit') === mark ? 'checked' : ''}>${botAvatar({mark})}</label>`).join('')}</div><div class="form-grid"><label class="field">名称<input name="name" required maxlength="20" value="${esc(bot?.name || '')}" placeholder="给你的协作者起个名字"></label><label class="field">职责<input name="role" required maxlength="30" value="${esc(bot?.role || '')}" placeholder="例如：产品助手"></label><label class="field">负责人<select name="owner">${options(people,bot?.owner || '林然')}</select></label><label class="field">运行环境<select name="runtime">${options(['团队执行器','本地节点'],bot?.runtime || '团队执行器')}</select></label><label class="field">模型<select name="model">${options(['默认模型','DeepSeek'],bot?.model || '默认模型')}</select></label><label class="field full">职责说明<textarea name="instructions" required maxlength="2000" placeholder="描述长期职责、工作方式与输出要求">${esc(bot?.instructions || '')}</textarea></label><div class="field full"><span>允许使用的 Skills</span>${skillChoices(bot?.skills || ['requirements'])}</div></div><div class="field-error" role="alert"></div><div class="form-actions">${button('close-modal','取消')}<button class="btn primary">${bot ? '保存配置' : '创建智能体'}</button></div></form>`);
  }
  /** 向当前项目加入已有智能体。@returns {void} 展示可复用目录。 */
  function addProjectBot() {
    if (!editable()) return;
    const bots = data.bots.filter(bot => bot.scope === 'team' || bot.scope === state.project);
    dialog('添加项目智能体',`<div class="add-agent-list">${bots.map(bot => `<div class="row">${botAvatar(bot)}<div><strong>${esc(bot.name)}</strong><p>${esc(bot.role)}</p></div><span class="spacer"></span><button class="btn" data-bind-bot="${esc(bot.id)}" ${bindingFor(bot.id) || !bot.enabled ? 'disabled' : ''}>${bindingFor(bot.id) ? '已加入' : !bot.enabled ? '已停用' : '添加'}</button></div>`).join('')}</div><div class="form-actions"><button class="text-btn" data-action="new-project-bot">${icon('plus')}创建 Bot</button></div>`);
  }
  /** 展示项目绑定配置，避免覆盖全局职责。@returns {void} 打开项目配置表单。 */
  function projectBotSettings() {
    const bot = currentBot(), binding = bot && bindingFor(bot.id); if (!binding) return;
    dialog(`${bot.name} · 项目配置`,`<form id="binding-form"><div class="row binding-profile">${botAvatar(bot)}<div><strong>${esc(bot.name)}</strong><p class="small muted">${esc(bot.role)} · ${esc(project().name)}</p></div><span class="spacer"></span><button type="button" class="text-btn" data-bot-global="${bot.id}">全局配置 ↗</button></div><div class="settings-row"><div><strong>在本项目启用</strong></div><input type="checkbox" class="switch" name="enabled" ${binding.enabled ? 'checked' : ''} ${state.role === '浏览者' ? 'disabled' : ''}></div><div class="settings-row"><div><strong>允许读取关联仓库</strong><p>${esc(project().repo)}</p></div><input type="checkbox" class="switch" name="repoAccess" ${binding.repoAccess ? 'checked' : ''} ${state.role === '浏览者' ? 'disabled' : ''}></div><div class="settings-row"><div><strong>协作模板</strong><p>来自项目的 AGENTS.md 模板</p></div><button type="button" class="text-btn" data-template="${selectedTemplate().id}">${esc(selectedTemplate().name)}</button></div><div class="field" style="margin-top:20px"><span>项目可用 Skills</span>${skillChoices(binding.skills,bot.skills)}</div><label class="field" style="margin-top:20px">项目补充约定<textarea name="notes" maxlength="2000" ${state.role === '浏览者' ? 'readonly' : ''}>${esc(binding.notes)}</textarea></label><div class="form-actions"><button type="button" class="text-btn" data-unbind-bot="${bot.id}" ${state.role === '浏览者' ? 'disabled' : ''}>从项目移除</button><span class="spacer"></span><button class="btn primary" ${state.role === '浏览者' ? 'disabled' : ''}>保存项目配置</button></div></form>`);
  }
  /** 打开独立 Bot 会话，无需关联项目。@param {string} id 智能体标识。@returns {void} 进入协作并保留原有历史。 */
  function globalChat(id) {
    if(!data.bots.some(bot=>bot.id===id))return;
    modal.close();workspace.openBot('',id);state.page='collaboration';state.botDetail=null;state.selected=null;persist();render();
  }

  /** 返回当前项目会话，不存在时创建空会话。@returns {object} 页面会话，仅保留在内存中。 */
  function conversation() {
    const key = threadKey();
    let thread = state.threads.find(item => item.id === state.threadByProject[key]);
    if (!thread) {
      thread = {id:`chat-${state.threads.length+1}`,project:state.project,botId:currentBot()?.id || '',title:'新对话',messages:[],draft:''};
      state.threads.push(thread); state.threadByProject[key] = thread.id;
    }
    return thread;
  }
  /** 获取项目选用的模板。@returns {object} 模板记录；未知值回退为团队通用。 */
  function selectedTemplate() { return agentTemplates.find(item => item.id === data.projectTemplates[state.project]) || agentTemplates[0]; }
  /** 构建当前项目可引用的资源，不暴露其他项目的仓库内容。@returns {object[]} 引用候选。 */
  function references() {
    const repoAccess = bindingFor(currentBot()?.id)?.repoAccess;
    return [
      ...(repoAccess ? [
      {token:`@repo/${project().repo}`,name:project().repo,type:'仓库',icon:'repo',description:project().provider},
      ...(state.project.startsWith('project-') ? [] : ['README.md','src/api.ts','docs/prd/mvp.md']).map(path => ({token:`@file/${path}`,name:path,type:'文件',icon:'file',description:project().repo})),
      ...pullRequests().map(pr => ({token:`@pr/${pr.id}`,name:`#${pr.id} ${pr.title}`,type:'PR',icon:'pr',description:pr.status})),
      ] : []),
      ...data.rows.filter(row => row.project === state.project).map(row => ({token:`@${row.id}`,name:`${row.id} ${row.title}`,type:'事项',icon:row.kind === 'Bug' ? 'bug' : 'file',description:row.status})),
      ...projectBots().filter(bot => bot.enabled && bindingFor(bot.id)?.enabled).map(bot => ({token:`@${bot.name}`,name:bot.name,type:'Bot',icon:'bot',botId:bot.id,description:bot.role})),
      ...availableSkills().map(skill => ({token:`@skill/${skill.id}`,name:skill.name,type:'Skill',icon:'skill',description:`v${skill.version}`})),
    ];
  }
  /** 按当前查询筛选引用候选。@returns {object[]} 最多十二条候选。 */
  function mentionResults() { const query = (state.mentionQuery || '').toLowerCase(); return references().filter(item => (state.mentionCategory === '全部' || item.type === state.mentionCategory) && `${item.token} ${item.name}`.toLowerCase().includes(query)).slice(0,12); }
  /** 提取正文中完整的 @ 标识。@param {string} text 输入正文。@returns {string[]} 去重后的标识。 */
  function tokens(text) { return [...new Set(text.match(/@[^\s，。！？、；：()（）]+/g) || [])]; }
  /** 显示可用的已选引用。@returns {string} 标记，不解析未知 HTML。 */
  function referenceChips() { const picked = tokens(conversation().draft); return references().filter(ref => picked.includes(ref.token)).map(ref => `<span class="reference-chip">${ref.type === 'Bot' ? botAvatar(data.bots.find(bot => bot.id === ref.botId),'tiny') : icon(ref.icon)}${esc(ref.token)}</span>`).join(''); }
  /** 生成引用菜单。@returns {string} 可按类型筛选的列表。 */
  function mentionMenu() {
    if (state.mentionQuery === null) return '';
    const matches = mentionResults(); state.mentionIndex = Math.min(state.mentionIndex,Math.max(0,matches.length-1));
    return `<div class="mention-popover"><div class="mention-categories">${['全部','仓库','文件','PR','事项','Bot','Skill'].map(category => `<button type="button" class="${category === state.mentionCategory ? 'active' : ''}" data-mention-category="${category}">${category}</button>`).join('')}</div><div class="mention-results" role="listbox" id="mention-list" aria-label="引用候选">${matches.length ? matches.map((ref,index) => `<button type="button" id="mention-${index}" role="option" aria-selected="${index === state.mentionIndex}" data-reference="${esc(ref.token)}">${ref.type === 'Bot' ? botAvatar(data.bots.find(bot => bot.id === ref.botId),'tiny') : icon(ref.icon)}<span><strong>${esc(ref.name)}</strong><small>${esc(ref.token)}</small></span><span class="spacer"></span><small>${esc(ref.description)}</small></button>`).join('') : '<div class="mention-empty">没有匹配项，试试仓库名或技能名</div>'}</div></div>`;
  }
  /** 只刷新引用区域，保留输入框与光标。@returns {void} 更新候选和已选资源。 */
  function refreshMentions() {
    const menu = document.getElementById('mention-host'), chips = document.getElementById('reference-chips'), input = document.getElementById('bot-message');
    if (!menu || !input) return;
    menu.innerHTML = mentionMenu(); chips.innerHTML = referenceChips();
    input.setAttribute('aria-expanded',String(state.mentionQuery !== null));
    if (state.mentionQuery !== null && mentionResults().length) input.setAttribute('aria-activedescendant',`mention-${state.mentionIndex}`); else input.removeAttribute('aria-activedescendant');
  }
  /** 在输入光标处替换 @ 查询。@param {string} token 完整资源标识。@returns {void} 更新草稿并关闭候选菜单。 */
  function insertReference(token) {
    if (!editable()) return;
    const input = document.getElementById('bot-message'); if (!input) return;
    const before = input.value.slice(0,input.selectionStart), after = input.value.slice(input.selectionEnd);
    const match = before.match(/@[^\s@]*$/);
    const prefix = match ? before.slice(0,match.index) : before + (before && !/\s$/.test(before) ? ' ' : '');
    conversation().draft = `${prefix}${token} ${after}`;
    input.value = conversation().draft; state.mentionQuery = null; state.chatError = ''; refreshMentions();
    input.focus(); input.setSelectionRange(prefix.length+token.length+1,prefix.length+token.length+1); persist();
  }
  /** 打开引用菜单，插入触发符但不提交。@returns {void} 更新草稿。 */
  function openMentions() {
    if (!editable()) return;
    const input = document.getElementById('bot-message'); if (!input) return;
    input.focus(); const pos = input.selectionStart;
    input.setRangeText((pos && !/\s$/.test(input.value.slice(0,pos)) ? ' ' : '')+'@',pos,input.selectionEnd,'end');
    conversation().draft = input.value; state.mentionQuery = ''; state.mentionCategory = '全部'; state.mentionIndex = 0; refreshMentions();
  }
  /** 输出简洁的对话工作区，资源操作统一收敛到 @ 引用。@returns {string} 对话页面。 */
  function botsPage() {
    const bot = currentBot();
    const bots = projectBots().filter(item => `${item.name} ${item.role}`.includes(state.rosterQuery));
    return `<div class="project-bots ${state.rosterOpen ? 'roster-open' : ''}"><aside class="bot-roster" aria-label="项目智能体列表"><div class="roster-heading"><span>项目智能体</span><span class="counter">${projectBots().length}</span><span class="spacer"></span><button class="icon-btn" data-action="add-project-bot" aria-label="添加项目智能体" ${state.role === '浏览者' ? 'disabled' : ''}>${icon('plus')}</button></div><label class="search roster-search">${icon('search')}<input id="roster-search" aria-label="搜索项目智能体" placeholder="搜索智能体" value="${esc(state.rosterQuery)}"></label><div class="roster-list">${bots.map(item => {const latest = state.threads.filter(thread => thread.project === state.project && thread.botId === item.id && thread.messages.length).at(-1);return `<button class="roster-item ${bot?.id === item.id ? 'active' : ''}" data-select-agent="${esc(item.id)}">${botAvatar(item)}<span class="roster-info"><span class="row"><strong>${esc(item.name)}</strong><span class="spacer"></span><span class="roster-dot dot ${botStatus(item,true) === '可用' ? 'green' : ''}"></span></span><span class="roster-role">${esc(item.role)}</span><span class="roster-snippet">${esc(latest?.messages.at(-1)?.text.slice(0,50) || item.instructions)}</span></span></button>`;}).join('') || '<p class="small quiet roster-empty">没有匹配的智能体</p>'}</div><div class="roster-footer">${icon('shield')}仅使用本项目的授权资源</div></aside><div class="bot-stage">${bot ? botConversation() : `<div class="empty bot-empty">${icon('bot')}<h2>邀请一位智能体加入项目</h2><p>从团队目录添加，或创建项目专属智能体。</p>${button('add-project-bot','添加智能体','plus','btn primary')}</div>`}</div></div>`;
  }
  /** 展示所选智能体的独立会话。@returns {string} 对话与输入框。 */
  function botConversation() {
    const bot = currentBot(); const thread = conversation(), populated = thread.messages.length > 0;
    return `<section class="bot-workspace ${populated ? 'has-messages' : ''}"><div class="bot-topbar"><button class="icon-btn roster-toggle" data-action="toggle-roster" aria-label="切换智能体列表">${icon('menu')}</button>${botAvatar(bot,'small')}<div class="chat-identity"><strong>${esc(bot.name)}</strong><span>${esc(bot.role)}</span></div><span class="spacer"></span>${botStatusLabel(bot,true)}${button('project-bot-settings','<span class="sr-only">项目智能体配置</span>','settings','icon-btn')}${button('chat-history','<span class="sr-only">对话历史</span>','clock','icon-btn')}${button('new-chat','<span class="sr-only">新对话</span>','plus','icon-btn')}</div>${populated ? `<div class="conversation-feed">${thread.messages.map(entry => `<article class="chat-message ${entry.bot ? 'assistant-message' : 'user-message'}">${entry.bot ? `<div class="reply-author">${botAvatar(bot,'tiny')}${esc(entry.author)}<span class="badge">模拟</span></div>` : ''}<div class="message-text">${esc(entry.text)}</div>${entry.refs?.length ? `<details class="tool-activity"><summary>${icon('check')}引用了 ${entry.refs.length} 项资源</summary><div>${entry.refs.map(ref => `<span class="reference-chip">${esc(ref)}</span>`).join('')}</div></details>` : ''}</article>`).join('')}</div>` : `<div class="bot-welcome"><span class="welcome-avatar">${botAvatar(bot,'hero')}</span><h1>你好，我是${esc(bot.name)}</h1><p>${esc(bot.instructions)}</p></div>`}<div class="bot-compose-wrap"><form id="chat-form" class="bot-composer"><div id="mention-host">${mentionMenu()}</div><textarea id="bot-message" name="message" aria-label="向 Bot 提问" aria-autocomplete="list" aria-controls="mention-list" aria-expanded="${state.mentionQuery !== null}" placeholder="发消息，输入 @ 引用资源或调用 Skill" maxlength="3000" required ${!canChat() ? 'disabled' : ''}>${esc(thread.draft)}</textarea><div id="reference-chips" class="reference-chips">${referenceChips()}</div><div class="compose-toolbar"><button type="button" class="mention-trigger" data-action="mention-open" ${!canChat() ? 'disabled' : ''}>@<span>引用</span></button><span class="spacer"></span><button class="send" aria-label="发送 Bot 消息" ${!canChat() ? 'disabled' : ''}>${icon('send')}</button></div></form>${botStatus(bot,true) !== '可用' ? `<div class="chat-unavailable">${icon('terminal')}${botStatus(bot,true)}，可以查看历史对话。${button('project-bot-settings','查看配置','','text-btn')}</div>` : ''}<p id="chat-error" class="chat-error" role="alert">${esc(state.chatError)}</p>${populated ? '' : `<div class="prompt-suggestions"><button data-prompt="progress">${icon('repo')}梳理项目进展</button><button data-prompt="review">${icon('pr')}看看待审 PR</button><button data-prompt="skills">${icon('skill')}调用团队技能</button></div>`}</div></section>`;
  }
  /** 执行本地对话演示，未知或禁用引用会阻止提交。@param {string} text 用户正文。@returns {void} 追加示例回复，不请求外部服务。 */
  function sendBotMessage(text) {
    if (!text.trim()) return;
    const previousBot = state.activeBot;
    const targetBots = projectBots().filter(bot => tokens(text).includes(`@${bot.name}`));
    if (targetBots.length > 1) { state.chatError = '一次请求请选择一位负责的智能体。'; document.getElementById('chat-error').textContent = state.chatError; return; }
    if (targetBots.length && targetBots[0].id !== currentBot()?.id) {
      if (botStatus(targetBots[0],true) !== '可用') { toast('指定智能体当前不可用'); return; }
      state.activeBot = targetBots[0].id;
    }
    if (!canChat()) { state.activeBot = previousBot; toast('当前智能体不可执行新请求'); return; }
    const refs = references(), selected = tokens(text), unknown = selected.filter(token => !refs.some(ref => ref.token === token));
    if (unknown.length) { state.activeBot = previousBot; state.chatError = `引用不可用：${unknown.join('、')}。请从 @ 菜单重新选择。`; document.getElementById('chat-error').textContent = state.chatError; return; }
    const thread = conversation(), rows = data.rows.filter(row => row.project === state.project);
    const used = refs.filter(ref => selected.includes(ref.token));
    const bot = currentBot();
    const resourceRefs = used.filter(ref => !['Bot','Skill'].includes(ref.type));
    const skills = availableSkills().filter(skill => selected.includes(`@skill/${skill.id}`));
    const lines = [];
    if (resourceRefs.length) {
      resourceRefs.forEach(ref => {
        if (ref.type === '仓库') lines.push(`${ref.token}\n${rows.filter(row => row.kind === '需求').length} 条需求，${rows.filter(row => row.kind === 'Bug').length} 个 Bug，${pullRequests().filter(pr => pr.status === '待审核').length} 个待审 PR。`);
        else if (ref.type === 'PR') { const pr = pullRequests().find(item => `@pr/${item.id}` === ref.token); lines.push(`${ref.token} ${pr.title}\n${pr.branch} → main，当前${pr.status}。建议检查兼容性说明和失败路径验证。`); }
        else if (ref.type === '事项') { const row = rows.find(item => `@${item.id}` === ref.token); lines.push(`${ref.token} ${row.title}\n负责人：${row.owner}；业务状态：${row.status}。`); }
        else lines.push(`${ref.token}\n已选中 ${ref.name} 的示例内容，可据此整理文档或核对接口约定。`);
      });
    }
    skills.forEach(skill => lines.push(`调用 ${skill.name} · v${skill.version}\n${skill.instructions}`));
    if (!lines.length) lines.push('你希望处理哪个仓库或事项？输入 @ 选择资源，也可以直接选择团队 Skill。');
    if (skills.length && !resourceRefs.length) lines.push('请再通过 @ 指定要处理的仓库、文件或事项。');
    lines.push(`采用「${selectedTemplate().name}」协作约定。`);
    if (bindingFor(bot.id)?.notes) lines.push(`项目补充约定：${bindingFor(bot.id).notes}`);
    if (!thread.messages.length) thread.title = text.slice(0,45);
    thread.messages.push({author:'林然',text,bot:false},{author:bot.name,text:lines.join('\n\n'),bot:true,refs:selected});
    data.botRuns.unshift({botId:bot.id,projectId:state.project,title:text.slice(0,70),time:'刚刚',result:'已完成'}); bot.lastActive = '刚刚'; persist();
    thread.draft = ''; state.mentionQuery = null; state.chatError = ''; render();
    const feed = app.querySelector('.conversation-feed');
    if (feed) { feed.lastElementChild?.classList.add('reply-arrived'); feed.scrollTop = feed.scrollHeight; }
  }
  /** 展示团队技能库和模板目录。@returns {string} 技能平台页面。 */
  function skillsPage() {
    if (state.skillTab === 'AGENTS.md 模板') return `<header class="page-head skills-header"><div class="row">${button('menu','<span class="sr-only">展开导航</span>','menu','icon-btn mobile-menu')}<h1 class="sr-only">Skills</h1></div><div class="tabs" role="tablist">${['技能库','AGENTS.md 模板'].map(tab => `<button class="tab" aria-selected="${state.skillTab === tab}" data-skill-tab="${tab}">${tab}</button>`).join('')}</div></header><div class="catalog">${templatesPage()}</div>`;
    const query = state.skillQuery.toLowerCase();
    const skills = data.library.filter(skill => (state.skillCategory === '全部' || skill.category === state.skillCategory) && `${skill.name} ${skill.id} ${skill.description}`.toLowerCase().includes(query));
    return `<header class="page-head skills-header"><div class="row">${button('menu','<span class="sr-only">展开导航</span>','menu','icon-btn mobile-menu')}<h1 class="sr-only">Skills</h1><span class="spacer"></span>${button('new-skill','发布 Skill','plus','btn primary')}</div><div class="tabs" role="tablist" aria-label="Skills 内容">${['技能库','AGENTS.md 模板'].map(tab => `<button class="tab" role="tab" aria-selected="${state.skillTab === tab}" data-skill-tab="${tab}">${tab}</button>`).join('')}</div></header><div class="catalog skills-catalog">${`<div class="skill-toolbar"><div class="category-pills">${['全部','产品','研发','交付'].map(category => `<button class="${state.skillCategory === category ? 'active' : ''}" data-skill-category="${category}">${category}</button>`).join('')}</div><label class="search">${icon('search')}<input id="skill-search" aria-label="搜索 Skills" placeholder="搜索团队技能" value="${esc(state.skillQuery)}"></label></div><div class="skill-grid">${skills.map(skill => `<article class="skill-card"><div class="row"><span class="skill-glyph">${icon('skill')}</span><span class="spacer"></span><span class="skill-state ${skill.enabled ? 'enabled' : ''}"><span class="dot ${skill.enabled ? 'green' : ''}"></span>${skill.enabled ? '已启用' : '已停用'}</span></div><button class="skill-title" data-skill-detail="${skill.id}">${esc(skill.name)}</button><p>${esc(skill.description)}</p><div class="skill-meta"><span>${esc(skill.category)}</span><span>v${esc(skill.version)}</span><span class="spacer"></span><span>${esc(skill.source)}</span></div><div class="skill-card-footer"><code>@skill/${esc(skill.id)}</code><button class="icon-btn" aria-label="使用${esc(skill.name)}" data-use-skill="${skill.id}" ${!skill.enabled || state.role === '浏览者' ? 'disabled' : ''}>${icon('send')}</button></div></article>`).join('')}</div>${skills.length ? '' : `<div class="empty">${icon('search')}<h3>没有找到技能</h3><p>换个关键词，或查看全部分类。</p>${button('clear-skills','清除筛选')}</div>`}`}</div>`;
  }
  /** 打开技能说明与管理入口。@param {string} id 技能标识。@returns {void} 展示可查看的定义。 */
  function skillDetail(id) {
    const skill = data.library.find(item => item.id === id); if (!skill) return;
    dialog(skill.name,`<div class="row"><span class="badge">${esc(skill.category)}</span><span class="badge">v${esc(skill.version)}</span><span class="spacer"></span><span class="small muted">${skill.enabled ? '已启用' : '已停用'}</span></div><p class="skill-description">${esc(skill.description)}</p><div class="document-toolbar"><button class="btn" data-skill-copy="${id}">复制内容</button><button class="btn" data-skill-download="${id}">下载 SKILL.md</button></div><div class="file-head">SKILL.md <code>@skill/${esc(skill.id)}</code></div><pre class="skill-source">${esc(`# ${skill.name}\n\n${skill.instructions}`)}</pre><div class="form-actions"><button class="btn" data-edit-skill="${id}" ${state.role === '浏览者' ? 'disabled' : ''}>编辑</button><button class="btn" data-toggle-skill="${id}" ${state.role === '浏览者' ? 'disabled' : ''}>${skill.enabled ? '停用' : '启用'}</button><span class="spacer"></span><button class="btn primary" data-use-skill="${id}" ${!skill.enabled || state.role === '浏览者' ? 'disabled' : ''}>在 bots 中使用</button></div>`);
  }
  /** 打开技能发布或编辑表单。@param {string} id 可选技能标识。@returns {void} 显示表单，不安装真实插件。 */
  function editSkill(id = '') {
    if (!editable()) return;
    const skill = data.library.find(item => item.id === id);
    dialog(skill ? '编辑 Skill' : '发布团队 Skill',`<form id="skill-form" data-edit-id="${esc(id)}"><div class="form-grid"><label class="field">名称<input name="name" required maxlength="30" value="${esc(skill?.name || '')}"></label><label class="field">调用标识<input name="id" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxlength="40" placeholder="如 api-review" value="${esc(skill?.id || '')}" ${skill ? 'readonly' : ''}></label><label class="field">分类<select name="category">${options(['产品','研发','交付'],skill?.category || '研发')}</select></label><label class="field">版本<input name="version" required pattern="[0-9]+[.][0-9]+[.][0-9]+" value="${esc(skill?.version || '1.0.0')}"></label><label class="field full">简述<input name="description" required maxlength="100" value="${esc(skill?.description || '')}"></label><label class="field full">SKILL.md 指令<textarea name="instructions" required maxlength="6000" placeholder="描述何时使用、操作步骤和输出要求">${esc(skill?.instructions || '')}</textarea></label></div><p class="field-error" role="alert"></p><div class="form-actions">${button('close-modal','取消')}<button class="btn primary">${skill ? '保存修改' : '发布到团队'}</button></div></form>`);
  }
  /** 带着技能引用进入独立 Bot 会话。@param {string} id 技能标识。@param {string} botId 明确选择的智能体标识。@returns {void} 填入草稿等待发送，不授予项目权限。 */
  function useSkill(id,botId) {
    if (!editable()) return;
    const skill=data.library.find(item=>item.id===id),bot=data.bots.find(item=>item.id===botId);
    if(!skill?.enabled||!bot?.enabled||!bot.online||!bot.skills.includes(id)){toast('技能或所选 Bot 不可用，请重新选择');return;}
    modal.close();state.page='collaboration';state.botDetail=null;state.selected=null;
    workspace.openBot('',bot.id,`@skill/${skill.id} `);
    persist();render();document.querySelector('[data-work-input="draft"]')?.focus();
  }
  /** 查看协作模板全文。@param {string} id 模板标识。@returns {void} 显示预览与选用入口。 */
  function templateDetail(id) {
    const t = agentTemplates.find(item => item.id === id); if (!t) return;
    const selectedProject = projects.find(p => p.id === state.templateProject) || project();
    const selected = (data.projectTemplates[selectedProject.id] || agentTemplates[0].id) === id;
    dialog(`${t.name} · AGENTS.md`,`<div class="row"><span class="badge">v${t.version}</span><span class="small muted">${esc(t.tag)}</span><span class="spacer"></span><button class="text-btn" data-document-edit="${id}" ${state.role === '浏览者' ? 'disabled' : ''}>编辑</button><button class="text-btn" data-document-duplicate="${id}" ${state.role === '浏览者' ? 'disabled' : ''}>创建副本</button></div><div class="document-toolbar"><button class="btn" data-document-copy="${id}">复制内容</button><button class="btn" data-document-link="${id}">复制预览链接</button><button class="btn" data-document-download="${id}">下载 AGENTS.md</button></div><pre class="skill-source document-preview">${esc(t.content)}</pre><p class="section-note">链接包含当前版本快照。本机预览链接仅能在可访问本机服务的环境打开，尚未发布到公网。</p><div class="template-apply"><label class="field">目标项目<select aria-label="选用模板的项目" data-change="templateDialogProject">${projects.map(p => `<option value="${p.id}" ${p.id === selectedProject.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><button class="btn primary" data-apply-template="${id}" ${state.role === '浏览者' || selected ? 'disabled' : ''}>${selected ? '项目已选用' : '应用到项目'}</button></div><p class="small muted">用于项目 Bots 的协作约定，不覆盖远端仓库文件。</p>`);
    modal.dataset.templateId = id;
  }
  /** 输出讨论记录，用户内容一律转义。@param {object} entry 评论。@returns {string} 评论标记。 */
  function comment(entry) { return `<div class="comment">${entry.bot ? botAvatar(data.bots.find(bot => bot.name === entry.author) || data.bots[0],'small') : avatar(entry.author)}<div class="comment-content"><div class="comment-meta"><strong>${esc(entry.author)}</strong>${entry.bot ? '<span class="badge blue">Bot · 模拟</span>' : ''}<span class="quiet">${esc(entry.time)}</span></div><p class="comment-body">${esc(entry.text)}</p></div></div>`; }
  /** 输出事项详情并与主列表共享同一记录。@returns {string} 详情标记；无选中项时为空。 */
  function details() {
    const row = data.rows.find(item => item.id === state.selected && item.project === state.project);
    if (!row || state.page !== 'project' || !['需求','Bug'].includes(state.tab)) return '';
    return `<aside class="details ${state.expanded ? 'expanded' : ''}" aria-label="事项详情"><div class="detail-top"><h2>事项详情</h2><span class="spacer"></span>${button('edit-item','<span class="sr-only">编辑事项</span>','edit','icon-btn')}${button('expand','<span class="sr-only">展开详情</span>','expand','icon-btn')}${button('close-detail','<span class="sr-only">关闭详情</span>','close','icon-btn')}</div><div class="detail-scroll"><p class="detail-id">${row.id}</p><h2 class="detail-title">${esc(row.title)}</h2><div class="row spread"><select class="btn" aria-label="业务状态" data-change="status" ${state.role === '浏览者' ? 'disabled' : ''}>${options(stages,row.status)}</select><button class="btn" data-action="test" ${state.role === '浏览者' || row.status === '已完成' ? 'disabled' : ''}>标记提测</button></div><dl class="properties"><dt>${icon('user')}研发负责人</dt><dd>${esc(row.owner)}</dd><dt>${icon('users')}协作成员</dt><dd>${esc(row.collaborators || '未指定')}</dd>${row.tester ? `<dt>${icon('user')}测试负责人</dt><dd>${esc(row.tester)}</dd>` : ''}<dt>${icon('layers')}所属项目</dt><dd>${esc(project().name)}</dd><dt>${icon('repo')}关联仓库</dt><dd>${esc(project().repo)}</dd></dl><div class="task-actions"><button type="button" class="btn primary" data-work="issue-task" data-id="${esc(row.id)}" ${state.role === '浏览者' ? 'disabled' : ''}>交给 Bot 跟进</button></div><p class="description">${esc(row.description)}</p>${row.external ? `<p class="section-note"><a href="${esc(row.external)}" target="_blank" rel="noopener noreferrer">打开外部文档 ${icon('external')}</a></p>` : ''}<section class="code-links"><h3>代码关联</h3><div class="row">${icon('branch')}<button data-action="branch-file">${esc(row.branch)}</button></div>${row.pr ? `<div class="row">${icon('pr')}<button class="text-btn" data-pr="${row.pr}">#${row.pr} ${row.id === 'PRD-024' ? '统一错误响应结构' : '查看关联变更'}</button><span class="spacer"></span><span class="badge">${pullRequests().find(pr => pr.id === row.pr)?.status || '未关联'}</span></div>` : '<p class="section-note">暂未关联 PR</p>'}<div class="row">${icon('commit')}${button('commit','a7c92e1','','text-btn')}</div>${row.kind === 'Bug' && row.id === 'BUG-018' ? `<div class="row">${icon('bug')}${button('issue','Issue #18 · 远端 Open','','text-btn')}</div>` : ''}</section><div class="tabs detail-tabs" role="tablist" aria-label="详情内容">${['讨论','活动'].map(tab => `<button class="tab" role="tab" aria-selected="${state.detailTab === tab}" data-detail-tab="${tab}">${tab}</button>`).join('')}</div>${state.detailTab === '讨论' ? row.comments.map(comment).join('') || '<p class="section-note">还没有讨论，补充验收说明吧。</p>' : row.activity.map(activity => `<p class="activity-item">${esc(activity)}</p>`).join('')}</div><form id="comment-form" class="composer"><textarea name="comment" aria-label="讨论内容" placeholder="补充说明，或 @项目助手…" maxlength="2000" required ${state.role === '浏览者' ? 'disabled' : ''}></textarea><div class="composer-tools"><span class="hint">${state.role === '浏览者' ? '浏览者只读' : '讨论保存在此浏览器'}</span><button class="send" aria-label="发送讨论" ${state.role === '浏览者' ? 'disabled' : ''}>${icon('send')}</button></div></form></aside>`;
  }
  /** 输出一级项目、Bot 或 Skills 页面。@returns {string} 页面标记。 */
  function catalog() { if(state.page==='team-admin')return teamAdmin.page();if(state.page==='vault')return vault.page(); if (state.page === 'collaboration') return workspace.collaboration(); if (state.page === 'operations') return workspace.operations(); if (state.page === 'memory') return workspace.memories(); if (state.page === 'connections') return workspace.connections(); if (state.page === 'variables') return workspace.variables(); if (state.page === 'Bot') return workspace.capabilityNav('Bot') + botsCatalog(); if (state.page === 'projects') return projectsPage(); return workspace.capabilityNav(state.skillTab === 'AGENTS.md 模板' ? 'templates' : 'Skills') + skillsPage(); }
  let activeDropdown = null;
  let dropdownSequence = 0;
  /** 收起下拉菜单，保留已选值。@param {boolean} restoreFocus 是否归还触发器焦点。@returns {void} 清理顶层菜单。 */
  function closeDropdown(restoreFocus = false) {
    if (!activeDropdown) return;
    const {trigger,menu} = activeDropdown;
    activeDropdown = null;
    menu.hidePopover(); trigger.setAttribute('aria-expanded','false'); trigger.removeAttribute('aria-activedescendant');
    if (restoreFocus && trigger.isConnected) trigger.focus();
  }
  /** 增强指定选择框，原生 select 继续承载表单值与 change 事件。@param {HTMLElement} root 本轮渲染容器。@returns {void} 安装鼠标和键盘选择行为。 */
  function enhanceProjectSelects(root) {
    root.querySelectorAll('select[data-change="projectFilter"],#project-create-form select,form[data-work-form] select,form[data-team-form] select,form[data-vault-form] select').forEach(select => {
      if (select.closest('.select-control')) return;
      const wrapper = document.createElement('span'), trigger = document.createElement('button'), menu = document.createElement('div');
      const label = select.getAttribute('aria-label') || Array.from(select.closest('label')?.childNodes || []).filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).join('') || '选择';
      const id = `project-select-${++dropdownSequence}`;
      wrapper.className = 'select-control'; trigger.className = 'select-trigger'; trigger.type = 'button'; trigger.disabled = select.disabled;
      trigger.setAttribute('role','combobox'); trigger.setAttribute('aria-label',label); trigger.setAttribute('aria-haspopup','listbox'); trigger.setAttribute('aria-expanded','false'); trigger.setAttribute('aria-controls',id);
      menu.id = id; menu.className = 'select-menu'; menu.setAttribute('popover','manual'); menu.setAttribute('role','listbox'); menu.setAttribute('aria-label',label);
      select.before(wrapper); wrapper.append(select,trigger,menu); select.hidden = true; select.tabIndex = -1;
      let activeIndex = select.selectedIndex;
      const choices = Array.from(select.options);
      /** 更新菜单选中态及键盘高亮。@returns {void} 同步显示，不修改表单值。 */
      function sync() {
        trigger.innerHTML = `<span>${esc(select.selectedOptions[0]?.textContent || '')}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>`;
        menu.querySelectorAll('[role="option"]').forEach((option,index) => { option.setAttribute('aria-selected',String(index === select.selectedIndex)); option.classList.toggle('highlighted',index === activeIndex); });
        if (activeDropdown?.trigger === trigger) trigger.setAttribute('aria-activedescendant',`${id}-${activeIndex}`);
      }
      /** 确认选项并复用原有业务事件。@param {number} index 选项位置。@returns {void} 值变化时发送 change。 */
      function commit(index) {
        if (!choices[index] || choices[index].disabled) return;
        const changed = select.selectedIndex !== index;
        select.selectedIndex = index; activeIndex = index; sync(); closeDropdown(true);
        if (changed) select.dispatchEvent(new Event('change',{bubbles:true}));
        if (!trigger.isConnected && select.dataset.change === 'projectFilter') app.querySelector('.select-trigger')?.focus();
      }
      choices.forEach((choice,index) => {
        const option = document.createElement('button'); option.type = 'button'; option.tabIndex = -1; option.id = `${id}-${index}`; option.setAttribute('role','option'); option.disabled = choice.disabled;
        option.innerHTML = `<span>${esc(choice.textContent)}</span><span class="select-check" aria-hidden="true">✓</span>`;
        option.addEventListener('pointerdown',event => event.preventDefault());
        option.addEventListener('click',() => commit(index)); menu.append(option);
      });
      /** 在视口内展开菜单，空间不足时向上展开。@returns {void} 将菜单置于顶层，避开弹窗裁剪。 */
      function open() {
        if (trigger.disabled) return;
        closeDropdown(); activeIndex = select.selectedIndex; activeDropdown = {trigger,menu}; trigger.setAttribute('aria-expanded','true');
        const rect = trigger.getBoundingClientRect(), width = Math.min(Math.max(rect.width,156),innerWidth-16), below = innerHeight-rect.bottom-12, above = rect.top-12;
        const upwards = below < Math.min(choices.length*36+10,250) && above > below;
        menu.style.width = `${width}px`; menu.style.maxHeight = `${Math.max(60,Math.min(270,upwards ? above : below))}px`;
        menu.style.left = `${Math.max(8,Math.min(rect.left,innerWidth-width-8))}px`;
        menu.showPopover(); menu.style.top = `${upwards ? Math.max(8,rect.top-menu.offsetHeight-5) : rect.bottom+5}px`; sync(); trigger.focus();
      }
      trigger.addEventListener('click',() => activeDropdown?.trigger === trigger ? closeDropdown() : open());
      trigger.addEventListener('keydown',event => {
        const isOpen = activeDropdown?.trigger === trigger;
        if (event.key === 'Tab') { closeDropdown(); return; }
        if (event.key === 'Escape' && isOpen) { event.preventDefault(); event.stopPropagation(); closeDropdown(true); return; }
        if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
          event.preventDefault(); event.stopPropagation();
          if (!isOpen) { open(); return; }
          const enabled = choices.map((choice,index) => choice.disabled ? -1 : index).filter(index => index >= 0);
          if (event.key === 'Home') activeIndex = enabled[0];
          else if (event.key === 'End') activeIndex = enabled[enabled.length-1];
          else activeIndex = enabled[(enabled.indexOf(activeIndex)+(event.key === 'ArrowDown' ? 1 : enabled.length-1)) % enabled.length];
          sync(); menu.children[activeIndex]?.scrollIntoView({block:'nearest'}); return;
        }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); if (isOpen) commit(activeIndex); else open(); }
      });
      sync();
    });
  }
  document.addEventListener('pointerdown',event => { if (activeDropdown && !activeDropdown.trigger.contains(event.target) && !activeDropdown.menu.contains(event.target)) closeDropdown(); },true);
  document.addEventListener('focusin',event => { if (activeDropdown && !activeDropdown.trigger.contains(event.target) && !activeDropdown.menu.contains(event.target)) closeDropdown(); });
  window.addEventListener('resize',() => closeDropdown());
  document.addEventListener('scroll',event => { if (activeDropdown && !activeDropdown.menu.contains(event.target)) closeDropdown(); },true);
  modal.addEventListener('close',() => closeDropdown());
  /** 重绘界面；保持检索光标与当前正文滚动位置。@returns {void} 更新 DOM，不发起网络请求。 */
  function render() {
    closeDropdown();
    syncRoute();
    const focused = document.activeElement;
    const focusId = focused?.id;
    const searchFocus = ['item-search','skill-search','bot-message','bot-search','roster-search','project-search','template-search','pr-search'].includes(focusId);
    const position = searchFocus ? focused.selectionStart : 0;
    const scroll = app.querySelector('.main')?.scrollTop || 0;
    const pages = { '需求': itemsPage, 'Bug': itemsPage, '代码': codePage, 'PR': prPage, '产物与版本': artifactsPage, 'bots': () => workspace.collaboration(state.project), '环境变量': () => workspace.variables(state.project), '流水线':()=>workspace.pipelines(state.project) };
    app.innerHTML = `<div class="shell ${state.menu ? 'menu-open' : ''}">${sidebar()}<div class="surface"><main class="main">${persistenceWarning ? `<div class="notice">${esc(persistenceWarning)}</div>` : ''}${state.page === 'project' ? `${header()}<div class="content ${state.tab === 'bots' ? 'bot-content' : ''}">${state.tab === '代码' ? gitStrip() : ''}${pages[state.tab]()}</div>` : catalog()}</main>${details()}${botDetails()}</div></div>`;
    enhanceProjectSelects(app);
    app.querySelector('.main').scrollTop = scroll;
    if (searchFocus) { const input = document.getElementById(focusId); input?.focus(); input?.setSelectionRange(position,position); }
  }
  /** 切换项目并清理不适用的筛选。@param {string} id 项目 ID。@returns {void} 更新页面状态。 */
  function selectProject(id) { workspace?.setProject(id); state.project = id; state.templateProject = id; state.page = 'project'; state.tab = '需求'; state.selected = null; state.filter = '全部'; state.owner = '全部负责人'; state.query = ''; state.branch = 'main'; state.file = 'README.md'; state.botDetail = null; state.rosterQuery = ''; state.menu = false; state.mentionQuery = null; state.chatError = ''; render(); }
  /** 打开可用 Escape 关闭的原生对话框。@param {string} title 标题。@param {string} body 已转义内容。@returns {void} 聚焦对话框。 */
  function dialog(title,body) { closeDropdown(); modal.classList.remove('vault-log-dialog'); delete modal.dataset.dirty; modal.innerHTML = `<header><h2 id="modal-title">${esc(title)}</h2>${button('close-modal','<span class="sr-only">关闭弹窗</span>','close','icon-btn')}</header><div class="modal-body">${body}</div>`; if (!modal.open) modal.showModal(); enhanceProjectSelects(modal); }
  /** 关闭编辑表单前保留用户输入并询问是否放弃。@returns {void} 显示原位提示或关闭弹窗。 */
  function requestDialogClose() {
    if (modal.dataset.dirty === 'true' && modal.querySelector('form')) {
      if (!modal.querySelector('.discard-confirm')) modal.querySelector('.modal-body').insertAdjacentHTML('beforeend',`<div class="discard-confirm" role="alert"><span>有尚未保存的修改</span><button class="btn" data-action="keep-editing">继续编辑</button><button class="btn" data-action="discard-editing">放弃修改</button></div>`);
      modal.querySelector('.discard-confirm').scrollIntoView({block:'nearest'}); return;
    }
    modal.close();
  }
  /** 显示演示说明，不冒充真实外部操作。@param {string} title 标题。@param {string} message 说明。@returns {void} 打开对话框。 */
  function info(title,message) { dialog(title,`<div class="info-box">${esc(message)}</div><div class="form-actions">${button('close-modal','知道了','','btn primary')}</div>`); }
  /** 打开新建事项表单。@returns {void} 仅显示表单；提交时才写本地数据。 */
  function newItem() { if (!editable()) return; dialog('新建事项',`<form id="new-form"><div class="form-grid"><label class="field">类型<select name="kind">${options(['需求','Bug'],state.tab === 'Bug' ? 'Bug' : '需求')}</select></label><label class="field">研发负责人<select name="owner">${options(people,'林然')}</select></label><label class="field full">标题<input name="title" required maxlength="80" placeholder="简洁描述需要完成的事情"></label><label class="field full">需求或问题说明<textarea name="description" required maxlength="3000" placeholder="背景、目标与验收标准"></textarea></label><label class="field">协作成员<select name="collaborators">${options(['未指定',...people],'未指定')}</select></label><label class="field">外部文档链接（可选）<input name="external" type="url" placeholder="https://…"></label></div><div class="field-error" role="alert"></div><div class="form-actions">${button('close-modal','取消')}<button class="btn primary" type="submit">创建事项</button></div></form>`); }
  /** 打开提测表单；提测不执行或等待任何流水线。@param {string} next 确认后使用的业务状态。@returns {void} 显示测试负责人选择。 */
  function testDialog(next = '待提测') { if (!editable()) return; dialog('标记提测',`<form id="test-form" data-next="${next}"><div class="info-box">只更新事项的业务状态并记录测试负责人。不会触发构建、部署或发布，也不要求流水线已经完成。</div><label class="field">测试负责人<select name="tester">${options(people,'许嘉')}</select></label><div class="form-actions">${button('close-modal','取消')}<button class="btn primary">确认提测</button></div></form>`); }
  /** 更新事项并记录活动。@param {object} row 事项。@param {string} next 下一状态。@returns {void} 保存业务变化。 */
  function updateStatus(row,next) { const before = row.status; row.status = next; row.activity.unshift(`林然 · ${new Date().toLocaleString('zh-CN')} · ${before} → ${next}${row.tester ? `；测试负责人：${row.tester}` : ''}`); persist(); render(); toast('业务状态已更新，未触发流水线'); }
  /** 打开只读 PR 变更预览。@param {string} id PR 编号。@returns {void} 显示演示差异。 */
  function openPr(id) { const pr = pullRequests().find(item => item.id === id); if (!pr) { info('关联不可用','当前项目没有对应的示例 PR。'); return; } dialog(`PR #${id} · 代码评审`, `<div class="row" style="margin-bottom:18px">${status(pr.status)}<span class="badge">${project().provider} · 演示数据</span></div><h3>${esc(pr.title)}</h3><p class="section-note">${esc(pr.branch)} → main · ${esc(pr.author)} · 1 个示例变更文件<br>PR 状态与需求的业务进度分别维护。</p><div class="related-items">${data.rows.filter(r => r.project === state.project && r.pr === id).map(r => `<button class="text-btn" data-linked-item="${r.id}">${icon('file')}${r.id} · ${esc(r.title)}</button>`).join('')}</div><div class="file-head">src/api.ts <span class="blue">+2 −1</span></div><pre class="code" style="min-height:140px"><code><span class="diff-line remove">- message: 'Internal error'</span><span class="diff-line add">+ code: 'INTERNAL_ERROR',</span><span class="diff-line add">+ message: '请求失败，请稍后重试'</span></code></pre><div class="form-actions">${button('remote','在原平台查看','external')}${button('close-modal','关闭')}</div>`); }
  /** 显示原型设置，角色控制仅用于演示。@returns {void} 打开设置。 */
  function settings() { dialog('原型设置',`<div class="info-box">此处只影响演示页面。真实服务端仍需独立校验身份、资源归属与权限。</div><div class="settings-row"><div><strong>演示角色</strong><p>浏览者只能查看，不修改业务记录。</p></div><select aria-label="演示角色" data-change="role">${options(['管理员','开发者','浏览者'],state.role)}</select></div><div class="settings-row"><div><strong>模拟代码读取失败</strong><p>在代码页查看错误与重试状态。</p></div><input class="switch" type="checkbox" aria-label="模拟代码读取失败" data-change="failure" ${state.failure ? 'checked' : ''}></div><div class="settings-row"><div><strong>重置演示数据</strong><p>只清除本原型创建的事项、讨论和配置。</p></div>${button('reset-confirm','重置')}</div><div class="form-actions">${button('close-modal','完成','','btn primary')}</div>`); }
  /** 加载项目、模板与会话的本地扩展数据，保留旧版事项。@returns {void} 初始化演示数据与筛选状态。 */
  function loadInteractionData() {
    const validProjects = Array.isArray(data.projectRecords) && data.projectRecords.length && data.projectRecords.every(p => ['id','name','repo','provider','status','owner','description'].every(key => typeof p[key] === 'string') && Array.isArray(p.services) && p.services.every(service => typeof service === 'string'));
    if (validProjects) projects.splice(0,projects.length,...data.projectRecords);
    else projects.forEach(p => Object.assign(p,{status:'进行中',owner:p.id === 'dev-ops' ? '林然' : '周宁',description:p.id === 'dev-ops' ? '研发事项、代码评审与团队智能体协作。' : '移动端客户体验与版本维护。'}));
    data.projectRecords = projects;
    if (!Array.isArray(data.remotePrs) || !data.remotePrs.every(pr => ['id','project','title','author','branch','status'].every(key => typeof pr[key] === 'string'))) {
      delete data.remotePrs;
      data.remotePrs = projects.flatMap(p => pullRequests(p.id));
    }
    if (Array.isArray(data.templates) && data.templates.length && data.templates.every(t => ['id','name','tag','description','content'].every(key => typeof t[key] === 'string'))) agentTemplates = data.templates;
    data.templates = agentTemplates;
    agentTemplates.forEach(t => { if (!t.version) t.version = 1; });
    const saved = data.conversations;
    if (saved && Array.isArray(saved.threads) && saved.threads.every(t => ['id','project','botId','title','draft'].every(key => typeof t[key] === 'string') && Array.isArray(t.messages) && t.messages.every(m => typeof m.text === 'string' && typeof m.author === 'string')) && saved.threadByProject && typeof saved.threadByProject === 'object') {
      state.threads = saved.threads; state.threadByProject = saved.threadByProject;
    }
    Object.assign(state,{projectQuery:'',projectFilter:'全部',activitySource:'全部',templateQuery:'',templateProject:projects[0].id,prQuery:'',prFilter:'全部'});
  }
  /** 返回项目统计，进度只按事项完成情况计算。@param {string} id 项目标识。@returns {object} 当前事项与智能体数量。 */
  function projectMetrics(id) {
    const rows = data.rows.filter(row => row.project === id), done = rows.filter(row => row.status === '已完成').length;
    return {total:rows.length,done,percent:rows.length ? Math.round(done / rows.length * 100) : 0,requirements:rows.filter(row => row.kind === '需求' && row.status !== '已完成').length,bugs:rows.filter(row => row.kind === 'Bug' && row.status !== '已完成').length,prs:pullRequests(id).filter(pr => pr.status === '待审核').length,bots:data.bindings.filter(binding => binding.projectId === id && binding.enabled && data.bots.some(bot => bot.id === binding.botId && bot.enabled)).length};
  }
  /** 生成最近一年按日聚合的演示活动，固定日期与项目得到相同结果。@param {object[]} visibleProjects 当前筛选项目。@returns {object[]} 日期及各来源活动数量；不代表远端真实记录。 */
  function activityDays(visibleProjects) {
    const now = new Date(), today = new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()));
    const start = new Date(today); start.setUTCDate(start.getUTCDate() - start.getUTCDay() - 52 * 7);
    return Array.from({length:371},(_,index) => {
      const day = new Date(start); day.setUTCDate(start.getUTCDate()+index);
      const date = day.toISOString().slice(0,10), counts = {'代码':0,'事项':0,'PR':0,'Bots':0};
      visibleProjects.filter(p => ['dev-ops','mobile-app'].includes(p.id)).forEach(p => Object.keys(counts).forEach(source => {
        let hash = 0; for (const char of date+p.id+source) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        counts[source] += hash % 37 < 2 ? 1 + hash % 8 : 0;
      }));
      const total = state.activitySource === '全部' ? Object.values(counts).reduce((sum,value) => sum+value,0) : counts[state.activitySource];
      return {date,counts,total,future:day > today,month:day.getUTCMonth()+1,day:day.getUTCDate()};
    });
  }
  /** 渲染按周排列、按日着色的活动晴雨表。@param {object[]} visibleProjects 当前筛选范围。@returns {string} 含日期说明及活动详情入口的 HTML。 */
  function activityHeatmap(visibleProjects) {
    const days = activityDays(visibleProjects), total = days.filter(d => !d.future).reduce((sum,d) => sum+d.total,0);
    const months = Array.from({length:53},(_,week) => { const first = days[week*7]; return `<span>${first.day <= 7 && week < 51 ? first.month+'月' : ''}</span>`; }).join('');
    return `<section class="activity-map" aria-label="项目活动晴雨表"><div class="activity-heading"><strong>项目晴雨表</strong><span class="small quiet">过去一年 · ${total} 次活动</span><span class="spacer"></span><span class="small quiet">示例数据</span><select class="btn" data-change="activitySource" aria-label="活动来源">${options(['全部','代码','事项','PR','Bots'],state.activitySource)}</select></div><div class="activity-scroll"><div class="activity-calendar"><div class="activity-months">${months}</div><div class="activity-weekdays" aria-hidden="true"><span>一</span><span>三</span><span>五</span></div><div class="activity-grid">${days.map(d => { if(d.future) return '<span class="activity-day future"></span>'; const level = d.total === 0 ? 0 : d.total <= 3 ? 1 : d.total <= 6 ? 2 : d.total <= 10 ? 3 : 4; const label = `${d.date} · ${d.total} 次活动`; return `<button class="activity-day level-${level}" data-activity-date="${d.date}" title="${label}" aria-label="${label}"></button>`; }).join('')}</div></div></div><div class="activity-footer"><span>代码 · 事项 · PR · Bots</span><div class="activity-legend" aria-label="颜色越深，活动越多"><span>少</span>${[0,1,2,3,4].map(level => `<i class="activity-day level-${level}"></i>`).join('')}<span>多</span></div></div></section>`;
  }
  /** 渲染紧凑项目列表与晴雨表；展示当前项目筛选范围的活动热力图。@returns {string} 项目首页 HTML。 */
  function projectsPage() {
    const list = projects.filter(p => (state.projectFilter === '全部' || p.status === state.projectFilter) && `${p.name} ${p.repo} ${p.owner}`.toLowerCase().includes(state.projectQuery.toLowerCase()));
    return `<header class="page-head"><div class="row">${button('menu','<span class="sr-only">展开导航</span>','menu','icon-btn mobile-menu')}<h1 class="sr-only">项目</h1><span class="spacer"></span><button class="btn primary" data-action="connect" ${state.role === '浏览者' ? 'disabled' : ''}>${icon('plus')}关联项目</button></div></header>
    <div class="catalog project-home">${activityHeatmap(list)}
    <div class="filters"><select class="btn project-filter" aria-label="项目状态筛选" data-change="projectFilter"><option value="全部" ${state.projectFilter === '全部' ? 'selected' : ''}>全部状态</option>${options(['计划中','进行中','已暂停','已完成'],state.projectFilter)}</select><label class="search">${icon('search')}<input id="project-search" aria-label="搜索项目" placeholder="搜索项目、仓库或负责人" value="${esc(state.projectQuery)}"></label></div>
    <div class="project-grid">${list.map(p => { const m = projectMetrics(p.id); return `<article class="project-card"><div class="project-card-head"><span class="project-symbol">${icon('folder')}</span><div class="project-identity"><button class="project-card-title" data-project="${esc(p.id)}">${esc(p.name)}</button><div class="repo-caption" title="${esc(p.provider+' · '+p.repo)}">${esc(p.provider)} · ${esc(p.repo)}</div></div><button class="icon-btn" aria-label="设置${esc(p.name)}" data-project-settings="${esc(p.id)}">${icon('settings')}</button></div>
    <div class="project-state-row">${status(p.status)}<span class="project-owner">${avatar(p.owner)}${esc(p.owner)}</span></div>
    <div class="project-metrics">${[['需求',m.requirements],['Bug',m.bugs],['PR',m.prs],['bots',m.bots]].map(([tab,count]) => `<button data-project-jump="${p.id}" data-jump-tab="${tab}"><strong>${count}</strong><span>${tab === 'PR' ? '待审 PR' : tab === 'bots' ? 'Bots' : '待处理'+tab}</span></button>`).join('')}</div>
    <div class="project-card-footer"><div class="project-progress"><div class="progress-caption"><span>完成度 <b>${m.percent}%</b></span><span>${m.done}/${m.total}</span></div><progress max="100" value="${m.percent}" aria-label="${esc(p.name)}事项完成度">${m.percent}%</progress></div><button class="text-btn" data-project="${p.id}">进入项目 ${icon('arrow')}</button></div></article>`; }).join('')}</div>${list.length ? '' : `<div class="empty">${icon('search')}<h3>没有匹配的项目</h3><p>调整关键词或状态筛选后重试。</p>${button('clear-projects','清除筛选')}</div>`}</div>`;
  }
  /** 编辑项目的本地业务信息，不改变远端仓库。@param {string} id 项目标识。@returns {void} 打开配置表单。 */
  function projectSettings(id) {
    const p = projects.find(item => item.id === id); if (!p) return;
    dialog('项目设置',`<form id="project-settings-form" data-project-id="${p.id}"><div class="form-grid"><label class="field full">项目名称<input name="name" required maxlength="50" value="${esc(p.name)}"></label><label class="field">项目状态<select name="status">${options(['计划中','进行中','已暂停','已完成'],p.status)}</select></label><label class="field">负责人<select name="owner">${options(people,p.owner)}</select></label><label class="field full">项目说明<textarea name="description" maxlength="500">${esc(p.description)}</textarea></label></div><div class="settings-row"><div><strong>关联仓库</strong><p>${esc(p.provider)} · ${esc(p.repo)}</p></div><span class="badge">${state.failure ? '读取异常' : '已关联'}</span></div><div class="settings-row"><div><strong>AGENTS.md</strong><p>${esc((agentTemplates.find(t => t.id === data.projectTemplates[id]) || agentTemplates[0]).name)}</p></div><button type="button" class="text-btn" data-project-template="${p.id}">管理文件</button></div><p class="field-error" role="alert"></p><div class="form-actions">${button('close-modal','取消')}<button class="btn primary" ${state.role === '浏览者' ? 'disabled' : ''}>保存</button></div></form>`);
    if (state.role === '浏览者') modal.querySelectorAll('#project-settings-form input,#project-settings-form select,#project-settings-form textarea').forEach(el => el.disabled = true);
  }
  /** 关联已有仓库的本地模拟流程，重复仓库跳回已有项目。@returns {void} 打开关联表单。 */
  function connectProject() {
    if (!editable()) return;
    dialog('关联项目',`<form id="project-create-form"><p class="info-box">在本原型中保存关联关系，不创建或复制远端仓库。</p><div class="form-grid"><label class="field">代码平台<select name="provider">${options(['GitHub','Gitea'],'GitHub')}</select></label><label class="field">负责人<select name="owner">${options(people,'林然')}</select></label><label class="field full">仓库路径<input name="repo" required placeholder="team/repository" pattern="(?:[A-Za-z0-9_.]|-)+/(?:[A-Za-z0-9_.]|-)+" maxlength="100"></label><label class="field full">项目名称<input name="name" required maxlength="50" placeholder="例如：客户工作台"></label></div><p class="field-error" role="alert"></p><div class="form-actions">${button('close-modal','取消')}<button class="btn primary">关联并进入项目</button></div></form>`);
  }
  /** 复制纯文本，权限失败时给出可手动选择的文本。@param {string} text 内容。@returns {Promise<void>} 不伪报复制成功。 */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('已复制到剪贴板'); }
    catch (error) { dialog('手动复制',`<p class="small muted">浏览器未允许自动复制，请选择下方内容复制。</p><textarea class="manual-copy" aria-label="待复制内容" readonly>${esc(text)}</textarea>`); modal.querySelector('textarea').select(); }
  }
  /** 下载浏览器内已有的纯文本，不请求远端。@param {string} name 文件名。@param {string} text 内容。@returns {void} 触发文件下载。 */
  function downloadText(name,text) {
    const url = URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000); toast('已生成下载文件');
  }
  /** 构造独立可打开的文档快照链接，不依赖作者的本地存储。@param {object} template 文档。@returns {string} 同站点预览 URL。 */
  function templateLink(template) {
    const url = new URL('template-preview.html',location.href);
    url.hash = encodeURIComponent(JSON.stringify({name:template.name,version:template.version,content:template.content})); return url.href;
  }
  /** 渲染模板库与明确的目标项目选择。@returns {string} 模板目录。 */
  function templatesPage() {
    const list = agentTemplates.filter(t => `${t.name} ${t.tag}`.toLowerCase().includes(state.templateQuery.toLowerCase()));
    return `<div class="template-toolbar"><label class="row small muted">目标项目<select class="btn" aria-label="模板目标项目" data-change="templateProject">${projects.map(p => `<option value="${p.id}" ${p.id === state.templateProject ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><button class="btn primary" data-action="new-template" ${state.role === '浏览者' ? 'disabled' : ''}>${icon('plus')}新建模板</button></div><div class="filters"><label class="search template-search">${icon('search')}<input id="template-search" placeholder="搜索模板名称或分类" aria-label="搜索模板" value="${esc(state.templateQuery)}"></label></div><div class="template-grid">${list.map(t => { const selected = (data.projectTemplates[state.templateProject] || agentTemplates[0].id) === t.id; return `<article class="template-card"><div class="row">${icon('file')}<span class="badge">${esc(t.tag)}</span><span class="spacer"></span>${selected ? '<span class="badge blue">当前选用</span>' : ''}</div><button class="template-title" data-template="${t.id}">${esc(t.name)}</button><p>${esc(t.description)}</p><pre>${esc(t.content.split('\n').slice(0,6).join('\n'))}</pre><div class="template-tools"><button data-document-copy="${t.id}">复制内容</button><button data-document-link="${t.id}">复制链接</button><button data-document-download="${t.id}">下载</button></div><div class="row"><span class="small quiet">v${t.version}</span><span class="spacer"></span><button class="text-btn" data-template="${t.id}">管理文件 ${icon('arrow')}</button></div></article>`; }).join('')}</div>${list.length ? '' : `<div class="empty"><h3>没有匹配的模板</h3>${button('clear-templates','清除筛选')}</div>`}`;
  }
  /** 编辑、复制或创建团队模板。@param {string} id 原模板 ID。@param {boolean} duplicate 是否创建副本。@returns {void} 显示编辑器。 */
  function editTemplate(id = '',duplicate = false) {
    if (!editable()) return; const t = agentTemplates.find(item => item.id === id);
    dialog(t && !duplicate ? '编辑 AGENTS.md 模板' : '新建 AGENTS.md 模板',`<form id="template-form" data-template-id="${t && !duplicate ? t.id : ''}"><div class="form-grid"><label class="field">名称<input name="name" required maxlength="40" value="${esc(t ? t.name+(duplicate ? ' 副本' : '') : '')}"></label><label class="field">分类<input name="tag" required maxlength="30" value="${esc(t?.tag || '团队')}"></label><label class="field full">说明<input name="description" maxlength="200" value="${esc(t?.description || '')}"></label><label class="field full">AGENTS.md<textarea class="document-editor" name="content" required maxlength="20000" spellcheck="false">${esc(t?.content || '# AGENTS.md\n\n## 协作约定\n')}</textarea></label></div>${t && !duplicate ? '<p class="section-note">保存后，选用此模板的项目将使用新版本。需要独立维护时请先创建副本。</p>' : ''}<p class="field-error" role="alert"></p><div class="form-actions">${button('close-modal','取消')}<button class="btn primary">保存模板</button></div></form>`);
  }
  /** 选择允许使用此技能的独立 Bot，不要求项目上下文。@param {string} id 技能 ID。@returns {void} 打开选择器，选择后进入会话草稿。 */
  function chooseSkillTarget(id) {
    if(!editable())return;const skill=data.library.find(item=>item.id===id);if(!skill?.enabled)return;
    const choices=data.bots.filter(bot=>bot.enabled&&bot.online&&bot.skills.includes(id));
    dialog(`使用 ${skill.name}`,`<p class="section-note">选择智能体，项目资源可以稍后在会话中引用。</p><div class="project-chat-picker">${choices.map(bot=>`<button data-run-skill="${id}" data-target-bot="${bot.id}">${botAvatar(bot)}<span><strong>${esc(bot.name)}</strong><small>${esc(bot.role)}</small></span>${icon('arrow')}</button>`).join('')}</div>${choices.length?'':'<div class="empty"><h3>没有可用的智能体</h3><p>请给 Bot 配置此技能，并确认运行环境可用。</p><button class="btn" data-page="Bot" data-close-dialog="true">管理智能体</button></div>'}`);
  }
  /** 编辑事项文字与负责人，保留业务状态及讨论。@returns {void} 打开当前事项表单。 */
  function editItem() {
    if (!editable()) return; const row = data.rows.find(r => r.id === state.selected); if (!row) return;
    dialog(`编辑 ${row.id}`,`<form id="item-edit-form" data-item-id="${row.id}"><div class="form-grid"><label class="field full">标题<input name="title" required maxlength="80" value="${esc(row.title)}"></label><label class="field">负责人<select name="owner">${options(people,row.owner)}</select></label><label class="field">协作成员<select name="collaborators">${options(['未指定',...people],row.collaborators || '未指定')}</select></label><label class="field full">说明<textarea name="description" required maxlength="3000">${esc(row.description)}</textarea></label><label class="field full">外部文档<input name="external" type="url" value="${esc(row.external)}" placeholder="https://…"></label><label class="field full">关联 PR（可选）<select name="pr"><option value="">不关联</option>${pullRequests().map(pr => `<option value="${pr.id}" ${row.pr === pr.id ? 'selected' : ''}>#${pr.id} · ${esc(pr.title)}</option>`).join('')}</select></label></div><p class="field-error" role="alert"></p><div class="form-actions">${button('close-modal','取消')}<button class="btn primary">保存</button></div></form>`);
  }
  /** 展示当前服务的版本事实与可下载清单。@param {string} service 服务名称。@param {boolean} environment 是否查看环境。@returns {void} 打开详情，不执行发布。 */
  function deliveryDetail(service,environment = false) {
    const index = project().services.indexOf(service); if (index < 0) return;
    const versions = serviceVersions(service);
    dialog(`${service} · ${environment ? '环境版本' : '构建产物'}`,`<dl class="properties"><dt>服务</dt><dd>${esc(service)}</dd><dt>最新产物</dt><dd>${esc(versions.artifact)}</dd><dt>测试环境</dt><dd>${esc(versions.test)}</dd><dt>生产环境</dt><dd>${esc(versions.production)}</dd><dt>关联提交</dt><dd>a7c92e1</dd></dl><p class="info-box">构建产物与运行版本分别记录。运维核对更新环境版本，原型未包含真实安装包或环境访问地址。</p><div class="form-actions"><button class="btn" data-manifest="${esc(service)}">下载版本清单</button>${button('close-modal','关闭')}</div>`);
  }
  /** 将页面上下文编码到地址栏，使刷新和浏览器返回可恢复位置。@returns {void} 仅在路由变化时追加历史。 */
  function syncRoute() {
    if (routeRestoring) return;
    const url = new URL(location.href); url.searchParams.delete('view'); url.searchParams.set('page',state.page);
    for (const key of ['project','tab','item','section','target','bot','agent']) url.searchParams.delete(key);
    if (state.page === 'project') { url.searchParams.set('project',state.project); url.searchParams.set('tab',state.tab); if (state.selected) url.searchParams.set('item',state.selected); if (state.tab === 'bots' && currentBot()) url.searchParams.set('bot',currentBot().id); }
    if (state.page === 'Skills') { url.searchParams.set('section',state.skillTab); url.searchParams.set('target',state.templateProject); }
    if (state.page === 'Bot' && state.botDetail) url.searchParams.set('agent',state.botDetail);
    workspace?.syncRoute(url);
    if (url.href !== location.href) { if (routeInitialized) history.pushState(null,'',url); else history.replaceState(null,'',url); }
    routeInitialized = true;
  }
  /** 恢复受支持的路由；未知资源回到可用项目并提供反馈。@returns {void} 更新内存状态，不读取远端。 */
  function readRoute() {
    const query = new URLSearchParams(location.search), view = query.get('view'), page = query.get('page');
    state.page = ['collaboration','projects','project','Bot','Skills','operations','variables','memory','connections','vault','team-admin'].includes(page) ? page : view === 'agents' ? 'Bot' : view === 'project-bots' ? 'project' : 'collaboration';
    state.project = projects.some(p => p.id === query.get('project')) ? query.get('project') : projects[0].id;
    state.tab = ['需求','Bug','代码','PR','流水线','产物与版本','bots','环境变量'].includes(query.get('tab')) ? query.get('tab') : '需求';
    state.selected = data.rows.some(r => r.id === query.get('item') && r.project === state.project && r.kind === state.tab) ? query.get('item') : null;
    state.skillTab = query.get('section') === 'AGENTS.md 模板' ? 'AGENTS.md 模板' : '技能库';
    state.templateProject = projects.some(p => p.id === query.get('target')) ? query.get('target') : state.project;
    state.activeBot = data.bots.some(b => b.id === query.get('bot')) ? query.get('bot') : 'product';
    state.menu = false; state.botDetail = data.bots.some(b => b.id === query.get('agent')) ? query.get('agent') : null;
    workspace?.readRoute(query);
  }

  /** 分派显式按钮操作。@param {string} action 操作名。@returns {void} 执行本地交互。 */
  function action(action) {
    if (action === 'clear-projects') { state.projectQuery = ''; state.projectFilter = '全部'; render(); return; }
    if (action === 'clear-templates') { state.templateQuery = ''; render(); return; }
    if (action === 'clear-prs') { state.prQuery = ''; state.prFilter = '全部'; render(); return; }
    if (action === 'project-settings') { projectSettings(state.project); return; }
    if (action === 'new-template') { editTemplate(); return; }
    if (action === 'edit-item') { editItem(); return; }
    if (action === 'copy-file') { void copyText(fileContent()); return; }
    if (action === 'download-file') { downloadText(state.file.split('/').at(-1),fileContent()); return; }

    if (action === 'new-bot') { editBot(); return; }
    if (action === 'new-project-bot') { editBot('',true); return; }
    if (action === 'add-project-bot') { addProjectBot(); return; }
    if (action === 'project-bot-settings') { projectBotSettings(); return; }
    if (action === 'close-bot-detail') { state.botDetail = null; render(); return; }
    if (action === 'clear-bots') { state.botQuery = ''; state.botFilter = '全部智能体'; render(); return; }
    if (action === 'toggle-roster') { state.rosterOpen = !state.rosterOpen; render(); return; }
    if (action === 'mention-open') { openMentions(); return; }
    if (action === 'new-skill') { editSkill(); return; }
    if (action === 'clear-skills') { state.skillQuery = ''; state.skillCategory = '全部'; render(); return; }
    if (action === 'new-chat') { if (!canChat()) return; delete state.threadByProject[threadKey()]; state.mentionQuery = null; state.chatError = ''; render(); document.getElementById('bot-message').focus(); persist(); return; }
    if (action === 'chat-history') {
      const threads = state.threads.filter(thread => thread.project === state.project && thread.botId === currentBot()?.id && thread.messages.length);
      dialog('对话历史',threads.length ? `<div class="history-list">${threads.map(thread => `<button data-thread="${thread.id}">${botAvatar(data.bots.find(bot => bot.id === thread.botId),'small')}<span>${esc(thread.title)}</span>${icon('down')}</button>`).join('')}</div>` : '<div class="empty"><p>还没有对话</p></div>'); return;
    }
    if (action === 'close-modal') { requestDialogClose(); return; }
    if (action === 'keep-editing') { modal.querySelector('.discard-confirm')?.remove(); return; }
    if (action === 'discard-editing') { modal.close(); return; }
    if (action === 'new') { newItem(); return; }
    if (action === 'settings') { settings(); return; }
    if (action === 'remote') { info('打开代码平台（演示）',`正式接入后，这里将打开 ${project().provider} 上已授权仓库 ${project().repo} 的对应页面。本原型使用虚构仓库，不会跳转或发送凭据。`); return; }
    if (action === 'test') { testDialog(); return; }
    if (action === 'commit') { info('提交 a7c92e1（示例）','林然 · 完善成员权限校验。正式接入后展示来自当前仓库的真实提交、文件差异与关联 PR。'); return; }
    if (action === 'issue') { info('远端 Issue #18（示例）','远端状态：Open。本地业务状态单独维护；Issue 关闭不会自动标记回归通过。具体映射方式仍待确认。'); return; }
    if (action === 'connect') { connectProject(); return; }
    if (action === 'reset-confirm') { dialog('重置演示数据？',`<div class="info-box">此操作只重置本浏览器中的原型记录，不涉及真实项目、仓库或数据库。</div><div class="form-actions">${button('close-modal','取消')}${button('reset','确认重置','','btn primary')}</div>`); return; }
    if (action === 'reset') { if (!editable()) return; try { localStorage.removeItem(storageKey); location.href = location.pathname+'?v=20261107-8'; } catch (error) { toast('无法清除本地数据，请检查浏览器存储权限'); } return; }
    if (action === 'close-detail') state.selected = null;
    if (action === 'expand') state.expanded = !state.expanded;
    if (action === 'menu') state.menu = !state.menu;
    if (action === 'clear') { state.filter = '全部'; state.owner = '全部负责人'; state.query = ''; }
    if (action === 'retry') { state.failure = false; toast('演示连接已恢复'); }
    if (action === 'branch-file') { const row = data.rows.find(r => r.id === state.selected); state.tab = '代码'; state.branch = row?.branch || 'main'; state.file = 'src/api.ts'; state.selected = null; }
    render();
  }
  // 使用事件委托，重绘后仍保持按钮和表单可用；输入内容只按文本保存。
  document.addEventListener('click', event => {
    const target = event.target.closest('button'); if (target?.dataset.work) return; if (event.target.closest('[data-copy-code],[data-download-code]')) return; if (!target || Object.keys(target.dataset).length === 0) return;
    event.preventDefault();
    if (target.dataset.documentCopy || target.dataset.documentLink || target.dataset.documentDownload || target.dataset.documentEdit || target.dataset.documentDuplicate) {
      const id = target.dataset.documentCopy || target.dataset.documentLink || target.dataset.documentDownload || target.dataset.documentEdit || target.dataset.documentDuplicate;
      const t = agentTemplates.find(item => item.id === id); if (!t) return;
      if (target.dataset.documentCopy) void copyText(t.content);
      if (target.dataset.documentLink) void copyText(templateLink(t));
      if (target.dataset.documentDownload) downloadText('AGENTS.md',t.content);
      if (target.dataset.documentEdit) editTemplate(id);
      if (target.dataset.documentDuplicate) editTemplate(id,true);
      return;
    }
    if (target.dataset.projectSettings) { projectSettings(target.dataset.projectSettings); return; }
    if (target.dataset.projectTemplate) { state.templateProject = target.dataset.projectTemplate; templateDetail(data.projectTemplates[state.templateProject] || agentTemplates[0].id); return; }
    if (target.dataset.activityDate) {
      const visible = projects.filter(p => (state.projectFilter === '全部' || p.status === state.projectFilter) && `${p.name} ${p.repo} ${p.owner}`.toLowerCase().includes(state.projectQuery.toLowerCase()));
      const day = activityDays(visible).find(d => d.date === target.dataset.activityDate); if (!day || day.future) return;
      dialog(`${day.date} · 活动详情`, `<p class="small quiet">${visible.length} 个项目 · 示例数据</p><div class="activity-breakdown">${Object.entries(day.counts).filter(([source]) => state.activitySource === '全部' || state.activitySource === source).map(([source,count]) => `<div><span>${source}</span><strong>${count}</strong></div>`).join('')}</div><p class="small muted">${day.total ? '当天共 '+day.total+' 次活动。' : '当天没有活动。'}</p><div class="form-actions">${button('close-modal','关闭')}</div>`); return;
    }
    if (target.dataset.projectJump) { selectProject(target.dataset.projectJump); state.tab = target.dataset.jumpTab; if (['需求','Bug'].includes(state.tab)) state.filter = '未完成'; if (state.tab === 'PR') state.prFilter = '待审核'; render(); return; }
    if (target.dataset.runSkill) { useSkill(target.dataset.runSkill,target.dataset.targetBot); persist(); return; }
    if (target.dataset.skillCopy || target.dataset.skillDownload) { const skill = data.library.find(item => item.id === (target.dataset.skillCopy || target.dataset.skillDownload)); if (skill) { const text = `# ${skill.name}\n\n${skill.instructions}`; if (target.dataset.skillCopy) void copyText(text); else downloadText('SKILL.md',text); } return; }
    if (target.dataset.linkedItem) { const row = data.rows.find(r => r.id === target.dataset.linkedItem && r.project === state.project); if (row) { modal.close(); state.tab = row.kind; state.selected = row.id; render(); } return; }
    if (target.dataset.manifest) { downloadText('versions.json',JSON.stringify({project:project().repo,service:target.dataset.manifest,...serviceVersions(target.dataset.manifest),demo:true},null,2)); return; }
    if (target.dataset.botFilter) { state.botFilter = target.dataset.botFilter; render(); return; }
    if (target.dataset.botDetail) { state.botDetail = target.dataset.botDetail; state.botDetailTab = '配置'; render(); return; }
    if (target.dataset.agentDetailTab) { state.botDetailTab = target.dataset.agentDetailTab; render(); return; }
    if (target.dataset.editBot) { editBot(target.dataset.editBot); return; }
    if (target.dataset.globalBind) {
      if (!editable()) return; const bot = data.bots.find(item => item.id === target.dataset.globalBind);
      dialog('加入项目',`<div class="project-chat-picker">${projects.filter(p => bot.scope === 'team' || bot.scope === p.id).map(p => {const bound = data.bindings.some(binding => binding.botId === bot.id && binding.projectId === p.id);return `<button data-bind-bot="${bot.id}" data-binding-project="${p.id}" ${bound || !bot.enabled ? 'disabled' : ''}>${icon('folder')}<span><strong>${esc(p.name)}</strong><small>${esc(p.repo)}</small></span><span class="small">${bound ? '已加入' : '添加'}</span></button>`;}).join('')}</div>`); return;
    }
    if (target.dataset.globalChat) { globalChat(target.dataset.globalChat); return; }
    if (target.dataset.selectAgent) { selectBot(target.dataset.selectAgent); return; }
    if (target.dataset.botGlobal) { modal.close(); state.page = 'Bot'; state.botDetail = target.dataset.botGlobal; state.botDetailTab = '配置'; render(); return; }
    if (target.dataset.toggleBot) { if (!editable()) return; const bot = data.bots.find(item => item.id === target.dataset.toggleBot); bot.enabled = !bot.enabled; persist(); render(); toast(bot.enabled ? '已全局启用' : '已全局停用，历史记录保留'); return; }
    if (target.dataset.openAgent) { modal.close(); state.project = target.dataset.agentProject; state.page = 'project'; state.tab = 'bots'; state.selected = null; selectBot(target.dataset.openAgent); return; }
    if (target.dataset.bindBot) { if (!editable()) return; const bot = data.bots.find(item => item.id === target.dataset.bindBot), projectId = target.dataset.bindingProject || state.project; if (!bot?.enabled || data.bindings.some(binding => binding.botId === bot.id && binding.projectId === projectId) || !['team',projectId].includes(bot.scope)) return; data.bindings.push({botId:bot.id,projectId,enabled:true,repoAccess:true,skills:[...bot.skills],notes:''}); persist(); modal.close(); if (target.dataset.bindingProject) render(); else selectBot(bot.id); toast('已加入项目'); return; }
    if (target.dataset.unbindBot) { if (!editable()) return; data.bindings = data.bindings.filter(binding => !(binding.botId === target.dataset.unbindBot && binding.projectId === state.project)); persist(); modal.close(); state.activeBot = ''; render(); toast('已从项目移除，历史记录保留'); return; }
    if (target.dataset.reference) { insertReference(target.dataset.reference); return; }
    if (target.dataset.mentionCategory) { state.mentionCategory = target.dataset.mentionCategory; state.mentionIndex = 0; refreshMentions(); document.getElementById('bot-message').focus(); return; }
    if (target.dataset.skillTab) { state.skillTab = target.dataset.skillTab; render(); return; }
    if (target.dataset.skillCategory) { state.skillCategory = target.dataset.skillCategory; render(); return; }
    if (target.dataset.skillDetail) { skillDetail(target.dataset.skillDetail); return; }
    if (target.dataset.editSkill) { editSkill(target.dataset.editSkill); return; }
    if (target.dataset.toggleSkill) { if (!editable()) return; const skill = data.library.find(item => item.id === target.dataset.toggleSkill); skill.enabled = !skill.enabled; persist(); render(); skillDetail(skill.id); return; }
    if (target.dataset.useSkill) { chooseSkillTarget(target.dataset.useSkill); return; }
    if (target.dataset.template) { templateDetail(target.dataset.template); return; }
    if (target.dataset.applyTemplate) { if (!editable()) return; data.projectTemplates[state.templateProject] = target.dataset.applyTemplate; persist(); modal.close(); render(); toast(`已为${projects.find(p => p.id === state.templateProject)?.name}选用模板`); return; }
    if (target.dataset.thread) { state.threadByProject[threadKey()] = target.dataset.thread; state.mentionQuery = null; modal.close(); render(); return; }
    if (target.dataset.prompt) {
      if (!canChat()) { toast('当前智能体不可用'); return; }
      const refs = references(), repo = refs.find(ref => ref.type === '仓库'), pr = refs.find(ref => ref.type === 'PR');
      if ((target.dataset.prompt === 'progress' && !repo) || (target.dataset.prompt === 'review' && !pr)) { toast('当前智能体没有可引用的资源，请先检查项目授权'); return; }
      const drafts = {progress:`${repo?.token || ''} 帮我梳理当前项目进展`,review:`${pr?.token || ''} 帮我整理评审重点`,skills:'@skill/'};
      conversation().draft = drafts[target.dataset.prompt]; state.mentionQuery = target.dataset.prompt === 'skills' ? 'skill/' : null; state.mentionCategory = '全部'; state.mentionIndex = 0; render(); const input = document.getElementById('bot-message'); input.focus(); input.setSelectionRange(input.value.length,input.value.length); persist(); return;
    }
    if (target.dataset.action) { action(target.dataset.action); return; }
    if (target.dataset.page) { modal.close(); state.botDetail = null; state.page = target.dataset.page; state.menu = false; state.selected = null; }
    if (target.dataset.project) { selectProject(target.dataset.project); return; }
    if (target.dataset.tab) { state.tab = target.dataset.tab; state.selected = null; state.filter = '全部'; state.owner = '全部负责人'; state.query = ''; }
    if (target.dataset.item) { state.selected = target.dataset.item; state.detailTab = '讨论'; }
    if (target.dataset.detailTab) state.detailTab = target.dataset.detailTab;
    if (target.dataset.filter) state.filter = target.dataset.filter;
    if (target.dataset.file) state.file = target.dataset.file;
    if (target.dataset.pr) { openPr(target.dataset.pr); return; }
    if (target.dataset.environment) { deliveryDetail(target.dataset.environment,true); return; }
    if (target.dataset.artifact) { deliveryDetail(target.dataset.artifact); return; }
    render();
  });
  document.addEventListener('change', event => {
    const el = event.target;
    if (modal.open && el.closest('#modal form')) modal.dataset.dirty = 'true';
    const key = el.dataset.change;
    if (key === 'templateProject') state.templateProject = el.value;
    if (key === 'templateDialogProject') { state.templateProject = el.value; templateDetail(modal.dataset.templateId); return; }
    if (['projectFilter','prFilter','activitySource'].includes(key)) state[key] = el.value;
    if (key === 'project') { selectProject(el.value); return; }
    if (key === 'status') { if (!editable()) { render(); return; } const row = data.rows.find(item => item.id === state.selected); if (el.value === '待提测' || el.value === '测试中') { testDialog(el.value); render(); } else updateStatus(row,el.value); return; }
    if (key === 'owner') state.owner = el.value;
    if (key === 'branch') state.branch = el.value;
    if (key === 'role') { state.role = el.value; toast(`已切换为${el.value}演示模式`); }
    if (key === 'failure') state.failure = el.checked;
    if (key) render();
  });
  document.addEventListener('input', event => {
    if (modal.open && event.target.closest('#modal form')) modal.dataset.dirty = 'true';
    const queryFields = {'project-search':'projectQuery','template-search':'templateQuery','pr-search':'prQuery'};
    if (queryFields[event.target.id]) { state[queryFields[event.target.id]] = event.target.value; render(); return; }
    if (event.target.id === 'item-search') { state.query = event.target.value; render(); }
    if (event.target.id === 'bot-search') { state.botQuery = event.target.value; render(); }
    if (event.target.id === 'roster-search') { state.rosterQuery = event.target.value; render(); }
    if (event.target.id === 'skill-search') { state.skillQuery = event.target.value; render(); }
    if (event.target.id === 'bot-message') {
      conversation().draft = event.target.value; persist();
      const match = event.target.value.slice(0,event.target.selectionStart).match(/@([^\s@]*)$/);
      state.mentionQuery = match ? match[1] : null; state.mentionCategory = '全部'; state.mentionIndex = 0;
      state.chatError = ''; document.getElementById('chat-error').textContent = ''; refreshMentions();
    }
  });
  document.addEventListener('submit', event => {
    const form = event.target; const formId = form.getAttribute('id'); if (!['new-form','test-form','comment-form','chat-form','connect-form','skill-form','bot-form','binding-form','template-form','project-settings-form','project-create-form','item-edit-form'].includes(formId)) return;
    event.preventDefault(); if (!editable()) return;
    const values = new FormData(form);
    if (formId === 'template-form') {
      const name = String(values.get('name')).trim(), tag = String(values.get('tag')).trim(), content = String(values.get('content')).trim();
      if (!name || !tag || !content) { form.querySelector('.field-error').textContent = '名称、分类和正文不能为空。'; return; }
      const existing = agentTemplates.find(t => t.id === form.dataset.templateId);
      if (agentTemplates.some(t => t.id !== existing?.id && t.name === name)) { form.querySelector('.field-error').textContent = '模板名称已存在。'; return; }
      const fields = {name,tag,content,description:String(values.get('description')).trim()};
      const id = existing?.id || `template-${Date.now()}`;
      if (existing) Object.assign(existing,fields,{version:Number(existing.version)+1});
      else agentTemplates.push({id,...fields,version:1});
      data.templates = agentTemplates; persist(); render(); templateDetail(id); toast('模板已保存'); return;
    }
    if (formId === 'project-settings-form') {
      const p = projects.find(item => item.id === form.dataset.projectId), name = String(values.get('name')).trim();
      if (!name) { form.querySelector('.field-error').textContent = '项目名称不能为空。'; return; }
      Object.assign(p,{name,status:String(values.get('status')),owner:String(values.get('owner')),description:String(values.get('description')).trim()}); persist(); modal.close(); render(); toast('项目设置已保存'); return;
    }
    if (formId === 'project-create-form') {
      const name = String(values.get('name')).trim(), repo = String(values.get('repo')).trim(), provider = String(values.get('provider'));
      if (!name || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) { form.querySelector('.field-error').textContent = '请填写项目名称和 owner/repository 格式的仓库路径。'; return; }
      const existing = projects.find(p => p.repo.toLowerCase() === repo.toLowerCase() && p.provider === provider);
      if (existing) { modal.close(); selectProject(existing.id); toast('仓库已关联，已进入现有项目'); return; }
      const id = `project-${Date.now()}`; projects.push({id,name,repo,provider,services:[],owner:String(values.get('owner')),description:'',status:'计划中'}); data.projectRecords = projects;
      persist(); modal.close(); selectProject(id); toast('已保存项目关联（本地演示）'); return;
    }
    if (formId === 'item-edit-form') {
      const row = data.rows.find(item => item.id === form.dataset.itemId), title = String(values.get('title')).trim(), description = String(values.get('description')).trim(), external = String(values.get('external')).trim();
      if (!title || !description || external && !/^https?:\/\//i.test(external)) { form.querySelector('.field-error').textContent = '请填写标题和说明，文档链接仅支持 HTTP / HTTPS。'; return; }
      const linkedPr = pullRequests().find(pr => pr.id === values.get('pr'));
      Object.assign(row,{title,description,external,pr:linkedPr?.id || '',branch:linkedPr?.branch || 'main',owner:String(values.get('owner')),collaborators:values.get('collaborators') === '未指定' ? '' : String(values.get('collaborators'))}); row.activity.unshift('林然 · 修改了事项内容'); persist(); modal.close(); render(); toast('事项已保存'); return;
    }
    if (formId === 'bot-form') {
      const name = String(values.get('name')).trim(), role = String(values.get('role')).trim(), instructions = String(values.get('instructions')).trim();
      const id = form.dataset.editId, existing = data.bots.find(bot => bot.id === id);
      if (!name || !role || !instructions || /[\s@，。！？、；：()（）]/.test(name)) { form.querySelector('.field-error').textContent = '请填写完整内容；名称不能包含空格、@ 或分隔符，以便在对话中引用。'; return; }
      if (data.bots.some(bot => bot.id !== id && bot.name === name)) { form.querySelector('.field-error').textContent = '名称已存在，请使用不同名称。'; return; }
      const runtime = String(values.get('runtime')), skills = values.getAll('skills').filter(id => data.library.some(skill => skill.id === id));
      const fields = {name,role,instructions,owner:String(values.get('owner')),mark:String(values.get('mark')),runtime,online:runtime === '团队执行器',model:String(values.get('model')),skills};
      if (existing) { Object.assign(existing,fields); data.bindings.filter(binding => binding.botId === id).forEach(binding => { binding.skills = binding.skills.filter(skill => skills.includes(skill)); }); }
      else { const newId = `bot-${Date.now()}`, scope = 'team'; data.bots.push({id:newId,...fields,scope,enabled:true,lastActive:'尚未运行'}); if (scope !== 'team') data.bindings.push({botId:newId,projectId:scope,enabled:true,repoAccess:true,skills:[...skills],notes:''}); state.botDetail = newId; if (form.dataset.scoped === 'true') state.activeBot = newId; }
      persist(); modal.close(); render(); toast(existing ? '智能体配置已保存' : '智能体已创建');
    }
    if (formId === 'binding-form') {
      const bot = currentBot(), binding = bindingFor(bot.id); binding.enabled = values.has('enabled'); binding.repoAccess = values.has('repoAccess'); binding.skills = values.getAll('skills').filter(id => bot.skills.includes(id)); binding.notes = String(values.get('notes')).trim(); persist(); modal.close(); state.mentionQuery = null; render(); toast('项目配置已保存');
    }
    if (formId === 'skill-form') {
      const fields = Object.fromEntries(['id','name','category','description','instructions','version'].map(key => [key,String(values.get(key)).trim()]));
      const editing = form.dataset.editId;
      if (Object.values(fields).some(value => !value) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(fields.id) || !/^\d+\.\d+\.\d+$/.test(fields.version)) { form.querySelector('.field-error').textContent = '请填写有效内容，调用标识使用小写字母、数字和短横线。'; return; }
      if (!editing && data.library.some(skill => skill.id === fields.id)) { form.querySelector('.field-error').textContent = '调用标识已存在，请换一个标识。'; return; }
      if (editing) { const skill = data.library.find(item => item.id === editing); Object.assign(skill,fields,{id:editing}); }
      else data.library.unshift({...fields,source:'团队维护',enabled:true});
      persist(); modal.close(); state.skillQuery = ''; state.skillCategory = '全部'; render(); toast(editing ? '技能已保存' : '技能已发布到团队');
    }
    if (formId === 'new-form') {
      const title = values.get('title').trim(), description = values.get('description').trim(), external = values.get('external').trim();
      if (!title || !description || external && !/^https?:\/\//i.test(external)) { form.querySelector('.field-error').textContent = '请填写有效标题和说明，外部文档仅支持 HTTP / HTTPS 地址。'; return; }
      const kind = values.get('kind'); const number = Math.max(29,...data.rows.map(row => Number(row.id.split('-')[1]))) + 1;
      const id = `${kind === 'Bug' ? 'BUG' : 'PRD'}-${String(number).padStart(3,'0')}`;
      data.rows.unshift({ id, kind, project: state.project, title, description, owner: values.get('owner'), collaborators: values.get('collaborators') === '未指定' ? '' : values.get('collaborators'), external, tester: '', status: '待开始', pr: '', branch: 'main', comments: [], activity: ['林然 · 刚刚创建了事项。'] });
      state.tab = kind; state.selected = id; state.query = ''; state.filter = '全部'; state.owner = '全部负责人'; state.detailTab = '讨论'; persist(); modal.close(); render(); toast('事项已创建并保存在本浏览器');
    }
    if (formId === 'test-form') { const row = data.rows.find(item => item.id === state.selected); row.tester = values.get('tester'); modal.close(); updateStatus(row,form.dataset.next); }
    if (formId === 'comment-form') {
      const row = data.rows.find(item => item.id === state.selected), text = values.get('comment').trim(); if (!text) return;
      row.comments.push({ author: '林然', text, time: '刚刚' }); row.activity.unshift('林然 · 刚刚添加了讨论。');
      if (/@(bot|项目助手)/i.test(text)) row.comments.push({ author: '项目助手', text: `【模拟回复】当前事项「${row.title}」处于${row.status}，${row.pr ? `关联 PR #${row.pr}` : '尚未关联 PR'}。建议补充验收标准与测试交付说明。未执行任何外部操作。`, time: '刚刚', bot: true });
      state.detailTab = '讨论'; persist(); render(); toast('讨论已保存'); app.querySelector('.detail-scroll').scrollTop = 100000;
    }
    if (formId === 'chat-form') sendBotMessage(values.get('message').trim());
    if (formId === 'connect-form') { modal.close(); selectProject(values.get('repo')); toast('已进入关联的示例项目，未创建远端仓库'); }
  });
  document.addEventListener('keydown', event => {
    if (event.target.id === 'bot-message' && !event.isComposing) {
      if (state.mentionQuery !== null && ['ArrowDown','ArrowUp'].includes(event.key)) { event.preventDefault(); const count = mentionResults().length; if (count) state.mentionIndex = (state.mentionIndex + (event.key === 'ArrowDown' ? 1 : count-1)) % count; refreshMentions(); document.getElementById(`mention-${state.mentionIndex}`)?.scrollIntoView({block:'nearest'}); return; }
      if (state.mentionQuery !== null && event.key === 'Escape') { event.preventDefault(); state.mentionQuery = null; refreshMentions(); return; }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (state.mentionQuery !== null) { const ref = mentionResults()[state.mentionIndex]; if (ref) insertReference(ref.token); } else document.getElementById('chat-form').requestSubmit(); return; }
    }
    if (event.key === 'Escape' && !modal.open) { state.botDetail = null; state.selected = null; state.menu = false; render(); }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !modal.open) { event.preventDefault(); if (state.page !== 'project' || !['需求','Bug'].includes(state.tab)) { state.page = 'project'; state.tab = '需求'; render(); } document.getElementById('item-search')?.focus(); }
  });
  modal.addEventListener('cancel', event => { event.preventDefault(); requestDialogClose(); });
  loadInteractionData();
  workspace = createTeamWorkspace({data,state,projects,esc,icon,botAvatar,options,dialog,toast,persist,render,editable,modal,closeDialog:requestDialogClose,enhanceSelects:enhanceProjectSelects,skills:()=>data.library,templateName:id=>(agentTemplates.find(t=>t.id===data.projectTemplates[id])||agentTemplates[0]).name,newBot:()=>editBot()});
  const moduleContext={data,state,projects,esc,icon,botAvatar,options,dialog,toast,persist,render,modal,editable,teamContext};
  teamAdmin=createTeamAdmin(moduleContext);
  vault=createVault(moduleContext);
  readRoute();
  window.addEventListener('popstate', () => { modal.close(); readRoute(); routeRestoring = true; render(); routeRestoring = false; });
  render();
})();
