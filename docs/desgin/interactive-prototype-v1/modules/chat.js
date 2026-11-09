/** 创建聊天视图；状态与业务操作由工作区传入。@param {object} ctx 共享状态和显示工具。@returns {object} 会话与任务视图，不注册全局状态。 */
export function createChatViews(ctx) {
  const {data,state,projects,esc,icon,botAvatar,db,ui,room,task,roomMembers,bot,projectName,roomMatchesProject,mutator,action,empty,heading,disabled,chip,toolCards,aiChat}=ctx;
  /** 输出会话成员头像，群聊优先展示 Leader，最多展示四位实际成员。@param {object} item 会话记录。@returns {string} 组合头像；按实际人数排列，不虚构成员。 */
  function conversationAvatar(item){
    if(item.type==='direct')return botAvatar(bot(item.leader),'small');
    const members=roomMembers(item);
    const visible=[...members.filter(member=>member.id===item.leader),...members.filter(member=>member.id!==item.leader)].slice(0,4);
    return `<span class="bot-group-avatar members-${visible.length}" title="${esc(visible.map(member=>member.name).join('、'))}">${visible.length?visible.map(member=>botAvatar(member,'small')).join(''):icon('bot')}</span>`;
  }
  /** 提取纯文本摘要，避免把 Markdown 标记带进会话列表。@param {string} text 消息正文。@returns {string} 单行摘要。 */
  function plainPreview(text){return String(text||'').replace(/```[\s\S]*?```/g,' ').replace(/[#>*_`|~]/g,' ').replace(/\s+/g,' ').trim();}
  /** 输出会话列表项；时间取自最后一条真实消息。@param {object} item 会话记录。@param {string} selected 当前会话标识。@returns {string} 含成员头像、摘要和可选时间的按钮。 */
  function conversationItem(item,selected){
    const last=item.messages.at(-1),time=last?.time?.match(/\d{1,2}:\d{2}/)?.[0]||'';
    return `<button class="conversation-item ${item.id===selected&&(state.page==='project'||ui.view==='会话')?'active':''}" data-work="room" data-id="${item.id}"><span class="conversation-mark">${conversationAvatar(item)}</span><span class="conversation-summary"><span class="conversation-title-row"><strong>${esc(item.name)}</strong>${time?`<time title="${esc(last.time)}">${esc(time)}</time>`:''}</span><small>${esc(plainPreview(last?.text).slice(0,72)||'还没有消息')}</small></span></button>`;
  }
  /** 显示独立工作标签，不将项目名称作为分类。@param {object} item 会话或任务。@returns {string} 已转义标签标记。 */
  function topicLabels(item){return db.topicTags.filter(tag=>(item.tagIds||[]).includes(tag.id)).map(tag=>`<span class="project-tag" title="${esc(tag.source==='bot'?'Bot 整理':'人工创建')}"># ${esc(tag.name)}</span>`).join('');}
  /** 输出聊天记录，供全局会话与项目只读视图共用。@param {object} current 会话。@returns {string} 已转义消息正文，不包含输入框或执行入口。 */
  function messageHistory(current){return current.messages.map(m=>aiChat.messageHtml(m,current)).join('');}
  /** 会话页签顺序：对话、轨迹、上下文、编队。 */
  const CHAT_TABS = ['对话', '轨迹', '上下文', '编队'];
  /** 返回当前有效的会话页签。@returns {string} 页签名。 */
  function activeChatTab() { return CHAT_TABS.includes(ui.chatTab) ? ui.chatTab : '对话'; }
  /** 输出 DSH 风格的会话页签栏。@param {object} current 当前会话。@returns {string} 页签栏 HTML。 */
  function chatTabs(current) {
    const counts = aiChat.badgeCounts(current);
    const badges = {轨迹: counts.轨迹, 上下文: counts.上下文, 编队: roomMembers(current).length};
    const generating = aiChat.isGenerating(current.id);
    return `<nav class="dsh-tabs" role="tablist" aria-label="会话视图">${CHAT_TABS.map(tab => `<button type="button" role="tab" class="dsh-tab ${activeChatTab() === tab ? 'is-active' : ''}" aria-selected="${activeChatTab() === tab}" data-work="chat-tab" data-id="${tab}"><span class="dsh-tab-label">${tab}</span>${badges[tab] ? `<span class="dsh-tab-count">${badges[tab]}</span>` : ''}${tab === '轨迹' && generating ? '<span class="dsh-tab-pulse" aria-hidden="true"></span>' : ''}</button>`).join('')}<button type="button" class="dsh-tab-more" data-work="chat-more" aria-label="更多会话操作" title="更多">${icon('more')}</button></nav>`;
  }
  /** 输出 DSH 风格的会话头部，包含标题和页签。@param {object} current 当前会话。@param {boolean} readonly 项目协作只读视图。@returns {string} 头部 HTML。 */
  function chatHeader(current, readonly = false) {
    const leader = bot(current.leader);
    const generating = aiChat.isGenerating(current.id);
    const tasks = db.tasks.filter(item => item.room === current.id);
    const tags = topicLabels(current);
    const meta = `${current.type === 'group' ? roomMembers(current).length + ' 位 Bot · Leader ' + esc(leader?.name || '未设置') : esc(leader?.role || '智能体')}${tags ? ' · ' + tags : ''}`;
    const title = readonly
      ? `<div class="dsh-title"><span class="dsh-title-avatar">${conversationAvatar(current)}</span><span class="dsh-title-text"><strong>${esc(current.name)}</strong><small>${meta}</small></span></div>`
      : `<button type="button" class="dsh-title" data-work="chat-settings" aria-label="${esc(current.name)}的会话设置"><span class="dsh-title-avatar">${conversationAvatar(current)}</span><span class="dsh-title-text"><strong>${esc(current.name)}</strong><small>${meta}</small></span></button>`;
    const actionsHtml = readonly ? '' : `<div class="dsh-title-actions">${generating ? '<span class="dsh-running-pill"><span class="dsh-pulse" aria-hidden="true"></span>深度求索中…</span>' : ''}<button type="button" class="dsh-icon-btn" data-work="task-list" data-id="${esc(current.id)}" aria-label="任务列表" title="任务列表">${icon('file')}${tasks.length ? `<span class="dsh-icon-badge">${tasks.length}</span>` : ''}</button><button type="button" class="dsh-icon-btn" data-work="chat-settings" aria-label="会话设置" title="会话设置">${icon('settings')}</button></div>`;
    return `<header class="dsh-chat-header"><div class="dsh-title-row"><button type="button" class="dsh-icon-btn dsh-room-toggle" data-work="room-list-toggle" aria-label="打开会话列表" title="会话列表">${icon('menu')}</button>${title}${actionsHtml}</div>${chatTabs(current)}</header>`;
  }
  /** 输出对话页签的欢迎区，让本地演示入口无需发送消息即可被发现。@param {object} current 当前会话。@returns {string} 欢迎区 HTML。 */
  function chatWelcome(current) {
    const leader = bot(current.leader);
    return `<div class="dsh-hero"><span class="dsh-hero-avatar">${conversationAvatar(current)}</span><h1>${esc(current.name)}</h1><p>${esc(current.instructions || current.description || leader?.role || '智能体')}</p><div class="dsh-hero-actions">${mutator('demo-ai', '演示一次 AI 回复', '', 'dsh-button primary')}${mutator('attachment-annotate', '框选页面批注', '', 'dsh-button')}</div><p class="dsh-hero-note">本地演示 · 不调用模型或执行器，轨迹和上下文收在顶部页签中。</p></div>`;
  }
  /** 输出对话页签内容：消息流、运行状态与输入框。@param {object} current 当前会话。@param {object} active 当前任务。@param {boolean} readonly 是否只读。@returns {string} 对话页 HTML。 */
  function conversationTab(current, active, readonly) {
    const messages = current.messages.length ? `<div class="dsh-messages">${messageHistory(current)}</div>` : chatWelcome(current);
    const composerHtml = readonly
      ? '<p class="dsh-readonly-note">项目协作视图只读；发送消息与执行状态请到全局协作查看。</p>'
      : aiChat.runningBar(current) + composer(current, active);
    return `<div class="dsh-scroll-area"><div class="dsh-chat-scroll">${messages}</div>${composerHtml}</div>`;
  }
  /** 输出轨迹页签中的工具活动区。@param {object} current 当前会话。@returns {string} 工具活动 HTML。 */
  function toolActivity(current) {
    const calls = db.toolCalls.filter(call => call.room === current.id);
    if (!calls.length) return '';
    return `<section class="dsh-subsection"><div class="dsh-panel-head"><div><strong>工具活动</strong><span class="dsh-panel-meta">${calls.length} 次调用</span></div></div>${toolCards(current)}</section>`;
  }
  /** 输出编队页签：成员、任务与相关入口。@param {object} current 当前会话。@param {object[]} tasks 当前会话任务。@returns {string} 编队页 HTML。 */
  function teamPanel(current, tasks, readonly = false) {
    const leader = bot(current.leader);
    const members = roomMembers(current);
    const memberRows = members.map(member => `<li class="team-member ${member.id === current.leader ? 'is-leader' : ''}">${botAvatar(member, 'small')}<div class="team-main"><div class="team-name"><strong>${esc(member.name)}</strong>${member.id === current.leader ? '<span class="team-tag">Leader</span>' : ''}<span class="dot ${member.online ? 'green' : ''}" title="${member.online ? '可用' : '离线'}"></span></div><span class="team-role">${esc(member.role)} · ${esc(member.model)} · ${esc(member.runtime)}</span></div></li>`).join('');
    const headActions = readonly ? `<div class="dsh-panel-actions">${action('task-list', '全部任务', current.id, 'dsh-button')}</div>` : `<div class="dsh-panel-actions">${mutator('team', '管理成员', '', 'dsh-button')}${action('chat-settings', '会话设置', '', 'dsh-button')}</div>`;
    const taskActions = readonly ? action('task-list', '全部任务', current.id, 'dsh-button') : `${mutator('new-task', '新建任务', '', 'dsh-button')}${action('task-list', '全部任务', current.id, 'dsh-button')}`;
    return `<div class="team-panel"><div class="dsh-panel-head"><div><strong>编队</strong><span class="dsh-panel-meta">${members.length} 位 Bot · Leader ${esc(leader?.name || '未设置')}</span></div>${headActions}</div><ul class="team-members">${memberRows}</ul><div class="ctx-section-head"><h3>协作任务</h3><span class="ctx-count">${tasks.length}</span><span class="spacer"></span>${taskActions}</div>${tasks.length ? `<div class="dsh-task-list">${tasks.slice(0, 6).map(item => taskRow(item)).join('')}</div>` : '<p class="dsh-note">还没有协作任务；可在对话或加号菜单中显式创建。</p>'}<div class="dsh-panel-links">${readonly ? '' : action('context', '项目与工具', '', 'dsh-link')}${leader ? `<button type="button" class="dsh-link" data-bot-detail="${leader.id}">智能体配置</button>` : ''}</div></div>`;
  }
  /** 根据当前页签输出会话主体内容。@param {object} current 当前会话。@param {object[]} tasks 当前会话任务。@param {object} active 当前任务。@param {boolean} readonly 是否只读。@returns {string} 页签内容 HTML。 */
  function chatTabBody(current, tasks, active, readonly = false) {
    const tab = activeChatTab();
    if (tab === '轨迹') return `<div class="dsh-tab-panel"><div class="dsh-panel-scroll">${aiChat.trajectoryPanel(current)}${toolActivity(current)}</div></div>`;
    if (tab === '上下文') return `<div class="dsh-tab-panel"><div class="dsh-panel-scroll">${aiChat.contextPanel(current, readonly)}</div></div>`;
    if (tab === '编队') return `<div class="dsh-tab-panel"><div class="dsh-panel-scroll">${teamPanel(current, tasks, readonly)}</div></div>`;
    return conversationTab(current, active, readonly);
  }
  /** 直接展示项目相关群组与聊天记录，按标签所属项目筛选，只允许切换已有会话。@param {string} project 项目标识。@returns {string} 只读聊天布局；无创建、编辑标签或消息发送入口。 */
  function projectCollaboration(project) {
    const visible = db.rooms.filter(item => roomMatchesProject(item, project));
    const current = visible.find(item => item.id === ui.room) || visible[0];
    if (!current) return `<div class="collab-layout project-chat-view ${ui.mobileRooms ? 'mobile-rooms-open' : ''}">${ui.mobileRooms ? '<button type="button" class="mobile-rooms-backdrop" data-work="room-list-toggle" aria-label="关闭会话列表"></button>' : ''}<aside class="conversation-list">${visible.map(item => conversationItem(item, current?.id)).join('')}${empty('暂无相关会话')}</aside><section class="conversation-main dsh-chat"><div class="dsh-empty"><span class="dsh-empty-icon">${icon('folder')}</span><h3>项目协作只读</h3><p>项目只归集带有项目标签的会话；发送消息和查看执行状态请到全局协作。</p><button type="button" class="dsh-button primary" data-page="collaboration">打开全局协作</button></div></section></div>`;
    const tasks = db.tasks.filter(item => item.room === current.id);
    return `<div class="collab-layout project-chat-view ${ui.mobileRooms ? 'mobile-rooms-open' : ''}">${ui.mobileRooms ? '<button type="button" class="mobile-rooms-backdrop" data-work="room-list-toggle" aria-label="关闭会话列表"></button>' : ''}<aside class="conversation-list">${visible.map(item => conversationItem(item, current.id)).join('')}</aside><section class="conversation-main dsh-chat">${chatHeader(current, true)}${chatTabBody(current, tasks, task(), true)}</section></div>`;
  }
  /** 渲染可收起的会话设置侧栏。@param {object} current 当前会话。@returns {string} 基本信息、成员、标签和工具配置入口。 */
  function settingsPanel(current){
    const leader=bot(current.leader);
    return `<aside class="chat-settings-panel" aria-label="会话设置"><div class="row"><h3>会话设置</h3><span class="spacer"></span>${action('hide-settings','<span class="sr-only">关闭会话设置</span>'+icon('close'),'','icon-btn')}</div><div class="settings-room-identity">${conversationAvatar(current)}<strong>${esc(current.name)}</strong></div><div class="settings-section"><div class="row"><strong>职责与指令</strong><span class="spacer"></span>${mutator('team','编辑','','text-btn')}</div><p>${esc(current.description||'尚未设置职责')}</p>${current.instructions?`<p class="room-instructions">${esc(current.instructions)}</p>`:''}</div><div class="settings-section"><div class="row"><strong>成员</strong><span class="spacer"></span>${mutator('team','管理','','text-btn')}</div>${roomMembers(current).map(member=>`<div class="settings-member">${botAvatar(member,'small')}<span>${esc(member.name)}<small>${esc(member.role)}</small></span>${member.id===current.leader?'<span class="badge">Leader</span>':''}<span class="dot ${member.online?'green':''}" title="${member.online?'可用':'离线'}"></span></div>`).join('')}</div><div class="settings-section"><div class="row"><strong>工作标签</strong><span class="spacer"></span>${mutator('topic-tags','管理','','text-btn')}</div><div class="room-topic-tags">${topicLabels(current)||'<span class="small quiet">暂无标签</span>'}</div></div><div class="settings-links">${action('context','项目与工具'+icon('arrow'),'','settings-link')}${leader?`<button class="settings-link" data-bot-detail="${leader.id}"><span>智能体配置<small>${esc(leader.model)} · ${esc(leader.runtime)}</small></span>${icon('arrow')}</button>`:''}${action('task-list','协作任务'+icon('arrow'),current.id,'settings-link')}</div></aside>`;
  }
  /** 渲染 DSH 风格的输入区；生成中发送按钮切换为停止按钮。@param {object} current 当前会话。@param {object} active 当前任务。@returns {string} 输入表单 HTML。 */
  function composer(current, active) {
    const generating = aiChat.isGenerating(current.id);
    const send = generating
      ? `<button type="button" class="dsh-send dsh-stop" data-work="stop-generation" aria-label="停止生成" title="停止生成"><span class="dsh-send-ring" aria-hidden="true"></span>${icon('stop')}</button>`
      : `<button type="submit" class="dsh-send" aria-label="发送消息" ${disabled()} ${current.draft?.trim() ? '' : 'disabled'}>${icon('send')}</button>`;
    return `<form class="dsh-composer ${generating ? 'is-generating' : ''}" data-work-form="message"><div class="mention-results" id="work-mentions"></div>${active ? `<div class="composer-task-mode">${action('message-mode', ui.messageMode === '补充当前任务' ? '正在补充任务 · 取消' : '补充当前任务', '', 'text-btn')}</div>` : ''}${aiChat.composerAttachments(current)}<textarea rows="1" name="message" data-work-input="draft" class="dsh-composer-input" aria-label="协作消息" placeholder="发消息给 ${esc(current.name)}，输入 @ 引用资源" ${disabled()}>${esc(current.draft)}</textarea><input type="hidden" name="mode" value="${ui.messageMode || '讨论'}"><div class="dsh-composer-bar"><button type="button" data-work="chat-menu" class="dsh-icon-btn composer-add" aria-label="添加附件、批注或演示" title="添加附件、批注或演示">${icon('plus')}</button><span class="dsh-composer-hint">本地演示 · 未调用模型</span><span class="spacer"></span>${send}</div></form>`;
  }
  /** 渲染共享会话、群组成员和当前任务。@param {string} project 限定项目，可为空。@returns {string} 协作页面。 */
  function collaboration(project = '') {
    if (project) return projectCollaboration(project);
    if (!room()) ui.room = 'direct-product';
    const r = room(), tasks = db.tasks.filter(t => t.room === r.id), active = task();
    const rooms = db.rooms.filter(item => (!project || item.projects.includes(project)) && `${item.name} ${projectName(item.project)}`.includes(ui.query));
    const inbox = db.tasks.filter(t => ['待确认', '待验收', '等待配置', '受阻'].includes(t.phase));
    const unread = db.notifications.filter(n => !n.read).length;
    const folders = Array.isArray(db.folders) ? db.folders : [], ungrouped = rooms.filter(item => !folders.some(folder => folder.id === item.folderId));
    return `<div class="collab-layout ${ui.mobileRooms ? 'mobile-rooms-open' : ''}">${ui.mobileRooms ? '<button type="button" class="mobile-rooms-backdrop" data-work="room-list-toggle" aria-label="关闭会话列表"></button>' : ''}<aside class="conversation-list"><div class="row conv-tools"><button type="button" class="icon-btn mobile-menu" data-action="menu" aria-label="展开导航">${icon('menu')}</button><h2 class="sr-only">协作</h2><label class="search"><input data-work-input="room-search" value="${esc(ui.query)}" placeholder="搜索会话" aria-label="搜索会话"></label><div class="create-wrap"><button type="button" class="icon-btn" data-work="new-menu" aria-haspopup="menu" aria-expanded="${ui.createMenu === true ? 'true' : 'false'}"><span class="sr-only">新建</span>${icon('plus')}</button>${ui.createMenu ? `<div class="create-menu" role="menu" aria-label="新建"><button type="button" role="menuitem" data-work="new-assistant">${icon('bot')}<span>新建助手</span></button><button type="button" role="menuitem" data-work="new-group">${icon('chat')}<span>新建群聊</span></button><button type="button" role="menuitem" data-work="new-folder">${icon('folder')}<span>新建文件夹</span></button></div>` : ''}</div>${action('notices', '<span class="sr-only">通知中心</span>' + icon('bell') + (unread ? `<span class="notice-count" aria-hidden="true">${unread}</span>` : ''), '', 'icon-btn notice-btn')}</div><button class="inbox-link ${ui.view === '待你处理' ? 'active' : ''}" data-work="inbox">${icon('inbox')}待你处理<span class="counter">${inbox.length}</span></button>${folders.map(folder => { const items = rooms.filter(item => item.folderId === folder.id); if (ui.query && !items.length) return ''; return `<section class="conversation-folder"><div class="folder-heading"><span class="folder-name">${icon('folder')}<span>${esc(folder.name)}</span><span class="counter">${items.length}</span></span>${mutator('delete-folder', '<span class="sr-only">删除文件夹</span>' + icon('close'), folder.id, 'icon-btn folder-delete')}</div>${items.map(item => conversationItem(item, r.id)).join('') || '<p class="folder-empty">文件夹为空，可在会话设置中归入。</p>'}</section>`; }).join('')}${folders.length && ungrouped.length ? '<p class="list-caption">其他会话</p>' : ''}${ungrouped.map(item => conversationItem(item, r.id)).join('')}${rooms.length ? '' : empty('没有匹配的会话')}</aside>
    ${ui.view === '待你处理' ? `<section class="conversation-main dsh-chat">${heading('待你处理', action('room', '返回会话', r.id))}<div class="work-padding">${inbox.length ? inbox.map(t => taskRow(t)).join('') : empty('暂时没有需要你处理的工作', '任务的配置请求、阻塞和待验收结果会出现在这里。')}</div></section>` : `<section class="conversation-main dsh-chat">${chatHeader(r)}${chatTabBody(r, tasks, active)}</section>${ui.settings ? settingsPanel(r) : active && active.room === r.id ? taskPanel(active) : ''}`}</div>`;
  }
  /** 输出任务摘要入口。@param {object} t 任务。@returns {string} 列表行。 */
  function taskRow(t) {return `<button class="work-task-row" data-work="open-task" data-id="${t.id}"><span><strong>${esc(t.title)}</strong><small>${esc(projectName(t.project))} · 业务负责人 ${esc(t.owner)} · 执行者 ${esc(bot(t.executor)?.name||'未指定')}</small></span>${chip(t.phase)}</button>`;}
  /** 渲染任务面板，业务状态与执行结果分别维护。@param {object} t 任务。@returns {string} 可推进任务的面板。 */
  function taskPanel(t) {
    const boundIssue=data.rows.find(row=>row.id===t.issue&&row.project===t.project);
    return `<aside class="work-task-panel"><div class="row"><h3>当前任务</h3><span class="spacer"></span>${action('hide-task',icon('close'),'','icon-btn')}</div><div class="task-title">${esc(t.title)}</div>${chip(t.phase,t.phase==='已完成'?'success':'')}<dl class="work-properties"><dt>目标项目</dt><dd>${esc(projectName(t.project))}</dd><dt>业务负责人</dt><dd>${esc(t.owner)}</dd><dt>执行者</dt><dd>${esc(bot(t.executor)?.name||'未指定')}${bot(t.executor)&&!bot(t.executor).online?' · 离线':''}</dd>${t.project?`<dt>目标环境</dt><dd>${esc(t.environment)}</dd>`:''}<dt>来源</dt><dd>${esc(t.source)}</dd>${boundIssue?`<dt>关联事项</dt><dd>${action('issue',boundIssue.id,t.id,'text-btn')} · ${esc(boundIssue.status)}</dd>`:''}</dl><p class="task-note">${esc(t.note)}</p><div class="task-actions">${!['已完成','已取消'].includes(t.phase)?mutator('handover','转交 / 调整',t.id):''}${t.phase==='待开始'?mutator('start-task','开始演示任务',t.id,'btn primary'):''}${['进行中','受阻'].includes(t.phase)?mutator('report',t.project?'提交开发结果':'提交任务结果',t.id,'btn primary'):''}${t.project&&['进行中','待开始','受阻'].includes(t.phase)?mutator('request-secret','请求环境变量',t.id):''}${t.phase==='等待配置'?mutator('resolve-secret','配置并授权',t.id,'btn primary'):''}${t.phase==='等待配置'?mutator('resume-task','检查配置并继续',t.id):''}${t.phase==='待验收'?mutator('accept','验收结果',t.id,'btn primary'):''}${t.phase==='待验收'?mutator('changes','需要修改',t.id):''}${t.phase==='已完成'&&t.project?mutator('release','制定发布计划',t.id,'btn primary'):''}${['进行中','等待配置','待开始','受阻'].includes(t.phase)?mutator('stop-task','停止后续执行',t.id):''}${t.phase==='已取消'?mutator('retry-task','重新开始',t.id):''}</div>${t.handoff?`<section class="task-result"><h3>交付结果</h3><dl class="work-properties">${t.project?`<dt>分支</dt><dd>${esc(t.handoff.branch)}</dd><dt>Commit</dt><dd>${esc(t.handoff.commit)}</dd><dt>测试</dt><dd>${esc(t.handoff.tests)}</dd><dt>产物</dt><dd>${esc(t.handoff.artifact)}</dd>`:`<dt>完成情况</dt><dd>${esc(t.handoff.tests)}</dd>`}</dl><p>${esc(t.handoff.summary)}</p></section>`:''}<h3 class="task-section-title">交接记录</h3><ol class="task-timeline">${t.events.slice().reverse().map(event=>`<li>${esc(event)}</li>`).join('')}</ol><p class="small quiet">执行完成后仍需业务验收。</p></aside>`;
  }

 return {collaboration,taskRow,taskPanel};
}
