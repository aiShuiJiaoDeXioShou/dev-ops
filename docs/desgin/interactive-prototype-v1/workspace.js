import {createChatViews} from './modules/chat.js?v=20261108-30';
import {createOperationsView} from './modules/operations.js?v=20261108-30';
import {createAiChat} from './modules/ai-chat.js?v=20261108-30';
import {createAnnotationTool} from './modules/annotation.js?v=20261108-30';
/* 持续协作原型使用本地状态；所有外部执行、通知和凭据使用均为演示。 */
/** 创建协作、运维与环境配置界面。@param {object} ctx 原型共享数据、渲染及表单工具。@returns {object} 页面渲染、路由和交互接口；不会请求外部服务。 */
export function createTeamWorkspace(ctx) {
  const {data,state,projects,esc,icon,botAvatar,options,dialog,toast,persist,render,editable,modal} = ctx;
  const envs = ['开发','测试','生产'];
  const stamp = () => new Date().toLocaleString('zh-CN',{hour12:false});
  const uid = prefix => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
  const ui = {room:'direct-product',task:'',view:'会话',chatTab:'对话',traceRun:'',ops:'运行概况',project:'dev-ops',env:'测试',query:'',settings:false,memory:'dev-ops',createMenu:false};
  if (!data.workspace || data.workspace.version !== 1) data.workspace = {
    version:1,
    rooms:projects.map(p => ({id:`group-${p.id}`,project:p.id,name:p.name+'协作组',leader:'product',type:'group',draft:'',messages:p.id === 'dev-ops' ? [{who:'小李',text:'登录异常已建立排查任务。小林负责分析，林然负责验收。开发交付后，我会核对发布条件。',time:'09:42'}] : []})),
    tasks:[{id:'task-login',room:'group-dev-ops',project:'dev-ops',issue:'BUG-018',title:'排查登录后权限未刷新',owner:'林然',executor:'engineer',phase:'进行中',environment:'测试',source:'日志事件',note:'登录后出现旧权限，核对 token 刷新与权限缓存。',events:['09:40 · 登录异常聚合为一个问题','09:42 · 小李交给小林排查'],references:['@repo/team/dev-ops','@BUG-018'],handoff:null,requiredKey:null}],
    incidents:[],operations:[],notifications:[],audit:[],
    rules:[{id:'watch-login',project:'dev-ops',name:'API 登录异常巡检',type:'日志告警',environment:'测试',enabled:true,bot:'engineer',frequency:'每 5 分钟',detail:'同类错误 5 分钟内超过 10 次时聚合。',last:'尚未演示触发'},{id:'watch-disk',project:'dev-ops',name:'服务器磁盘巡检',type:'定时巡检',environment:'生产',enabled:false,bot:'delivery',frequency:'每天 09:00',detail:'检查磁盘与缓存占用，生成清理建议。',last:'尚未演示触发'}],
    variables:[{id:'env-api',project:'dev-ops',environment:'测试',name:'API_BASE_URL',type:'变量',value:'https://api.test.example.com',mode:'运行时注入',bots:['engineer'],configured:true,version:1,enabled:true,updated:'初始示例',expires:'长期有效'}],
    memories:[{id:'memory-api',project:'dev-ops',bot:'engineer',text:'权限修复需要覆盖登录后首次请求与 token 刷新两种场景。',source:'团队确认',confirmed:true,updated:'初始示例'}],
    connections:[{id:'github',name:'GitHub',kind:'代码平台',endpoint:'github.com',status:'示例连接'},{id:'gitea',name:'Gitea',kind:'代码平台',endpoint:'git.example.com',status:'待接入'},{id:'logs',name:'日志服务',kind:'监控',endpoint:'logs.example.com',status:'示例连接'},{id:'feishu',name:'飞书',kind:'通知',endpoint:'',status:'待接入'},{id:'aliyun',name:'阿里云',kind:'云资源',endpoint:'RAM 角色 / STS',status:'待接入'}],
    services:[{id:'api-test',project:'dev-ops',name:'API',environment:'测试',version:'v0.5.2-build.17',health:'异常',time:'09:40'},{id:'api-prod',project:'dev-ops',name:'API',environment:'生产',version:'v0.5.1',health:'正常',time:'09:38'},{id:'web-test',project:'dev-ops',name:'Web',environment:'测试',version:'v0.4.2-build.17',health:'正常',time:'09:38'}]
  };
  const db = data.workspace;
  const projectName = id => projects.find(p => p.id === id)?.name || (id?'未知项目':'通用协作');
  const bot = id => data.bots.find(b => b.id === id);
  const members = project => data.bots.filter(b => b.enabled && (!project || data.bindings.some(link => link.projectId === project && link.botId === b.id && link.enabled)));
  const roomMembers = r => data.bots.filter(b=>b.enabled&&r?.members.includes(b.id));
  const roomAvailable = (id,r) => roomMembers(r).some(b=>b.id===id&&b.online);
  const taskAvailable = t => roomAvailable(t.executor,db.rooms.find(r=>r.id===t.room));
  const available = (id,project) => members(project).some(b => b.id === id && b.online);
  // 旧会话迁移为可选项目上下文，原消息、任务及项目授权原样保留。
  data.bots.forEach(b=>{b.scope='team';});
  db.rooms.forEach(r=>{if(!Array.isArray(r.projects))r.projects=r.project?[r.project]:[];if(!Array.isArray(r.members))r.members=r.type==='direct'?[r.leader]:members(r.project).map(b=>b.id);});
  if(!db.rooms.some(r=>r.id==='direct-product'))db.rooms.unshift({id:'direct-product',project:'',projects:[],members:['product'],name:'小李',leader:'product',type:'direct',draft:'',messages:[]});
  if(!Array.isArray(db.toolCalls))db.toolCalls=[];
  if(!Array.isArray(db.codeChanges))db.codeChanges=[];
  if(!db.capabilityGrants)db.capabilityGrants={};
  // 文件夹只做本地分组，历史会话默认不在文件夹中。
  if(!Array.isArray(db.folders))db.folders=[];
  db.rooms.forEach(item=>{if(typeof item.folderId!=='string')item.folderId='';});
  // 工作分类独立于项目关联，历史会话不自动套用项目名作为标签。
  if(!Array.isArray(db.topicTags))db.topicTags=[];
  db.rooms.forEach(item=>{if(!Array.isArray(item.tagIds))item.tagIds=[];if(!Array.isArray(item.attachments))item.attachments=[];});
  db.tasks.forEach(item=>{if(!Array.isArray(item.tagIds))item.tagIds=[];});
  /** 查找或创建工作分类，忽略首尾空格与英文大小写。@param {string} name 分类名称。@param {string} source 创建来源。@param {string} creator 创建者标识。@param {string[]} projectIds 标签关联的项目。@returns {object} 唯一标签记录；仅写入本地原型数据。 */
  function ensureTopic(name,source,creator,projectIds=[]){
    const clean=name.trim(),existing=db.topicTags.find(item=>item.name.toLocaleLowerCase()===clean.toLocaleLowerCase());
    if(existing){existing.projectIds=Array.from(new Set([...(existing.projectIds||[]),...projectIds]));return existing;}
    const tag={id:uid('tag'),name:clean,source,creator,projectIds};db.topicTags.push(tag);return tag;
  }
  /** 模拟 Bot 在任务交付后整理分类；复用已有分类并保留人工标签。@param {object} current 已成功交付的任务。@returns {void} 关联任务及原会话，不授予项目权限；真实语义分类待 Agent 接入。 */
  function organizeTask(current){
    if(current.tagIds?.length)return;
    const content=current.title+' '+(current.handoff?.summary||'');
    const category=[[/权限|登录|认证/,'身份与权限'],[/发布|部署|版本/,'发布交付'],[/数据库|迁移|SQL/i,'数据库维护'],[/日志|异常|巡检|排查/,'异常排查']].find(([pattern])=>pattern.test(content));
    const name=category?category[1]:current.title.replace(/^[@#]/,'').slice(0,24);
    const tag=ensureTopic(name,'bot',current.executor,current.project?[current.project]:[]);
    current.tagIds=[tag.id];
    const target=db.rooms.find(item=>item.id===current.room);
    if(target){target.tagIds=Array.from(new Set([...(target.tagIds||[]),tag.id]));}
    current.events.push(stamp()+' · '+(bot(current.executor)?.name||'Bot')+' 整理标签：'+tag.name);
  }
  // 仅从已有任务标签恢复其项目归属，不把资源引用自动转换为标签。
  db.topicTags.forEach(tag=>{if(!Array.isArray(tag.projectIds))tag.projectIds=Array.from(new Set(db.tasks.filter(t=>(t.tagIds||[]).includes(tag.id)&&t.project).map(t=>t.project)));});
  /** 判断会话或其中任务是否具有归属目标项目的标签。@param {object} current 会话。@param {string} project 项目标识。@returns {boolean} 仅用于展示归集，不扩大资源授权。 */
  function roomMatchesProject(current,project){
    const ids=new Set([...(current.tagIds||[]),...db.tasks.filter(t=>t.room===current.id).flatMap(t=>t.tagIds||[])]);
    return db.topicTags.some(tag=>ids.has(tag.id)&&tag.projectIds.includes(project));
  }
  const room = () => db.rooms.find(r => r.id === ui.room);
  const task = () => db.tasks.find(t => t.id === ui.task);
  const save = () => { persist(); render(); };
  const disabled = () => state.role === '浏览者' ? 'disabled' : '';
  const action = (name,label,id='',cls='btn') => `<button type="button" class="${cls}" data-work="${name}" data-id="${esc(id)}">${label}</button>`;
  const mutator = (name,label,id='',cls='btn') => `<button type="button" class="${cls}" data-work="${name}" data-id="${esc(id)}" ${disabled()}>${label}</button>`;
  const chip = (text,kind='') => `<span class="work-chip ${kind}">${esc(text)}</span>`;
  const empty = (title,body='') => `<div class="empty"><h3>${esc(title)}</h3><p>${esc(body)}</p></div>`;
  const field = (label,body,full=false) => `<label class="field ${full ? 'full' : ''}">${label}${body}</label>`;
  const selectProjects = selected => projects.map(p => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const selectBots = (project,selected,online=false) => members(project).filter(b => !online || b.online).map(b => `<option value="${b.id}" ${b.id === selected ? 'selected' : ''}>${esc(b.name)} · ${esc(b.role)}${b.online ? '' : '（离线）'}</option>`).join('');
  const formEnd = (label='保存') => `<p class="field-error" role="alert"></p><div class="form-actions">${action('close','取消')}<button class="btn primary" ${disabled()}>${label}</button></div>`;
  const log = (text,project='') => { db.audit.unshift({id:uid('audit'),text,project,time:stamp()}); };
  const message = (r,who,text,attachments=[]) => { r.messages.push({who,text,time:stamp(),...(Array.isArray(attachments)&&attachments.length?{attachments}:{})}); };
  const notify = (t,text) => { db.notifications.unshift({id:uid('notice'),task:t?.id || '',project:t?.project || ui.project,text,time:stamp(),read:false}); };
  /** 取得项目共享群组；新项目首次打开时创建唯一群组。@param {string} project 项目标识。@returns {object} 群组记录；仅初始化本地数据。 */
  function ensureRoom(project) {
    let found = db.rooms.find(r => r.projects.includes(project) && r.type === 'group');
    if (!found) { found = {id:db.rooms.some(r=>r.id===`group-${project}`)?uid('group'):`group-${project}`,project,name:projectName(project)+'协作组',leader:members(project)[0]?.id || '',type:'group',projects:[project],members:members(project).map(b=>b.id),draft:'',messages:[]}; db.rooms.push(found); }
    return found;
  }
  /** 打开任务所在的共享会话，统一全局和项目入口。@param {object} current 任务。@returns {void} 改变导航，不复制记录。 */
  function openTask(current) { ui.settings=false;state.page='collaboration';state.selected=null;state.botDetail=null;ui.room=current.room;ui.task=current.id;ui.view='会话';save(); }
  /** 创建可追踪任务，Leader 在会话成员中承接工作，项目工具另行校验授权。@param {object} currentRoom 会话。@param {string} title 任务目标。@param {string} source 来源。@param {string} assignedExecutor 可选明确执行者。@returns {object} 新任务；写本地记录并通知。 */
  function createTask(currentRoom,title,source='对话',assignedExecutor='') {
    const requested = roomMembers(currentRoom).find(b => title.includes('@'+b.name));
    const executor = assignedExecutor || requested?.id || currentRoom.leader;
    const next = {id:uid('task'),room:currentRoom.id,project:currentRoom.project,issue:'',title:title.slice(0,80),owner:'林然',executor,phase:roomAvailable(executor,currentRoom)?'待开始':'受阻',environment:'测试',source,note:title,events:[stamp()+' · 已建立任务'],references:title.match(/@[^\s，。]+/g)||[],handoff:null,requiredKey:null};
    db.tasks.unshift(next);ui.task=next.id;
    message(currentRoom,bot(currentRoom.leader)?.name || '项目协作',roomAvailable(executor,currentRoom)?`已建立任务「${next.title}」，由${bot(executor)?.name}承接。可在任务面板查看、转交或推进。`:'任务已保存，当前负责人不可用，请转交给可用成员。');
    return next;
  }
  /** 输出团队能力二级导航。@param {string} selected 当前子页。@returns {string} 导航 HTML。 */
  function capabilityNav(selected) { return `<nav class="capability-nav" aria-label="团队能力">${[['Bot','智能体'],['Skills','Skills'],['templates','AGENTS.md'],['memory','记忆'],['connections','连接与节点']].map(([id,label])=>action('capability',label,id,`capability-tab ${selected===id?'active':''}`)).join('')}</nav>`; }
  /** 输出紧凑操作栏，页面名称仅供辅助技术识别。@param {string} title 页面名称。@param {string} tools 操作 HTML。@returns {string} 无重复大标题的工具栏。 */
  function heading(title,tools='') {return `<header class="work-page-head compact-page-head ${tools?'':'without-tools'}"><button type="button" class="icon-btn mobile-menu" data-action="menu" aria-label="展开导航">${icon('menu')}</button><h1 class="sr-only">${title}</h1><div class="row">${tools}</div></header>`;}
  /** 输出变量及密钥列表，密钥值不进入原型数据。@param {string} project 项目过滤。@returns {string} 环境配置界面。 */
  function variables(project='') {
    if(project)ui.project=project;
    const vars=db.variables.filter(v=>v.project===ui.project&&v.environment===ui.env);
    return `${heading('环境变量与密钥',action('keychain','团队凭据库')+mutator('variable','新增配置'))}<div class="work-padding"><div class="row work-toolbar">${project?'':`<select class="btn" aria-label="配置项目" data-work-change="vars-project">${selectProjects(ui.project)}</select>`}<div class="segments">${envs.map(env=>action('environment',env,env,`segment ${env===ui.env?'active':''}`)).join('')}</div><span class="spacer"></span>${action('secret-audit','访问记录')}</div><div class="vault-note">${icon('lock')}<span>原型仅保存密钥名称、版本和授权信息。请使用测试值，输入的密钥不会存储或发送。</span></div><div class="table-wrap"><table class="table vault-table"><thead><tr><th>名称 / 类型</th><th>值</th><th>Bot 使用方式</th><th>授权对象</th><th>状态</th><th></th></tr></thead><tbody>${vars.map(v=>`<tr><td><strong>${esc(v.name)}</strong><small>${v.keychainId?'团队凭据库引用':esc(v.type)} · v${v.version}</small></td><td class="mono">${v.type==='密钥'?'••••••••':esc(v.value)}</td><td>${esc(v.mode)}<small>${esc(v.expires)}</small></td><td>${esc(v.bots.map(id=>bot(id)?.name||id).join('、')||'未授权')}</td><td>${chip(v.enabled?'已配置':'已撤销',v.enabled?'success':'')}</td><td>${mutator('variable','管理',v.id,'text-btn')}</td></tr>`).join('')}</tbody></table></div>${vars.length?'':empty('这个环境还没有配置','环境之间不自动继承，避免测试与生产配置混用。')}<div class="row section-heading work-gap"><h2>待配置请求</h2></div>${db.tasks.filter(t=>t.project===ui.project&&t.environment===ui.env&&t.phase==='等待配置').map(t=>`<article class="event-card"><div class="row"><strong>${esc(t.requiredKey)}</strong>${chip(bot(t.executor)?.name||'Bot')}<span class="spacer"></span>${mutator('resolve-secret','配置并授权',t.id,'btn primary')}</div><p>用于「${esc(t.title)}」 · ${esc(t.environment)}环境</p></article>`).join('')||'<p class="small quiet">没有待处理的配置请求。</p>'}</div>`;
  }
  /** 显示记忆来源与人工确认状态。@returns {string} 项目记忆页面。 */
  function memories() {return capabilityNav('memory')+heading('团队记忆',mutator('memory','新增记忆'))+`<div class="work-padding"><div class="work-toolbar"><select class="btn" aria-label="记忆项目" data-work-change="memory-project">${selectProjects(ui.memory)}</select></div>${db.memories.filter(m=>m.project===ui.memory).map(m=>`<article class="memory-card"><div class="row">${botAvatar(bot(m.bot),'small')}<strong>${esc(bot(m.bot)?.name||'团队')}</strong>${chip(m.confirmed?'已确认':'待确认',m.confirmed?'success':'warning')}<span class="spacer"></span>${mutator('memory','编辑',m.id,'text-btn')}${!m.confirmed?mutator('memory-confirm','确认',m.id,'text-btn'):''}${mutator('memory-delete','删除',m.id,'text-btn')}</div><p>${esc(m.text)}</p><small>来源：${esc(m.source)} · ${esc(m.updated)}</small></article>`).join('')||empty('没有项目记忆')}<p class="small quiet">记忆保存长期约定；运行版本和任务状态从对应记录读取。</p></div>`;}
  /** 显示连接配置与执行节点，连接状态仅代表示例。@returns {string} 能力页面。 */
  function connections() {return capabilityNav('connections')+heading('连接与节点')+`<div class="work-padding"><h2>外部连接</h2><div class="connection-grid">${db.connections.map(c=>`<article class="connection-card"><div class="row"><h3>${esc(c.name)}</h3><span class="spacer"></span>${chip(c.status)}</div><p>${esc(c.kind)} · ${esc(c.endpoint||'尚未配置')}</p>${mutator('connection','配置连接',c.id)}</article>`).join('')}</div><h2 class="work-gap">执行节点</h2>${['团队执行器','本地节点'].map(runtime=>`<div class="rule-row"><div><strong>${runtime}</strong><p>${esc(data.bots.filter(b=>b.runtime===runtime).map(b=>b.name).join('、'))}</p></div><span class="spacer"></span>${chip(data.bots.filter(b=>b.runtime===runtime).every(b=>b.online)?'示例在线':'示例离线')}${mutator('node',data.bots.filter(b=>b.runtime===runtime).every(b=>b.online)?'模拟离线':'模拟恢复',runtime)}</div>`).join('')}<div class="vault-note">连接配置只保存地址和引用名称，实际凭据在环境变量与密钥中管理。此原型不会验证或连接外部服务。</div></div>`;}
  /** 展示变量管理表单，不回填密钥；轮换会增加版本号。@param {string} id 配置 ID。@param {object} request 可选任务请求。@returns {void} 打开配置表单。 */
  function variableForm(id='',request=null) {
    const existing=db.variables.find(v=>v.id===id);if(existing?.keychainId){state.page='vault';modal.close();render();toast('此配置来自团队凭据库，请在来源条目管理');return;}const project=request?.project||existing?.project||ui.project, environment=request?.environment||existing?.environment||ui.env;
    dialog(existing?'管理配置':'配置环境变量或密钥',`<form data-work-form="variable" data-id="${existing?.id||''}" data-request="${request?.id||''}" data-project="${project}" data-environment="${environment}"><div class="row small muted">${esc(projectName(project))}${chip(environment)}</div><div class="vault-note">请使用测试值。密钥值只在本次表单输入中存在，保存后立即丢弃；真实保险库尚未接入。</div><div class="form-grid">${field('名称',`<input name="name" required pattern="[A-Z_][A-Z0-9_]*" maxlength="80" value="${esc(existing?.name||request?.requiredKey||'')}" ${existing||request?'readonly':''} placeholder="API_TOKEN">`)}${field('类型',`<select name="type" data-work-change="secret-type" ${existing?'disabled':''}>${options(['密钥','变量'],existing?.type||'密钥')}</select>`)}${field(existing?.type==='密钥'?'新密钥值（留空保留当前版本）':'值',`<input name="value" type="${existing?.type==='变量'?'text':'password'}" autocomplete="new-password" ${existing?'':'required'} maxlength="3000" value="${existing?.type==='变量'?esc(existing.value):''}" placeholder="${existing?.type==='变量'?'配置值':'仅输入测试值'}">`,true)}${field('使用方式',`<select name="mode">${options(['运行时注入','允许 Bot 读取明文'],existing?.mode||'运行时注入')}</select>`)}${field('授权期限',`<select name="expires">${options(['仅当前任务','24 小时','长期有效'],existing?.expires||(request?'仅当前任务':'24 小时'))}</select>`)}<div class="field full"><span>允许使用的 Bot</span><div class="work-checks">${members(project).map(b=>`<label><input type="checkbox" name="bots" value="${b.id}" ${(existing?.bots||[request?.executor]).includes(b.id)?'checked':''}>${botAvatar(b,'tiny')}${esc(b.name)}</label>`).join('')||'<p>项目还没有 Bot，请先添加成员。</p>'}</div></div></div><p class="small muted">运行时注入：执行工具使用密钥，聊天和模型不显示值。明文读取需单独授权，本原型也不回显输入值。</p>${existing?`<div class="row work-gap">${mutator('variable-revoke',existing.enabled?'撤销使用权限':'配置已撤销',existing.id)}<span class="small quiet">当前版本 v${existing.version}</span></div>`:''}${formEnd(existing?'保存配置':'保存并授权')}</form>`);
  }
  /** 展示一次运维变更的审核、执行和验证阶段。@param {object} op 运维记录。@returns {void} 打开变更详情。 */
  function operationDetail(op) {
    dialog(`${op.kind} · ${op.target}`,`<div class="row">${chip(op.environment)}${chip(op.phase)}<span class="spacer"></span><span class="small quiet">本地演示</span></div><dl class="work-properties"><dt>项目</dt><dd>${esc(projectName(op.project))}</dd><dt>目标</dt><dd>${esc(op.target)}</dd><dt>计划</dt><dd>${esc(op.summary)}</dd><dt>版本 / 迁移</dt><dd>${esc(op.version||'不适用')}</dd><dt>核对依据</dt><dd>${esc(op.evidence)}</dd><dt>恢复方案</dt><dd>${esc(op.rollback)}</dd></dl><div class="operation-progress">${['待确认','已批准','执行中','待验证','已完成'].map(s=>chip(s,s===op.phase?'selected':'')).join('')}</div><p class="small muted">不连接服务器、不执行 SQL 或删除文件。以下按钮用于核对交互流程。</p><div class="form-actions">${op.phase==='待确认'?mutator('op-approve','确认此计划',op.id,'btn primary'):''}${op.phase==='已批准'?mutator('op-run','演示执行',op.id,'btn primary'):''}${op.phase==='执行中'?mutator('op-finish','演示执行成功',op.id,'btn primary')+mutator('op-fail','演示执行失败',op.id):''}${op.phase==='待验证'?mutator('op-verify','核对通过',op.id,'btn primary')+mutator('op-fail','核对不通过',op.id):''}${op.phase==='失败'?mutator('op-retry','核对执行状态后重试',op.id):''}${op.phase==='已完成'?mutator('op-notice','生成飞书通知预览',op.id):''}${!['执行中','已完成','已取消'].includes(op.phase)?mutator('op-cancel','取消计划',op.id):''}${action('close','关闭')}</div>`);
  }
  /** 显示仅用于本地演示的操作计划表单。@param {object} t 可选关联任务。@returns {void} 打开具体变更表单。 */
  function operationForm(t=null) {
    dialog(t?'制定发布计划':'新建运维操作',`<form data-work-form="operation" data-task="${t?.id||''}"><div class="form-grid">${field('项目',`<select name="project" ${t?'disabled':''}>${selectProjects(t?.project||ui.project)}</select>`)}${field('目标环境',`<select name="environment">${options(envs,t?.environment||'测试')}</select>`)}${field('操作类型',`<select name="kind">${options(['部署版本','数据库变更','服务器清理','云资源调整'],'部署版本')}</select>`)}${field('服务 / 资源',`<input name="target" required value="API" maxlength="100">`)}${field('版本 / 迁移标识',`<input name="version" required value="${esc(t?.handoff?.artifact||'')}" placeholder="v0.5.3 / 迁移编号" maxlength="120">`,true)}${field('变更计划与范围',`<textarea name="summary" required maxlength="2000" placeholder="说明具体范围；清理需列出目录、文件类型和保留期限">${esc(t?'发布「'+t.title+'」的交付产物':'')}</textarea>`,true)}${field('核对依据',`<textarea name="evidence" required maxlength="1000" placeholder="提交、测试结果；数据库订正需提供影响范围">${esc(t?.handoff?'Commit '+t.handoff.commit+'；'+t.handoff.tests:'')}</textarea>`,true)}${field('恢复方案',`<textarea name="rollback" required maxlength="1000" placeholder="旧版本、备份或补偿方案；不可回滚时说明处理办法"></textarea>`,true)}</div>${formEnd('保存计划')}</form>`);
  }
  const projectTools = [
    {id:'read',name:'读取项目',description:'查看事项与代码关联'},
    {id:'code',name:'修改代码',description:'保存示例分支文件变更'},
    {id:'pipeline',name:'运行流水线',description:'独立触发检查或测试构建'},
    {id:'progress',name:'更新进度',description:'修改事项业务状态'},
    {id:'bug',name:'提交 Bug',description:'建立问题及复现说明'},
    {id:'mr',name:'创建 PR / MR',description:'提交分支变更供评审'},
    {id:'comment',name:'添加评论',description:'向事项补充讨论与证据'}
  ];
  /** 校验指定 Bot 的项目能力，群成员和上下文不能授予权限。@param {string} botId 调用者。@param {string} projectId 目标项目。@param {string} capability 能力标识。@returns {boolean} 是否有有效项目授权；执行时仍需校验在线状态。 */
  function canProject(botId,projectId,capability) {
    const binding=data.bindings.find(link=>link.botId===botId&&link.projectId===projectId);
    if(!bot(botId)?.enabled||!binding?.enabled)return false;
    return capability==='read'?binding.repoAccess:(db.capabilityGrants[botId+':'+projectId]||[]).includes(capability);
  }
  /** 显示独立会话成员表单，不要求先选择项目。@param {object|null} existing 待编辑会话。@returns {void} 打开表单，提交前不修改会话。 */
  function roomForm(existing=null) {
    const ids=existing?.members||['product'];
    dialog(existing?'会话成员与负责人':'新建会话',`<form data-work-form="${existing?'team':'room'}" data-id="${existing?.id||''}"><div class="form-grid">${field('名称',`<input name="name" required maxlength="50" value="${esc(existing?.name||'')}" placeholder="例如：研发协作小组">`,true)}${field('会话类型',`<select name="type"><option value="group" ${existing?.type!=='direct'?'selected':''}>群组</option><option value="direct" ${existing?.type==='direct'?'selected':''}>直接会话</option></select>`)}${field('文件夹',`<select name="folder"><option value="">不放入文件夹</option>${db.folders.map(folder=>`<option value="${folder.id}" ${existing?.folderId===folder.id?'selected':''}>${esc(folder.name)}</option>`).join('')}</select>`)}${field('负责人 / Leader',`<select name="leader">${members('').filter(b=>b.online).map(b=>`<option value="${b.id}" ${b.id===(existing?.leader||'product')?'selected':''}>${esc(b.name)}</option>`).join('')}</select>`)}${field('职责',`<input name="description" maxlength="120" value="${esc(existing?.description||'')}" placeholder="这个会话负责什么">`,true)}${field('指令',`<textarea name="instructions" maxlength="2000" placeholder="协作方式和工作约定">${esc(existing?.instructions||'')}</textarea>`,true)}<div class="field full"><span>参与 Bot</span><div class="work-checks">${members('').map(b=>`<label><input type="checkbox" name="members" value="${b.id}" ${ids.includes(b.id)?'checked':''}>${botAvatar(b,'tiny')}${esc(b.name)}</label>`).join('')}</div></div></div><p class="small muted">成员独立于项目。引用项目和工具授权在“项目与工具”中管理。</p>${formEnd(existing?'保存成员':'创建会话')}</form>`);
  }
  /** 展示会话资源，不把项目上下文当作工具权限。@returns {void} 打开可选的多项目上下文表单。 */
  function contextForm() {
    const r=room();
    dialog('关联项目与工具',`<form data-work-form="context"><p class="small muted">关联项目提供资源引用；项目会话归集由工作标签决定，工具权限单独授权。</p><div class="context-projects">${projects.map(p=>`<label class="context-project"><input type="checkbox" name="projects" value="${p.id}" ${r.projects.includes(p.id)?'checked':''}><span><strong>${esc(p.name)}</strong><small>${esc(p.provider+' · '+p.repo)}</small></span></label>`).join('')}</div><div class="form-actions">${mutator('tool-grants','管理项目授权')}${mutator('tool','调用项目工具')}${action('close','取消')}<button class="btn primary" ${disabled()}>保存关联</button></div></form>`);
  }
  /** 输出项目的流水线调用记录，与会话工具结果共用状态。@param {string} projectId 当前项目。@returns {string} 流水线列表与调用入口。 */
  function pipelines(projectId){const calls=db.toolCalls.filter(call=>call.project===projectId&&call.tool==='pipeline');return `<div class="row section-heading"><h2>流水线</h2><span class="spacer"></span><button class="btn primary" data-work="tool" data-id="${projectId}" data-tool="pipeline" ${disabled()}>运行流水线</button></div>${calls.map(call=>`<button class="work-task-row" data-work="tool-result" data-id="${call.id}"><span><strong>${esc(call.params.workflow)} · ${esc(call.params.branch)}</strong><small>${esc(bot(call.bot)?.name||'Bot')} · ${esc(call.time)}</small></span>${chip(call.phase)}</button>`).join('')||empty('还没有流水线运行','通过项目工具发起演示运行，结果同时回到会话。')}`;}
  /** 渲染项目能力授权表单。@param {string} selectedBot 默认调用者。@param {string} selectedProject 默认项目。@returns {void} 展示已授权范围；保存才生效。 */
  function grantForm(selectedBot=room().leader,selectedProject=room().projects[0]||projects[0].id) {
    dialog('Bot 项目能力授权',`<form data-work-form="tool-grants"><div class="form-grid">${field('Bot',`<select name="bot" data-work-change="grant-selection">${members('').map(b=>`<option value="${b.id}" ${b.id===selectedBot?'selected':''}>${esc(b.name)}</option>`).join('')}</select>`)}${field('项目',`<select name="project" data-work-change="grant-selection">${selectProjects(selectedProject)}</select>`)}</div><div class="tool-grant-list">${projectTools.map(tool=>`<label><input type="checkbox" name="capabilities" value="${tool.id}" ${canProject(selectedBot,selectedProject,tool.id)?'checked':''}><span><strong>${tool.name}</strong><small>${tool.description}</small></span></label>`).join('')}</div><p class="small muted">只授权当前 Bot，不会把权限共享给群组其他成员。密钥使用和生产变更另有授权。</p>${formEnd('保存授权')}</form>`);
  }
  /** 保存项目能力范围，不改变群成员或会话历史。@param {HTMLFormElement} form 表单。@param {FormData} values 已填写值。@returns {void} 更新本地授权并记录动作。 */
  function saveGrant(form,values) {
    const botId=String(values.get('bot')),projectId=String(values.get('project')),selected=values.getAll('capabilities').filter(id=>projectTools.some(t=>t.id===id));
    if(!bot(botId)||!projects.some(p=>p.id===projectId)){toast('请选择有效 Bot 和项目');return;}
    let binding=data.bindings.find(link=>link.botId===botId&&link.projectId===projectId);
    if(!binding){binding={botId,projectId,enabled:true,repoAccess:false,skills:[...bot(botId).skills],notes:''};data.bindings.push(binding);}
    binding.enabled=selected.length>0;binding.repoAccess=selected.includes('read');db.capabilityGrants[botId+':'+projectId]=selected;
    log(`${bot(botId).name} 的项目授权：${selected.map(id=>projectTools.find(t=>t.id===id).name).join('、')||'已撤销'}`,projectId);
    modal.close();save();toast('项目能力授权已保存');
  }
  /** 展示明确目标的项目工具调用。@param {string} projectId 目标项目。@param {string} toolId 操作标识。@param {string} botId 执行者。@returns {void} 打开本地演示表单。 */
  function toolForm(projectId=room().projects[0]||projects[0].id,toolId='read',botId=room().leader) {
    const rows=data.rows.filter(row=>row.project===projectId),tool=projectTools.find(t=>t.id===toolId)||projectTools[0];
    let inputs='';
    if(tool.id==='code')inputs=field('文件',`<select name="path"><option>src/api.ts</option><option>README.md</option></select>`)+field('工作分支',`<input name="branch" required value="bot/update-api" pattern="[a-zA-Z0-9_./-]+">`)+field('文件内容',`<textarea name="content" required maxlength="6000" rows="6">// 原型示例：统一接口返回\nexport interface ApiResponse {\n  success: boolean;\n  message: string;\n  requestId: string;\n}</textarea>`,true);
    if(tool.id==='pipeline')inputs=field('流水线',`<select name="workflow"><option>CI 检查</option><option>测试构建</option></select>`)+field('分支',`<input name="branch" required value="main" pattern="[a-zA-Z0-9_./-]+">`);
    if(['progress','comment'].includes(tool.id))inputs=field('目标事项',`<select name="issue" required>${rows.map(row=>`<option value="${row.id}">${esc(row.id+' · '+row.title)}</option>`).join('')}</select>`,true);
    if(tool.id==='progress')inputs+=field('目标状态',`<select name="status">${options(['待开始','开发中','修复中','待提测','测试中','已完成'],'开发中')}</select>`,true);
    if(['bug','mr'].includes(tool.id))inputs=field('标题',`<input name="title" required maxlength="80" placeholder="${tool.id==='bug'?'描述问题':'概括本次变更'}">`,true);
    if(tool.id==='mr')inputs+=field('源分支',`<input name="branch" required value="bot/update-api" pattern="[a-zA-Z0-9_./-]+">`)+field('目标分支',`<input name="targetBranch" required value="main" pattern="[a-zA-Z0-9_./-]+">`);
    if(!['read','code'].includes(tool.id))inputs+=field(tool.id==='bug'?'复现步骤与影响':'说明',`<textarea name="content" required maxlength="2000" placeholder="描述操作依据或预期结果"></textarea>`,true);
    dialog('调用项目能力',`<form data-work-form="project-tool"><div class="form-grid">${field('执行 Bot',`<select name="bot" data-work-change="tool-selection">${roomMembers(room()).map(b=>`<option value="${b.id}" ${b.id===botId?'selected':''}>${esc(b.name)}${b.online?'':'（离线）'}</option>`).join('')}</select>`)}${field('目标项目',`<select name="project" data-work-change="tool-selection">${selectProjects(projectId)}</select>`)}${field('工具',`<select name="tool" data-work-change="tool-selection">${projectTools.map(item=>`<option value="${item.id}" ${item.id===tool.id?'selected':''}>${item.name}</option>`).join('')}</select>`,true)}${inputs}</div>${canProject(botId,projectId,tool.id)?'':`<div class="vault-note">当前 Bot 尚未获授权使用此能力。${mutator('tool-grants','管理授权','','text-btn')}</div>`}<p class="small quiet">仅修改本地演示数据，不向 Git 平台提交或触发真实流水线。生产变更从运维计划进入。</p>${formEnd('演示调用')}</form>`);
  }
  /** 将工具调用结果放回原会话。@param {object} r 会话。@returns {string} 工具结果卡片。 */
  function toolCards(r) {return `<div class="tool-results">${db.toolCalls.filter(call=>call.room===r.id).slice(-6).map(call=>`<button class="tool-result-card" data-work="tool-result" data-id="${call.id}"><span class="row">${icon('terminal')}<strong>${esc(projectTools.find(t=>t.id===call.tool)?.name||call.tool)}</strong><span class="spacer"></span>${chip(call.phase)}</span><span class="small muted">${esc(projectName(call.project))} · ${esc(bot(call.bot)?.name||'Bot')}</span><span>${esc(call.result)}</span></button>`).join('')}</div>`;}
  /** 查看具体调用的目标、参数和结果。@param {object} call 调用记录。@returns {void} 展示详情或后续入口。 */
  function showToolResult(call) {dialog('项目工具调用',`<dl class="work-properties"><dt>项目</dt><dd>${esc(projectName(call.project))}</dd><dt>调用者</dt><dd>${esc(bot(call.bot)?.name||'Bot')}</dd><dt>工具</dt><dd>${esc(projectTools.find(t=>t.id===call.tool)?.name||call.tool)}</dd><dt>结果</dt><dd>${esc(call.result)}</dd><dt>状态</dt><dd>${esc(call.phase)}</dd></dl><pre class="tool-params">${esc(JSON.stringify(call.params,null,2))}</pre><div class="form-actions">${call.tool==='pipeline'&&call.phase==='运行中'?mutator('pipeline-finish','演示运行完成',call.id,'btn primary'):''}${action('tool-open','查看项目记录',call.id)}${action('close','关闭')}</div>`);}
  /** 执行演示能力并更新同一项目记录，重复提交由调用结果界面阻止。@param {HTMLFormElement} form 来源表单。@param {FormData} values 表单值。@returns {void} 只修改本地记录；无权限或目标无效时保留表单。 */
  function executeTool(form,values) {
    const get=name=>String(values.get(name)||'').trim(),projectId=get('project'),botId=get('bot'),tool=get('tool'),r=room();
    const error=text=>form.querySelector('.field-error').textContent=text;
    if(!roomMembers(r).some(b=>b.id===botId)||!bot(botId)?.online){error('执行者不在会话中或当前不可用');return;}
    if(!canProject(botId,projectId,tool)){error('缺少目标项目的能力授权，请先管理授权');return;}
    if(!projectTools.some(t=>t.id===tool)){error('未知能力');return;}
    const params=Object.fromEntries(values),call={id:uid('call'),room:r.id,bot:botId,project:projectId,tool,params,phase:'已完成',result:'',time:stamp()};
    const row=data.rows.find(row=>row.id===get('issue')&&row.project===projectId);
    if(['progress','comment'].includes(tool)&&!row){error('目标事项不存在于当前项目');return;}
    if(tool==='read')call.result=`读取 ${projectName(projectId)}：${data.rows.filter(row=>row.project===projectId).length} 条事项，${data.remotePrs.filter(pr=>pr.project===projectId).length} 个 PR / MR。`;
    if(tool==='code'){
      if(['main','master'].includes(get('branch'))){error('请使用工作分支，保留主分支供评审合并');return;}
      const existing=db.codeChanges.find(change=>change.project===projectId&&change.path===get('path')&&change.branch===get('branch'));
      const change={project:projectId,path:get('path'),branch:get('branch'),content:get('content'),call:call.id};if(existing)Object.assign(existing,change);else db.codeChanges.push(change);
      call.result=`已保存示例分支 ${get('branch')} 的 ${get('path')}，尚未创建 PR / MR。`;
    }
    if(tool==='bug'){
      const number=Math.max(0,...data.rows.filter(row=>row.kind==='Bug').map(row=>Number(row.id.split('-')[1])||0))+1;const id='BUG-'+number;
      data.rows.push({id,project:projectId,kind:'Bug',title:get('title'),description:get('content'),owner:bot(botId).owner,status:'待开始',pr:'',branch:'main',collaborators:'',tester:'',external:'',comments:[],activity:[stamp()+' · '+bot(botId).name+' 通过项目工具建立问题']});call.record=id;call.result='已创建平台问题 '+id+'。远端 Issue 尚未写入。';
    }
    if(tool==='progress'){if(!['待开始','开发中','修复中','待提测','测试中','已完成'].includes(get('status'))){error('状态无效');return;}row.status=get('status');row.activity.unshift(stamp()+' · '+bot(botId).name+' 更新状态为 '+row.status+'：'+get('content'));call.record=row.id;call.result=row.id+' 已更新为'+row.status+'，未触发流水线。';}
    if(tool==='comment'){row.comments.push({author:bot(botId).name,text:get('content'),time:stamp(),bot:true});row.activity.unshift(stamp()+' · Bot 添加评论');call.record=row.id;call.result='已向 '+row.id+' 添加评论。';}
    if(tool==='mr'){
      if(get('branch')===get('targetBranch')){error('源分支与目标分支不能相同');return;}
      const id=String(Math.max(0,...data.remotePrs.filter(pr=>pr.project===projectId).map(pr=>Number(pr.id)||0))+1);
      data.remotePrs.push({id,project:projectId,title:get('title'),author:bot(botId).name,branch:get('branch'),targetBranch:get('targetBranch'),status:'草稿',description:get('content'),demo:true});call.record=id;call.result='已创建演示 PR / MR #'+id+'，等待评审。';
    }
    if(tool==='pipeline'){call.phase='运行中';call.result=get('workflow')+' · '+get('branch')+' 正在演示运行。';}
    db.toolCalls.push(call);message(r,bot(botId).name,call.result);log(`${bot(botId).name} 调用 ${tool}：${call.phase}`,projectId);modal.close();save();showToolResult(call);
  }

  /** 列出可引用的当前项目资源，不接受跨项目候选。@returns {object[]} 名称与类型。 */
  function references() {
    const r=room(),scope=r.projects,visible=projects.filter(p=>roomMembers(r).some(b=>canProject(b.id,p.id,'read')));
    const code=scope.flatMap(project=>{
      if(!visible.some(p=>p.id===project))return [];
      const p=projects.find(p=>p.id===project),prefix=scope.length>1?project+'/':'';
      return [{text:'@repo/'+p.repo,type:'仓库',project},...['README.md','src/api.ts','docs/prd/mvp.md'].map(path=>({text:'@file/'+prefix+path,type:'文件',project})),...(data.remotePrs||[]).filter(pr=>pr.project===project).map(pr=>({text:'@pr/'+prefix+pr.id,type:'PR',project})),...data.rows.filter(row=>row.project===project).map(row=>({text:'@'+row.id,type:'事项',project}))];
    });
    return [...roomMembers(r).map(b=>({text:'@'+b.name,type:'成员'})),...visible.map(p=>({text:'@project/'+p.id,type:'项目',project:p.id})),...code,...ctx.skills().filter(skill=>skill.enabled&&roomMembers(r).some(b=>b.skills.includes(skill.id))).map(skill=>({text:'@skill/'+skill.id,type:'Skill'}))];
  }
  /** 更新输入区引用候选，保留草稿焦点。@param {string} query 检索词。@returns {void} 显示授权范围内候选。 */
  function showMentions(query='') {const box=document.getElementById('work-mentions');if(box)box.innerHTML=references().filter(ref=>ref.text.toLowerCase().includes(query.toLowerCase())).slice(0,8).map(ref=>action('reference',`${esc(ref.text)} <small>${ref.type}</small>`,ref.text,'mention-choice')).join('');}
  /** 分派工作区按钮，所有业务写入首先检查只读角色。@param {HTMLElement} target 按钮。@returns {void} 更新本地记录或显示表单。 */
  function click(target) {
    const name=target.dataset.work,id=target.dataset.id||'';
    const readonly=['keychain','incident-detail','close','room','chat-settings','hide-settings','inbox','task','open-task','hide-task','task-list','context','project-vars','capability','ops-tab','environment','op-detail','notices','notice-open','secret-audit','tool-result','tool-open','issue','mentions','reference','prompt','chat-menu','chat-tab','chat-more','trace-run','trace-toggle-all','message-action','annotation-view'];
    if(!readonly.includes(name)&&!editable())return;
    if(name==='close'){ctx.closeDialog();return;}
    if(name==='chat-settings'){ui.settings=!ui.settings;ui.task='';render();return;}
    if(name==='hide-settings'){ui.settings=false;render();return;}
    if(name==='room'){if(aiChat.isGenerating()&&ui.room!==id)aiChat.stopGeneration();ui.mobileRooms=false;ui.settings=false;ui.messageMode='讨论';ui.room=id;ui.view='会话';ui.task='';save();return;}
    if(name==='inbox'){ui.view='待你处理';render();return;}
    if(name==='task'){ui.settings=false;ui.task=id;render();return;}
    if(name==='open-task'){const t=db.tasks.find(t=>t.id===id);if(t){modal.close();openTask(t);}return;}
    if(name==='hide-task'){ui.task='';render();return;}
    if(name==='task-list'){dialog('协作任务',db.tasks.filter(t=>t.room===id).map(t=>taskRow(t)).join('')||empty('还没有任务'));return;}
    if(name==='capability'){modal.close();state.page=id==='templates'?'Skills':id;if(id==='templates')state.skillTab='AGENTS.md 模板';else if(id==='Skills')state.skillTab='技能库';state.botDetail=null;render();return;}
    if(name==='incident-detail'){const incident=db.incidents.find(i=>i.id===id);if(!incident)return;const t=db.tasks.find(t=>t.id===incident.task);dialog('异常处理 · '+incident.title,`<p>${esc(incident.evidence)}</p><ol class="incident-flow"><li><strong>发现异常</strong><span>${esc(incident.environment)} · 聚合 ${incident.count} 次</span></li><li><strong>建立问题</strong><span>${esc(t?.issue||'未关联')}</span></li><li><strong>Bot 排查与修复</strong><span>${esc(bot(t?.executor)?.name||'未指定')} · ${esc(t?.phase||'待处理')}</span></li><li><strong>发布并验证</strong><span>验收后制定变更计划，验证运行版本与健康状态。</span></li></ol><div class="form-actions">${action('open-task','进入排查会话',incident.task,'btn primary')}${t?action('issue','查看 Bug',t.id):''}${action('close','关闭')}</div>`);return;}
    if(name==='ops-tab'){ui.ops=id;render();return;}
    if(name==='environment'){ui.env=id;render();return;}
    if(name==='team'){roomForm(room());return;}
    if(name==='context'){contextForm();return;}
    if(name==='topic-tags'){
      const current=room();
      dialog('工作标签',`<form data-work-form="topic-tags" data-id="${current.id}"><div class="topic-option-list">${db.topicTags.map(tag=>`<div class="topic-option"><label><input type="checkbox" name="tagIds" value="${tag.id}" ${(current.tagIds||[]).includes(tag.id)?'checked':''}>${esc(tag.name)}<small>${esc(tag.projectIds.map(projectName).join('、')||'未关联项目')}</small></label>${mutator('edit-topic','设置',tag.id,'text-btn')}</div>`).join('')}</div>${field('新建标签',`<input name="tagName" maxlength="30" placeholder="例如：性能优化（可留空）">`)}<div class="field"><span>新标签关联项目</span><div class="work-checks">${projects.map(p=>`<label><input type="checkbox" name="tagProjects" value="${p.id}">${esc(p.name)}</label>`).join('')}</div></div>${formEnd('保存标签')}</form>`);return;
    }
    if(name==='edit-topic'){
      const tag=db.topicTags.find(item=>item.id===id);if(!tag)return;
      dialog('标签设置',`<form data-work-form="edit-topic" data-id="${tag.id}">${field('名称',`<input name="name" required maxlength="30" value="${esc(tag.name)}">`)}<div class="field"><span>关联项目</span><div class="work-checks">${projects.map(p=>`<label><input type="checkbox" name="projects" value="${p.id}" ${tag.projectIds.includes(p.id)?'checked':''}>${esc(p.name)}</label>`).join('')}</div></div>${formEnd('保存设置')}</form>`);return;
    }
    if(name==='keychain'){state.page='vault';render();return;}
    if(name==='project-vars'){modal.close();state.page='project';state.project=id;state.tab='环境变量';render();return;}
    if(name==='new-menu'){ui.createMenu=!ui.createMenu;render();return;}
    if(name==='new-assistant'){ui.createMenu=false;render();ctx.newBot();return;}
    if(name==='new-group'){ui.createMenu=false;render();roomForm();return;}
    if(name==='new-folder'){ui.createMenu=false;render();dialog('新建文件夹',`<form data-work-form="folder">${field('文件夹名称',`<input name="name" required maxlength="20" placeholder="例如：日报与通知">`)}${formEnd('创建文件夹')}</form>`);return;}
    if(name==='delete-folder'){const folder=db.folders.find(item=>item.id===id);if(!folder)return;dialog('删除文件夹',`<p>删除「${esc(folder.name)}」后，文件夹内的会话仍保留在会话列表中。</p><div class="form-actions">${action('close','取消')}<button class="btn primary" data-work="remove-folder" data-id="${esc(folder.id)}">删除文件夹</button></div>`);return;}
    if(name==='remove-folder'){db.folders=db.folders.filter(item=>item.id!==id);db.rooms.forEach(item=>{if(item.folderId===id)item.folderId='';});modal.close();save();toast('文件夹已删除');return;}
    if(name==='new-room'){roomForm();return;}
    if(name==='new-task'){dialog('新建协作任务',`<form data-work-form="task"><div class="form-grid">${field('目标',`<input name="title" required maxlength="80" placeholder="描述期望交付的结果" value="${esc(room().draft)}">`,true)}${field('业务负责人',`<select name="owner">${options(['林然','陈悦','周宁','许嘉'],'林然')}</select>`)}${field('执行者',`<select name="executor">${roomMembers(room()).filter(b=>b.online).map(b=>`<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>`)}</div>${formEnd('建立任务')}</form>`);return;}
    if(name==='tool'){toolForm(id||room().projects[0]||projects[0].id,target.dataset.tool||'read');return;}
    if(name==='tool-grants'){const form=modal.querySelector('form[data-work-form="project-tool"]');grantForm(id||form?.elements.bot.value||room().leader,form?.elements.project.value||room().projects[0]||projects[0].id);return;}
    if(name==='tool-open'){const call=db.toolCalls.find(call=>call.id===id);if(!call)return;modal.close();state.page='project';state.project=call.project;state.selected=null;state.tab=call.tool==='code'?'代码':call.tool==='mr'?'PR':call.tool==='pipeline'?'流水线':call.tool==='bug'?'Bug':'需求';if(['bug','progress','comment'].includes(call.tool)){const row=data.rows.find(row=>row.id===call.record&&row.project===call.project);if(row){state.selected=row.id;state.tab=row.kind;}}if(call.tool==='code'){state.file=call.params.path;state.branch=call.params.branch;}render();return;}
    if(name==='tool-result'){const call=db.toolCalls.find(call=>call.id===id);if(call)showToolResult(call);return;}
    if(name==='pipeline-finish'){const call=db.toolCalls.find(call=>call.id===id);if(!call||call.phase!=='运行中')return;if(!canProject(call.bot,call.project,'pipeline')||!bot(call.bot)?.online){toast('执行者不可用或授权已撤销');return;}call.phase='已完成';call.result='演示流水线运行结束，检查与构建通过。业务事项状态未改变。';save();showToolResult(call);return;}
    if(name==='message-mode'){ui.messageMode=ui.messageMode==='补充当前任务'?'讨论':'补充当前任务';render();return;}
    if(name==='chat-menu'){dialog('聊天操作',`<div class="chat-menu-actions">${mutator('new-task','创建任务')}${action('tool','调用项目工具')}${action('attachment-add','添加上下文附件')}${action('attachment-annotate','框选页面批注')}${action('mentions','@ 引用 Bot 与资源')}${action('demo-ai','演示 AI 回复')}</div><p class="small muted">附件和批注只保存在本地；AI 回复、执行轨迹与耗时均为本地演示，不调用模型或执行器。</p>`);return;}
    if(name==='demo-ai'){modal.close();aiChat.startDemo(room());return;}
    if(name==='stop-generation'){aiChat.stopGeneration();return;}
    if(name==='skip-generation'){aiChat.skipGeneration();return;}
    if(name==='attachment-add'){modal.close();attachmentForm();return;}
    if(name==='attachment-remove'){const current=room();if(!current)return;current.attachments=(current.attachments||[]).filter(item=>item.id!==id);save();return;}
    if(name==='attachment-annotate'){modal.close();startAnnotation();return;}
    if(name==='annotation-view'){showAnnotation(id);return;}
    if(name==='room-list-toggle'){ui.mobileRooms=!ui.mobileRooms;render();return;}
    if(name==='chat-tab'){ui.chatTab=['对话','轨迹','上下文','编队'].includes(id)?id:'对话';render();return;}
    if(name==='trace-run'){ui.traceRun=id;render();return;}
    if(name==='chat-more'){dialog('会话操作',`<div class="chat-menu-actions">${mutator('new-task','创建任务')}${action('task-list','任务列表',room().id)}${action('chat-settings','会话设置')}${action('attachment-add','添加上下文附件')}${action('attachment-annotate','框选页面批注')}${action('tool','调用项目工具')}${action('demo-ai','演示 AI 回复')}</div><p class="small muted">AI 回复、执行轨迹和耗时均为本地演示，不调用模型或执行器。</p>`);return;}
    if(name==='trace-toggle-all'){aiChat.toggleTraceAll();return;}
    if(name==='message-action'){const entry=findMessage(id);if(entry)aiChat.messageAction(room(),entry,target.dataset.kind);return;}
    if(name==='prompt'){room().draft=target.textContent;persist();render();return;}
    if(name==='mentions'){modal.close();showMentions();document.querySelector('[data-work-input="draft"]')?.focus();return;}
    if(name==='reference'){const input=document.querySelector('[data-work-input="draft"]');if(input){const before=input.value.slice(0,input.selectionStart),after=input.value.slice(input.selectionEnd);input.value=before.replace(/@[^\s@]*$/,'')+id+' '+after;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();document.getElementById('work-mentions').innerHTML='';}return;}
    if(name==='issue'){const t=db.tasks.find(t=>t.id===id),row=data.rows.find(r=>r.id===t?.issue&&r.project===t?.project);if(row){modal.close();state.page='project';state.project=row.project;state.tab=row.kind;state.selected=row.id;render();}return;}
    if(name==='issue-task'){
      const issue=data.rows.find(row=>row.id===id&&row.project===state.project);if(!issue)return;
      const existing=db.tasks.find(t=>t.issue===issue.id&&t.project===issue.project&&!['已完成','已取消'].includes(t.phase));
      if(existing){openTask(existing);return;}
      const r=ensureRoom(issue.project),t=createTask(r,issue.title,'业务事项');t.project=issue.project;t.issue=issue.id;t.owner=issue.owner;t.note=issue.description||issue.title;t.references=['@'+issue.id];openTask(t);return;
    }
    if(name==='handover'){const t=db.tasks.find(t=>t.id===id);dialog('调整任务分工',`<form data-work-form="handover" data-id="${t.id}">${field('业务负责人',`<select name="owner">${options(['林然','陈悦','周宁','许嘉'],t.owner)}</select>`)}${field('执行者',`<select name="executor">${roomMembers(db.rooms.find(r=>r.id===t.room)).filter(b=>b.online).map(b=>`<option value="${b.id}" ${b.id===t.executor?'selected':''}>${esc(b.name)} · ${esc(b.role)}</option>`).join('')}</select>`)}${field('交接说明',`<textarea name="note" required maxlength="1000">${esc(t.note)}</textarea>`)}${formEnd('确认转交')}</form>`);return;}
    if(['start-task','retry-task','stop-task','changes','accept'].includes(name)){
      const t=db.tasks.find(t=>t.id===id);if(!t)return;
      if(name==='start-task'&&t.phase!=='待开始'||name==='retry-task'&&t.phase!=='已取消'||['changes','accept'].includes(name)&&t.phase!=='待验收')return;
      if(['start-task','retry-task'].includes(name)&&!taskAvailable(t)){toast('执行者不可用，请转交或恢复节点');return;}
      if(['start-task','retry-task'].includes(name)&&t.requiredKey&&!hasGrant(t)){t.phase='等待配置';t.events.push(stamp()+' · 授权无效，等待配置');save();toast('当前任务需要重新配置授权');return;}
      t.phase=name==='stop-task'?'已取消':name==='accept'?'已完成':name==='changes'?'进行中':t.requiredKey&&!hasGrant(t)?'等待配置':'进行中';
      t.events.push(stamp()+' · '+({ 'start-task':'开始本地演示','retry-task':'重新开始，保留已有结果','stop-task':'停止后续执行，不撤销已有结果','changes':'验收退回，继续修改','accept':'业务负责人验收通过'}[name]));
      if(name==='accept'){organizeTask(t);const row=data.rows.find(r=>r.id===t.issue&&r.project===t.project);if(row){row.status='已完成';row.activity.unshift(stamp()+' · 林然验收协作任务');}message(db.rooms.find(r=>r.id===t.room),bot(db.rooms.find(r=>r.id===t.room)?.leader)?.name||'项目协作','「'+t.title+'」已验收。'+(t.project?'可以制定发布计划。':''));}
      save();return;
    }
    if(name==='report'){const t=db.tasks.find(t=>t.id===id);if(!t.project){dialog('提交任务结果',`<form data-work-form="general-result" data-id="${t.id}">${field('结果',`<textarea name="summary" required maxlength="3000" placeholder="说明完成了什么、结果在哪里，以及待确认事项"></textarea>`)}${field('完成情况',`<select name="outcome"><option>已交付</option><option>需要帮助</option></select>`)}${formEnd('提交结果')}</form>`);return;}dialog('提交开发交付',`<form data-work-form="report" data-id="${t.id}"><p class="small muted">手工开发与 Agent 使用相同交付格式；此处模拟 CLI 上报。</p><div class="form-grid">${field('分支',`<input name="branch" required placeholder="fix/login-permissions">`)}${field('Commit SHA',`<input name="commit" required pattern="[a-fA-F0-9]{7,40}" placeholder="a7c92e1">`)}${field('测试结果',`<select name="tests"><option>测试通过</option><option>测试失败</option><option>尚未测试</option></select>`)}${field('产物版本',`<input name="artifact" required placeholder="v0.5.3-build.1">`)}${field('完成内容与证据',`<textarea name="summary" required maxlength="2000" placeholder="说明修改内容、验证结果及未完成项"></textarea>`,true)}</div>${formEnd('提交结果')}</form>`);return;}
    if(name==='request-secret'){const t=db.tasks.find(t=>t.id===id);dialog('请求配置',`<form data-work-form="secret-request" data-id="${t.id}">${field('变量或密钥名称',`<input name="key" required pattern="[A-Z_][A-Z0-9_]*" value="LOG_API_TOKEN">`)}${field('环境',`<select name="environment">${options(envs,t.environment)}</select>`)}<p class="small muted">用户通过专用表单配置；Bot 在聊天中只收到配置状态。</p>${formEnd('发送配置请求')}</form>`);return;}
    if(name==='resolve-secret'){const t=db.tasks.find(t=>t.id===id);const v=db.variables.find(v=>v.project===t.project&&v.environment===t.environment&&v.name===t.requiredKey);variableForm(v?.id,t);return;}
    if(name==='resume-task'){const t=db.tasks.find(t=>t.id===id);if(!taskAvailable(t)){toast('执行者离线或已停用');return;}if(!hasGrant(t)){toast('当前项目、环境或 Bot 尚未获得有效授权');return;}t.phase='进行中';t.events.push(stamp()+' · 配置检查通过，继续演示任务');log(`${bot(t.executor)?.name} 在${t.environment}环境使用 ${t.requiredKey} 的授权（演示）`,t.project);save();return;}
    if(name==='release'){const t=db.tasks.find(t=>t.id===id);if(t?.phase==='已完成')operationForm(t);return;}
    if(name==='operation'){operationForm();return;}
    if(name==='op-detail'){const op=db.operations.find(op=>op.id===id);if(op)operationDetail(op);return;}
    if(name.startsWith('op-')){const op=db.operations.find(op=>op.id===id);if(!op)return;const transitions={'op-approve':['待确认','已批准'],'op-run':['已批准','执行中'],'op-finish':['执行中','待验证'],'op-verify':['待验证','已完成'],'op-retry':['失败','待确认']};
      if(name==='op-notice'){if(op.phase!=='已完成')return;notify(db.tasks.find(t=>t.id===op.task),`${op.kind}：${op.target} / ${op.environment} / ${op.version} 已完成模拟核对。`);persist();dialog('飞书通知预览',`<div class="notification-preview"><strong>${esc(projectName(op.project))} · ${esc(op.kind)}</strong><p>${esc(op.target)} / ${esc(op.environment)}</p><p>${esc(op.version)} · 已完成模拟核对</p><p>${esc(op.summary)}</p></div><p class="small quiet">仅生成本地通知，未向飞书发送消息。</p><div class="form-actions">${action('notices','查看通知中心')}${action('close','关闭')}</div>`);return;}
      if(name==='op-cancel'&&!['执行中','已完成','已取消'].includes(op.phase))op.phase='已取消';
      else if(name==='op-fail'&&['执行中','待验证'].includes(op.phase))op.phase='失败';
      else if(transitions[name]&&op.phase===transitions[name][0])op.phase=transitions[name][1];else return;
      if(op.phase==='已完成'&&op.kind==='部署版本'){const service=db.services.find(s=>s.project===op.project&&s.environment===op.environment&&s.name===op.target);if(service){service.version=op.version;service.health='正常';service.time=stamp();}}
      log(`${op.kind} ${op.target}：${op.phase}（演示）`,op.project);persist();render();operationDetail(op);return;
    }
    if(name==='variable'){variableForm(id);return;}
    if(name==='variable-revoke'){const v=db.variables.find(v=>v.id===id);if(!v?.enabled)return;v.enabled=false;db.tasks.filter(t=>t.project===v.project&&t.environment===v.environment&&t.requiredKey===v.name&&t.phase==='进行中').forEach(t=>{t.phase='等待配置';t.events.push(stamp()+' · 授权已撤销，等待重新配置');});log(`撤销 ${v.name} 的 Bot 使用权限`,v.project);persist();modal.close();render();toast('权限已撤销');return;}
    if(name==='secret-audit'){dialog('配置与使用记录',db.audit.filter(a=>a.project===ui.project).map(a=>`<div class="activity-item"><strong>${esc(a.text)}</strong><p>${esc(a.time)}</p></div>`).join('')||empty('还没有记录'));return;}
    if(name==='simulate'){simulateIncident(ui.project);return;}
    if(name==='inspect'){const service=db.services.find(s=>s.id===id);const r=ensureRoom(service.project),t=createTask(r,`排查 ${service.name} ${service.environment}环境运行状态`,'服务排查');t.project=service.project;t.environment=service.environment;openTask(t);return;}
    if(name==='rule'){const rule=db.rules.find(r=>r.id===id);dialog(rule?'编辑值守规则':'新建值守规则',`<form data-work-form="rule" data-id="${id}"><div class="form-grid">${field('规则名称',`<input name="name" required maxlength="80" value="${esc(rule?.name||'')}">`,true)}${field('触发方式',`<select name="type">${options(['日志告警','定时巡检'],rule?.type||'日志告警')}</select>`)}${field('环境',`<select name="environment">${options(envs,rule?.environment||'测试')}</select>`)}${field('频率 / 时间',`<input name="frequency" required maxlength="50" value="${esc(rule?.frequency||'每 5 分钟')}">`)}${field('执行 Bot',`<select name="bot">${selectBots(ui.project,rule?.bot||'',false)}</select>`)}${field('阈值、范围与动作',`<textarea name="detail" required maxlength="1000">${esc(rule?.detail||'')}</textarea>`,true)}</div>${formEnd()}</form>`);return;}
    if(name==='rule-toggle'){const rule=db.rules.find(r=>r.id===id);rule.enabled=!rule.enabled;save();return;}
    if(name==='rule-run'){const rule=db.rules.find(r=>r.id===id);if(!rule.enabled){toast('请先启用规则');return;}if(!available(rule.bot,rule.project)){toast('执行 Bot 离线或已停用，请调整规则或恢复节点');return;}rule.last=stamp();if(rule.type==='日志告警')simulateIncident(rule.project,rule);else{const r=ensureRoom(rule.project),t=createTask(r,rule.name,'定时巡检',rule.bot);t.project=rule.project;t.environment=rule.environment;t.note=rule.detail;openTask(t);}return;}
    if(name==='memory'){const m=db.memories.find(m=>m.id===id);dialog(m?'编辑记忆':'新增项目记忆',`<form data-work-form="memory" data-id="${id}">${field('适用 Bot',`<select name="bot">${selectBots(ui.memory,m?.bot||'')}</select>`)}${field('长期约定',`<textarea name="text" required maxlength="2000">${esc(m?.text||'')}</textarea>`)}${field('来源',`<input name="source" required value="${esc(m?.source||'团队确认')}" maxlength="200">`)}${formEnd()}</form>`);return;}
    if(name==='memory-confirm'){const m=db.memories.find(m=>m.id===id);m.confirmed=true;m.updated=stamp();save();return;}
    if(name==='memory-delete'){dialog('删除记忆',`<p>删除后不再作为项目约定提供，历史任务记录会保留。</p><div class="form-actions">${action('close','取消')}${mutator('memory-remove','确认删除',id,'btn primary')}</div>`);return;}
    if(name==='memory-remove'){db.memories=db.memories.filter(m=>m.id!==id);modal.close();save();return;}
    if(name==='connection'){const c=db.connections.find(c=>c.id===id);dialog('配置 '+c.name,`<form data-work-form="connection" data-id="${id}">${field('连接地址 / 角色标识',`<input name="endpoint" required maxlength="200" value="${esc(c.endpoint)}" placeholder="地址中不要包含凭据">`)}${field('凭据引用名称',`<input name="secret" pattern="[A-Z_][A-Z0-9_]*" value="${esc(c.secret||'')}" placeholder="例如 ALIYUN_ROLE_TOKEN">`)}<p class="small muted">仅保存连接配置，不在原型中连接外部服务。</p><div class="work-gap">${action('project-vars','管理凭据配置',ui.project,'text-btn')}</div>${formEnd('保存配置')}</form>`);return;}
    if(name==='node'){const assigned=data.bots.filter(b=>b.runtime===id),online=!assigned.every(b=>b.online);assigned.forEach(b=>b.online=online);save();toast('节点状态已模拟更新');return;}
    if(name==='notices'){dialog('通知中心',`<p class="small quiet">网页与飞书预览引用同一任务；没有发送外部消息。</p>${db.notifications.map(n=>`<button class="work-task-row" data-work="notice-open" data-id="${n.id}"><span><strong>${esc(n.text)}</strong><small>${esc(n.time)}</small></span>${chip(n.read?'已读':'未读')}</button>`).join('')||empty('没有通知')}`);return;}
    if(name==='notice-open'){const n=db.notifications.find(n=>n.id===id);n.read=true;persist();const t=db.tasks.find(t=>t.id===n.task);if(t){modal.close();openTask(t);}else{modal.close();state.page='operations';ui.project=n.project;ui.ops='变更记录';render();}return;}
  }
  /** 校验任务对应的变量授权，按环境、Bot 和期限隔离。@param {object} t 任务。@returns {boolean} 是否存在有效配置元数据；不证明真实密钥可用。 */
  function hasGrant(t) {return db.variables.some(v=>v.project===t.project&&v.environment===t.environment&&v.name===t.requiredKey&&v.enabled&&(!v.keychainId||data.vault?.items.some(key=>key.id===v.keychainId&&key.enabled&&key.projects.includes(t.project)&&key.bots.includes(t.executor)&&(!key.expiresAt||Date.now()<key.expiresAt)))&&v.bots.includes(t.executor)&&(v.expires!=='仅当前任务'||v.task===t.id)&&(!v.expiresAt||Date.now()<v.expiresAt));}
  /** 聚合同一环境错误并建立一次问题，重复触发只增加证据计数。@param {string} project 项目。@param {object} rule 可选来源规则。@returns {void} 保存演示事件。 */
  function simulateIncident(project,rule=null) {
    const environment=rule?.environment||'测试', fingerprint=project+':'+environment+':AUTH_STALE',existing=db.incidents.find(i=>i.fingerprint===fingerprint&&db.tasks.find(t=>t.id===i.task)?.phase!=='已完成');
    if(existing){existing.count++;existing.time=stamp();const t=db.tasks.find(t=>t.id===existing.task);t.events.push(stamp()+' · 收到重复异常，已聚合');save();toast('已聚合到已有问题，未重复建单');return;}
    const r=ensureRoom(project),t=createTask(r,'登录接口权限缓存异常','日志告警',rule?.bot||members(project).find(b=>b.id==='engineer')?.id||r.leader);t.project=project;t.phase=taskAvailable(t)&&available(t.executor,project)?'进行中':'受阻';t.environment=environment;t.note='AUTH_STALE：5 分钟内 12 次登录权限异常。示例日志：权限缓存版本与 token 不一致。';
    const issue='BUG-'+(Math.max(0,...data.rows.filter(row=>row.kind==='Bug').map(row=>Number(row.id.split('-')[1])||0))+1);
    data.rows.push({id:issue,title:t.title,owner:t.owner,status:'待开始',pr:'',kind:'Bug',project,collaborators:'',tester:'',description:t.note,external:'',branch:'main',comments:[],activity:[stamp()+' · 值守规则创建问题']});t.issue=issue;
    db.incidents.unshift({id:uid('event'),fingerprint,project,environment,title:'AUTH_STALE · 登录权限异常',count:1,time:stamp(),evidence:t.note,task:t.id});notify(t,'发现登录异常，Leader 已安排排查');save();toast('已创建问题、协作任务与通知');
  }
  /** 处理工作区表单，密钥输入不会写入共享数据或日志。@param {HTMLFormElement} form 表单。@returns {void} 更新本地演示状态。 */
  function submit(form) {
    if(!editable())return;
    const values=new FormData(form),name=form.dataset.workForm,id=form.dataset.id;
    const text=key=>String(values.get(key)||'').trim();
    const error=message=>{const node=form.querySelector('.field-error');if(node)node.textContent=message;else toast(message);};
    if(name==='message'){
      const content=text('message');if(!content)return;const r=room(),refs=content.match(/@[^\s，。]+/g)||[],known=references();
      if(refs.some(ref=>!known.some(item=>item.text===ref))){toast('引用不存在或不在当前会话授权范围，请通过 @ 选择');return;}
      const selected=roomMembers(r).filter(b=>refs.includes('@'+b.name)),active=task(),executor=text('mode')==='补充当前任务'?active?.executor:selected[0]?.id||r.leader;
      if(text('mode')==='补充当前任务'&&selected.length&&selected[0].id!==executor){toast('补充指令不会更换执行者，请先通过任务面板转交');return;}
      if(selected.length>1){toast('一个任务先指定一位负责人，再通过转交组织协作');return;}
      const resources=known.filter(ref=>refs.includes(ref.text)&&ref.project);
      if(resources.some(ref=>!canProject(executor,ref.project,'read'))){toast('当前执行者未获授权读取目标项目');return;}
      if(refs.filter(ref=>ref.startsWith('@skill/')).some(ref=>!bot(executor)?.skills.includes(ref.slice(7)))){toast('当前执行者未获授权使用此 Skill');return;}
      if(/(?:API_KEY|TOKEN|PASSWORD|SECRET)\s*[=:]\s*\S+/i.test(content)){toast('请在环境变量与密钥表单中配置敏感值');return;}
      if(text('mode')!=='讨论'&&!roomAvailable(executor,r)){toast('负责人不可用，请设置可用 Leader 或 @ 可用成员');return;}
      if(text('mode')==='补充当前任务'&&(!active||active.room!==r.id||['已完成','已取消'].includes(active.phase))){toast('先选择一个未完成任务再补充指令');return;}
      const attachments=Array.isArray(r.attachments)?r.attachments.slice():[];
      message(r,'我',content,attachments);r.draft='';r.attachments=[];
      if(text('mode')==='交给 Bot'){const t=createTask(r,content);const projectIds=[...new Set(resources.map(ref=>ref.project))];t.project=projectIds.length===1?projectIds[0]:r.projects.length===1?r.projects[0]:'';t.projects=projectIds;}
      else if(text('mode')==='补充当前任务'){active.events.push(stamp()+' · 补充指令：'+content);active.note+='\n'+content;message(r,bot(active.executor)?.name||'Bot','已将补充指令加入当前任务，保留既有结果。');}
      if(text('mode')==='讨论'||!text('mode')){aiChat.startReply(r,content);return;}
      save();return;
    }
    if(name==='room'||name==='team'){
      const ids=values.getAll('members').filter(id=>members('').some(b=>b.id===id));
      if(!ids.length){error('至少选择一位 Bot');return;}
      if(!ids.includes(text('leader'))||!bot(text('leader'))?.online){error('Leader 必须是已选择且可用的 Bot');return;}
      if(text('type')==='direct'&&ids.length!==1){error('直接会话只选择一位 Bot；多人协作请选择群组');return;}
      const r=db.rooms.find(r=>r.id===id)||{id:uid('room'),project:'',projects:[],messages:[],draft:''};
      Object.assign(r,{description:text('description'),instructions:text('instructions'),name:text('name'),type:text('type'),leader:text('leader'),members:ids,folderId:db.folders.some(folder=>folder.id===text('folder'))?text('folder'):''});if(!id)db.rooms.push(r);db.tasks.filter(t=>t.room===r.id&&!ids.includes(t.executor)&&['待开始','进行中','等待配置'].includes(t.phase)).forEach(t=>{t.phase='受阻';t.events.push(stamp()+' · 执行者已移出会话，请重新分派');});ui.room=r.id;ui.task='';ui.view='会话';state.page='collaboration';
    }
    if(name==='folder'){const folderName=text('name');if(!folderName){error('请输入文件夹名称');return;}if(db.folders.some(folder=>folder.name===folderName)){error('已有同名文件夹');return;}db.folders.push({id:uid('folder'),name:folderName});toast('文件夹已创建');}
    if(name==='edit-topic'){const tag=db.topicTags.find(item=>item.id===id);if(!tag)return;const name=text('name');if(!name){error('请输入标签名称');return;}if(db.topicTags.some(item=>item.id!==id&&item.name.toLocaleLowerCase()===name.toLocaleLowerCase())){error('已有同名标签');return;}tag.name=name;tag.projectIds=values.getAll('projects').filter(id=>projects.some(p=>p.id===id));}
    if(name==='topic-tags'){const current=db.rooms.find(item=>item.id===id);if(!current){error('会话不存在');return;}const ids=values.getAll('tagIds').filter(id=>db.topicTags.some(tag=>tag.id===id));if(text('tagName'))ids.push(ensureTopic(text('tagName'),'human','林然',values.getAll('tagProjects').filter(id=>projects.some(p=>p.id===id))).id);current.tagIds=Array.from(new Set(ids));}
    if(name==='context'){const r=room();r.projects=values.getAll('projects').filter(id=>projects.some(p=>p.id===id));r.project=r.projects.length===1?r.projects[0]:'';}
    if(name==='tool-grants'){saveGrant(form,values);return;}
    if(name==='project-tool'){executeTool(form,values);return;}
    if(name==='task'){if(!roomAvailable(text('executor'),room())){error('请选择可用执行者');return;}const t=createTask(room(),text('title'),'对话',text('executor'));t.owner=text('owner');}
    if(name==='handover'){const t=db.tasks.find(t=>t.id===id);if(!roomAvailable(text('executor'),db.rooms.find(r=>r.id===t.room))){error('请选择当前会话中的可用成员');return;}t.owner=text('owner');t.executor=text('executor');t.note=text('note');t.phase=t.requiredKey&&!hasGrant(t)?'等待配置':'待开始';t.events.push(stamp()+' · 转交给'+bot(t.executor).name);message(db.rooms.find(r=>r.id===t.room),bot(db.rooms.find(r=>r.id===t.room)?.leader)?.name||'项目协作','「'+t.title+'」转交给'+bot(t.executor).name+'，已有结果保留。');}
    if(name==='general-result'){const t=db.tasks.find(t=>t.id===id);if(!t||t.project||!['进行中','受阻'].includes(t.phase)){error('当前任务无法提交结果');return;}t.handoff={summary:text('summary'),artifact:'任务结果',tests:text('outcome'),branch:'不适用',commit:'不适用'};t.phase=text('outcome')==='已交付'?'待验收':'受阻';t.events.push(stamp()+' · 已提交任务结果');message(db.rooms.find(r=>r.id===t.room),bot(t.executor)?.name||'Bot',text('summary'));if(t.phase==='待验收')organizeTask(t);notify(t,'任务结果待处理：'+t.title);}
    if(name==='report'){const t=db.tasks.find(t=>t.id===id);if(!['进行中','受阻'].includes(t.phase)){error('任务当前不能提交结果');return;}t.handoff={branch:text('branch'),commit:text('commit'),tests:text('tests'),artifact:text('artifact'),summary:text('summary')};t.phase=text('tests')==='测试通过'?'待验收':'受阻';t.events.push(stamp()+' · 收到开发交付：'+text('tests'));message(db.rooms.find(r=>r.id===t.room),bot(t.executor)?.name||'开发者','已提交交付结果：'+text('artifact')+'，'+text('tests'));if(t.phase==='待验收')organizeTask(t);notify(t,'开发结果已提交：'+t.title);}
    if(name==='secret-request'){const t=db.tasks.find(t=>t.id===id);t.requiredKey=text('key');t.environment=text('environment');t.phase='等待配置';t.events.push(stamp()+' · 请求配置 '+t.requiredKey);message(db.rooms.find(r=>r.id===t.room),bot(t.executor)?.name||'Bot','需要 '+t.environment+'环境的 '+t.requiredKey+'，请在配置表单中授权，不要把密钥发到聊天。');notify(t,'需要配置 '+t.requiredKey);}
    if(name==='variable'){
      const existing=db.variables.find(v=>v.id===id),project=form.dataset.project,environment=form.dataset.environment,type=existing?.type||text('type');
      if(!/^[A-Z_][A-Z0-9_]*$/.test(text('name'))){error('名称仅允许大写字母、数字和下划线，不能以数字开头');return;}
      if(db.variables.some(v=>v.id!==id&&v.project===project&&v.environment===environment&&v.name===text('name'))){error('当前环境已有同名配置，请在已有配置中管理');return;}
      const bots=values.getAll('bots').filter(id=>members(project).some(b=>b.id===id)),request=db.tasks.find(t=>t.id===form.dataset.request);
      if(text('expires')==='仅当前任务'&&!request&&!existing?.task){error('仅当前任务授权需要从任务配置请求进入');return;}
      if(!existing&&!text('value')){error('请填写测试值');return;}
      const v=existing||{id:uid('variable'),project,environment,version:0};
      if(!existing||text('value'))v.version++;
      Object.assign(v,{name:text('name'),type,value:type==='变量'?text('value'):'',mode:text('mode'),bots,configured:true,enabled:true,updated:stamp(),expires:text('expires'),expiresAt:text('expires')==='24 小时'?Date.now()+86400000:null,task:request?.id||existing?.task||''});
      if(!existing)db.variables.push(v);
      form.querySelector('[name="value"]').value='';
      log(`${existing?'更新':'配置'} ${v.name} v${v.version}，${v.mode}，授权 ${bots.map(id=>bot(id)?.name).join('、')||'无'}`,project);
      if(request&&hasGrant(request)&&taskAvailable(request)){request.phase='进行中';request.events.push(stamp()+' · 配置授权已就绪，继续演示任务');message(db.rooms.find(r=>r.id===request.room),'项目协作',v.name+' 已配置，原型不保存密钥值。任务已恢复。');}
      modal.close();save();toast(type==='密钥'?'已保存配置元数据，密钥测试值已丢弃':'变量已保存');return;
    }
    if(name==='operation'){const t=db.tasks.find(t=>t.id===form.dataset.task);const op={id:uid('op'),project:t?.project||text('project'),environment:text('environment'),target:text('target'),kind:text('kind'),version:text('version'),summary:text('summary'),evidence:text('evidence'),rollback:text('rollback'),phase:'待确认',time:stamp(),task:t?.id||''};db.operations.unshift(op);ui.project=op.project;ui.ops='变更记录';state.page='operations';if(t){t.events.push(stamp()+' · 已创建发布计划');notify(t,'发布计划待确认：'+op.version);}persist();modal.close();render();operationDetail(op);return;}
    if(name==='rule'){if(!members(ui.project).some(b=>b.id===text('bot'))){error('请选择已加入项目的 Bot');return;}const rule=db.rules.find(r=>r.id===id)||{id:uid('rule'),project:ui.project,enabled:false,last:'尚未演示触发'};Object.assign(rule,{name:text('name'),type:text('type'),environment:text('environment'),bot:text('bot'),frequency:text('frequency'),detail:text('detail')});if(!id)db.rules.push(rule);}
    if(name==='memory'){const m=db.memories.find(m=>m.id===id)||{id:uid('memory'),project:ui.memory};Object.assign(m,{bot:text('bot'),text:text('text'),source:text('source'),confirmed:true,updated:stamp()});if(!id)db.memories.push(m);}
    if(name==='connection'){const c=db.connections.find(c=>c.id===id);if(/(?:password|token|secret|key)=|https?:\/\/[^/]*@/i.test(text('endpoint'))){error('地址不能包含凭据，请使用凭据引用');return;}c.endpoint=text('endpoint');c.secret=text('secret');c.status='已配置 · 未连接';}
    if(name==='attachment'){
      const typeMap={'文件':'file','网页链接':'link','图片':'image'},type=typeMap[text('type')]||'file',label=text('name'),url=text('url');
      if(!label){error('请填写附件名称');return;}
      if(type==='link'&&!/^https?:\/\//i.test(url)){error('网页链接需要以 http:// 或 https:// 开头');return;}
      modal.close();addAttachment({id:uid('attach'),type,name:label,url:type==='link'?url:'',time:stamp()});return;
    }
    modal.close();save();toast('已保存本地演示记录');
  }
  modal.addEventListener('close',()=>{modal.querySelectorAll('input[type="password"]').forEach(input=>{input.value='';});});
  /** 触发浏览器下载一个文本文件，不访问外部服务。@param {string} filename 文件名。@param {string} content 文本内容。@returns {void} */
  function downloadText(filename,content){const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
  /** 代码块下载时使用的文件扩展名映射。@param {string} language 代码语言。@returns {string} 文件扩展名。 */
  function codeExtension(language){const map={ts:'ts',typescript:'ts',js:'js',javascript:'js',py:'py',python:'py',json:'json',bash:'sh',sh:'sh',shell:'sh',css:'css',html:'html',md:'md',sql:'sql'};return map[String(language||'').toLowerCase()]||'txt';}
  document.addEventListener('click',event=>{const target=event.target.closest('[data-work]');if(target){event.preventDefault();click(target);}});
  // 点击新建菜单外部时收起菜单，避免遮挡会话列表。
  document.addEventListener('click',event=>{if(!ui.createMenu)return;if(event.target.closest('.create-wrap'))return;ui.createMenu=false;render();});
  // 代码块复制与下载由事件委托处理，流式渲染后按钮仍然可用。
  document.addEventListener('click',event=>{const copyButton=event.target.closest('[data-copy-code]'),downloadButton=event.target.closest('[data-download-code]');if(!copyButton&&!downloadButton)return;event.preventDefault();const codeBlock=(copyButton||downloadButton).closest('.md-code'),code=codeBlock?.querySelector('code');if(!code)return;const source=code.textContent;if(downloadButton){downloadText(`snippet.${codeExtension(codeBlock.dataset.language)}`,source);toast('已下载代码片段');return;}navigator.clipboard.writeText(source).then(()=>{copyButton.dataset.copied='true';copyButton.innerHTML=icon('check')+'已复制';toast('已复制代码');setTimeout(()=>{copyButton.dataset.copied='false';copyButton.innerHTML=icon('copy')+'复制';},1600);}).catch(()=>toast('浏览器拒绝剪贴板权限，请手动选择代码复制'));});
  document.addEventListener('submit',event=>{const form=event.target;if(form.matches('[data-work-form]')){event.preventDefault();submit(form);}});
  document.addEventListener('input',event=>{const el=event.target;if(el.dataset.workInput==='draft'){room().draft=el.value;const send=el.form.querySelector('.dsh-send');if(send&&!send.classList.contains('dsh-stop'))send.disabled=state.role==='浏览者'||!el.value.trim();el.style.height='auto';el.style.height=Math.min(el.scrollHeight,144)+'px';persist();const match=el.value.slice(0,el.selectionStart).match(/@([^\s@]*)$/);if(match)showMentions(match[1]);else{const menu=document.getElementById('work-mentions');if(menu)menu.innerHTML='';}}if(el.dataset.workInput==='room-search'){ui.query=el.value;const cursor=el.selectionStart;render();const input=document.querySelector('[data-work-input="room-search"]');input?.focus();input?.setSelectionRange(cursor,cursor);}});
  document.addEventListener('change',event=>{const el=event.target,key=el.dataset.workChange;if(!key)return;if(key==='tool-selection'){const form=el.form;toolForm(form.elements.project.value,form.elements.tool.value,form.elements.bot.value);return;}if(key==='grant-selection'){const form=el.form;grantForm(form.elements.bot.value,form.elements.project.value);return;}if(key==='secret-type'){const input=el.form.querySelector('[name="value"]');input.value='';input.type=el.value==='密钥'?'password':'text';return;}if(key==='room-project'){const leader=el.form.querySelector('[name="leader"]');const wrapper=leader.closest('.select-control');if(wrapper)wrapper.replaceWith(leader);leader.hidden=false;leader.innerHTML=selectBots(el.value,'',true);ctx.enhanceSelects(el.form);return;}if(key==='ops-project'||key==='vars-project')ui.project=el.value;if(key==='memory-project')ui.memory=el.value;render();});
  document.addEventListener('keydown',event=>{if(event.target.matches('[data-work-input="draft"]')&&!event.isComposing){if(event.key==='Escape'){document.getElementById('work-mentions').innerHTML='';}if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.target.form.requestSubmit();}}});
  /** 写入工作区路由，仅全局协作保存会话与任务参数。@param {URL} url 当前地址。@returns {void} 仅修改工作区参数。 */
  function syncRoute(url){for(const key of ['room','task','ops','env','scope','workview'])url.searchParams.delete(key);if(state.page==='project'&&state.tab==='bots'&&db.rooms.some(item=>item.id===ui.room))url.searchParams.set('room',ui.room);if(state.page==='collaboration'){url.searchParams.set('room',ui.room);url.searchParams.set('chattab',ui.chatTab);if(ui.task)url.searchParams.set('task',ui.task);url.searchParams.set('workview',ui.view);}if(['operations','variables','memory'].includes(state.page)){url.searchParams.set('scope',state.page==='memory'?ui.memory:ui.project);url.searchParams.set('env',ui.env);if(state.page==='operations')url.searchParams.set('ops',ui.ops);}if(state.page==='project'&&state.tab==='环境变量')url.searchParams.set('env',ui.env);}
  /** 恢复已存在的工作区资源；未知 ID 不创建资源。@param {URLSearchParams} query 地址参数。@returns {void} 更新内存导航。 */
  function readRoute(query){if(db.rooms.some(r=>r.id===query.get('room')))ui.room=query.get('room');else ui.room='direct-product';ui.task=db.tasks.some(t=>t.id===query.get('task'))?query.get('task'):'';if(projects.some(p=>p.id===query.get('scope')))ui.project=ui.memory=query.get('scope');if(envs.includes(query.get('env')))ui.env=query.get('env');if(['运行概况','值守规则','变更记录'].includes(query.get('ops')))ui.ops=query.get('ops');if(['对话','轨迹','上下文','编队'].includes(query.get('chattab')))ui.chatTab=query.get('chattab');ui.view=query.get('workview')==='待你处理'?'待你处理':'会话';}
  /** 打开 Bot 的独立会话，项目仅作为可选上下文。@param {string} project 可选项目。@param {string} id Bot 标识。@param {string} draft 可选草稿。@returns {void} 复用会话；不会授予项目权限。 */
  function openBot(project,id,draft=''){
    let r=db.rooms.find(r=>r.type==='direct'&&r.leader===id);
    if(!r){r={id:uid('direct'),project:'',projects:[],members:[id],name:bot(id)?.name||'Bot',type:'direct',leader:id,messages:[],draft:''};db.rooms.push(r);}
    if(project&&!r.projects.includes(project))r.projects.push(project);
    ui.room=r.id;ui.task='';ui.view='会话';if(draft)r.draft=draft;
  }
  /** 设置项目归集范围，不创建或选择会话。@param {string} id 项目。@returns {void} 清理旧任务选择。 */
  function setProject(id){ui.task='';ui.view='会话';ui.project=id;}
  /** 打开添加上下文附件的表单，仅记录本地元数据，不读取或上传文件。@returns {void} 显示表单。 */
  function attachmentForm(){
    dialog('添加上下文附件',`<form data-work-form="attachment"><div class="form-grid">${field('类型',`<select name="type">${options(['文件','网页链接','图片'],'文件')}</select>`)}${field('名称',`<input name="name" required maxlength="60" placeholder="例如：登录日志片段">`)}${field('链接（网页链接时填写）',`<input name="url" type="url" placeholder="https://example.com/issue/18">`,true)}</div><p class="small muted">附件只作为本地上下文标记，不会上传文件或访问链接。需要指出页面问题时，可选择“框选页面批注”。</p><div class="form-actions">${action('attachment-annotate','框选页面批注')}${action('close','取消')}<button class="btn primary">添加附件</button></div></form>`);
  }
  /** 为当前会话添加一个上下文附件并保存。@param {object} attachment 附件记录。@returns {void} 刷新会话。 */
  function addAttachment(attachment){const current=room();if(!current)return;if(!Array.isArray(current.attachments))current.attachments=[];current.attachments.push(attachment);save();toast('已添加上下文附件');}
  /** 展示批注附件的坐标与目标元素，便于核对发送给 AI 的结构化数据。@param {string} attachmentId 附件标识。@returns {void} 打开只读详情。 */
  function showAnnotation(attachmentId){
    const attachment=[...(room()?.attachments||[]),...room().messages.flatMap(item=>item.attachments||[])].find(item=>item.id===attachmentId);
    if(!attachment)return;
    const payload={type:'annotation',rect:attachment.rect,pageRect:attachment.pageRect,viewport:attachment.viewport,target:attachment.target,note:attachment.note};
    dialog('页面批注坐标',`<dl class="work-properties"><dt>目标元素</dt><dd>${esc(attachment.target?.label||'页面区域')}</dd><dt>选框尺寸</dt><dd>${esc(`${attachment.rect?.width||0} × ${attachment.rect?.height||0}`)}</dd><dt>视口坐标</dt><dd class="mono">x ${esc(attachment.rect?.x||0)}, y ${esc(attachment.rect?.y||0)}</dd><dt>批注</dt><dd>${esc(attachment.note||'未填写')}</dd></dl><pre class="tool-params">${esc(JSON.stringify(payload,null,2))}</pre><div class="form-actions">${action('close','关闭')}</div>`);
  }
  const aiChat=createAiChat({data,db,ui,state,esc,icon,botAvatar,bot,persist,render,toast,action,mutator});
  // 框选批注只生成本地附件与坐标记录，不截图上传；发送时打印结构化 JSON 供核对。
  const annotationTool=createAnnotationTool({
    onComplete: annotation => addAttachment({id:uid('attach'),type:'annotation',name:('页面批注 · '+(annotation.target?.label||'页面区域')).slice(0,60),note:annotation.note,rect:annotation.rect,pageRect:annotation.pageRect,viewport:annotation.viewport,target:annotation.target,time:stamp()}),
    toast
  });
  /** 进入页面框选批注模式；只读角色不启动。@returns {void} 显示遮罩。 */
  function startAnnotation(){if(!editable())return;annotationTool.start();}
  /** 按消息标识查找当前原型中的消息记录。@param {string} messageId 消息标识。@returns {object|undefined} 已保存的消息。 */
  const findMessage=messageId=>db.rooms.flatMap(item=>item.messages).find(item=>item.id===messageId);
  const {collaboration,taskRow,taskPanel}=createChatViews({data,state,projects,esc,icon,botAvatar,db,ui,room,task,roomMembers,bot,projectName,roomMatchesProject,mutator,action,empty,heading,disabled,chip,toolCards,aiChat});
  const operations=createOperationsView({db,ui,heading,mutator,selectProjects,action,esc,chip,empty,bot,icon});
  return {openBot,setProject,collaboration,pipelines,operations,variables,memories,connections,capabilityNav,syncRoute,readRoute,openTask,ensureRoom};
};
