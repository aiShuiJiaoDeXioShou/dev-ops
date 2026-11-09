const registryKey='dev-ops-prototype-teams-v1';
const baseKey='dev-ops-prototype-v1';
/** 加载团队索引；旧版数据继续属于研发团队。@returns {object} 当前团队、角色和独立存储键；读取失败保留错误提示，不覆盖旧值。 */
export function loadTeamContext(){
  const member=()=>({id:'me',name:'林然',email:'lin@example.test',role:'管理员',status:'正常'});
  let registry={current:'engineering',teams:[{id:'engineering',name:'研发团队',mark:'研',members:[member(),{id:'chen',name:'陈悦',email:'chen@example.test',role:'开发者',status:'正常'},{id:'zhou',name:'周宁',email:'zhou@example.test',role:'浏览者',status:'正常'}]},{id:'product',name:'产品团队',mark:'产',members:[member()]}]},warning='';
  try{const raw=localStorage.getItem(registryKey);if(raw){const parsed=JSON.parse(raw);if(!Array.isArray(parsed.teams)||!parsed.teams.length||!parsed.teams.every(t=>typeof t.id==='string'&&typeof t.name==='string'&&typeof t.mark==='string'&&Array.isArray(t.members)))throw new Error('团队记录格式异常');registry=parsed;}}catch(error){warning='团队记录读取失败，本次使用演示团队：'+error.message;}
  const team=registry.teams.find(t=>t.id===registry.current)||registry.teams[0];registry.current=team.id;
  return {registry,team,warning,role:team.members.find(m=>m.id==='me'&&m.status==='正常')?.role||'浏览者',storageKey:team.id==='engineering'?baseKey:baseKey+':'+team.id};
}
/** 创建团队切换与管理员页面。@param {object} ctx 当前团队、状态和表单工具。@returns {object} 页面和切换条渲染接口；邀请仅保存本地，不发送邮件。 */
export function createTeamAdmin(ctx){
  const {state,esc,icon,options,dialog,toast,render,modal,teamContext}=ctx;
  const {registry,team}=teamContext;
  const admin=()=>state.role==='管理员';
  const button=(name,label,id='',disabled=false)=>`<button type="button" class="btn" data-team="${name}" data-id="${esc(id)}" ${disabled?'disabled':''}>${label}</button>`;
  const denied=()=>{if(admin())return false;toast('只有管理员可以管理团队');return true;};
  const save=()=>{try{localStorage.setItem(registryKey,JSON.stringify(registry));return true;}catch(error){toast('团队配置暂未保存：'+error.message);return false;}};
  /** 输出紧凑团队切换图标，当前团队有描边。@returns {string} 切换条 HTML，未处理邀请显示数量。 */
  function switcher(){const joined=registry.teams.filter(t=>t.members.some(m=>m.id==='me'&&m.status==='正常'));if(joined.length<2)return '';return `<div class="team-switcher" aria-label="切换团队">${joined.map(t=>{const count=t.members.filter(m=>m.status==='待加入').length;return `<button class="team-token ${t.id===team.id?'active':''}" data-team="switch" data-id="${esc(t.id)}" aria-label="切换到${esc(t.name)}" aria-pressed="${t.id===team.id}" title="${esc(t.name)}"><span>${esc(t.mark)}</span>${count?`<small>${count}</small>`:''}</button>`;}).join('')}<button class="team-more" data-team="menu" aria-label="团队选项">···</button></div>`;}
  /** 渲染团队资料、成员及邀请记录。@returns {string} 管理页面；非管理员只显示权限说明。 */
  function page(){
    if(!admin())return `<div class="empty"><h2>仅管理员可访问</h2><p>团队成员与权限由管理员维护。</p></div>`;
    return `<header class="work-page-head compact-page-head"><button type="button" class="icon-btn mobile-menu" data-action="menu" aria-label="展开导航">${icon('menu')}</button><h1 class="sr-only">团队管理</h1><div class="row team-head-actions">${button('invite','＋ 邀请成员')}${button('profile','编辑团队')}</div></header><div class="work-padding team-admin"><section class="team-profile"><div class="team-token active"><span>${esc(team.mark)}</span></div><div><h2>${esc(team.name)}</h2></div></section><div class="section-heading"><h2>成员与权限</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>成员</th><th>邮箱</th><th>角色</th><th>状态</th><th></th></tr></thead><tbody>${team.members.map(m=>`<tr><td><strong>${esc(m.name)}</strong>${m.id==='me'?' <span class="badge">我</span>':''}</td><td>${esc(m.email)}</td><td>${esc(m.role)}</td><td>${esc(m.status)}</td><td>${m.status==='待加入'?button('join','模拟加入',m.id)+button('cancel','撤销邀请',m.id):button('member','管理',m.id)}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  const end=label=>`<p class="field-error" role="alert"></p><div class="form-actions">${button('close','取消')}<button class="btn primary">${label}</button></div>`;
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-team]');if(!el)return;const name=el.dataset.team,id=el.dataset.id;
    if(name==='close'){modal.close();return;}
    if(name==='menu'){dialog('团队',`<div class="team-menu">${registry.teams.map(t=>button('switch',esc(t.name),t.id)).join('')}</div><div class="form-actions">${admin()?button('manage','管理当前团队'):''}${button('close','关闭')}</div>`);return;}
    if(name==='switch'){if(id===team.id){modal.close();return;}if(!registry.teams.some(t=>t.id===id&&t.members.some(m=>m.id==='me'&&m.status==='正常'))){toast('你尚未加入这个团队');return;}registry.current=id;if(save())location.assign(location.pathname+'?v=20261108-30&page=collaboration');return;}
    if(denied())return;
    if(name==='manage'){modal.close();state.page='team-admin';render();return;}
    if(name==='profile'){dialog('编辑团队',`<form data-team-form="profile"><label class="field">团队名称<input name="name" value="${esc(team.name)}" maxlength="30" required></label><label class="field">图标文字<input name="mark" value="${esc(team.mark)}" maxlength="2" required></label>${end('保存')}</form>`);return;}
    if(name==='invite'){dialog('邀请团队成员',`<form data-team-form="invite"><label class="field">姓名<input name="name" maxlength="30" required></label><label class="field">邮箱<input name="email" type="email" required></label><label class="field">角色<select name="role">${options(['开发者','浏览者','管理员'],'开发者')}</select></label><p class="small muted">保存本地邀请记录，正式邮件发送尚未接入。</p>${end('创建邀请')}</form>`);return;}
    const m=team.members.find(m=>m.id===id);if(!m)return;
    if(name==='member'){dialog('管理 '+m.name,`<form data-team-form="member" data-id="${esc(id)}"><div class="form-stack"><label class="field">角色<select name="role">${options(['管理员','开发者','浏览者'],m.role)}</select></label><label class="field">状态<select name="status">${options(['正常','已停用'],m.status)}</select></label></div>${end('保存成员')}</form>`);return;}
    if(name==='join'&&m.status==='待加入'){m.status='正常';}
    else if(name==='cancel'&&m.status==='待加入'){team.members=team.members.filter(item=>item.id!==id);}else return;
    save();render();
  });
  document.addEventListener('submit',event=>{
    const form=event.target;if(!form.matches('[data-team-form]'))return;event.preventDefault();if(denied())return;
    const values=new FormData(form),get=k=>String(values.get(k)||'').trim(),error=msg=>form.querySelector('.field-error').textContent=msg;
    if(form.dataset.teamForm==='profile'){if(!get('name')||!get('mark'))return;team.name=get('name');team.mark=get('mark');}
    if(form.dataset.teamForm==='invite'){if(team.members.some(m=>m.email.toLowerCase()===get('email').toLowerCase())){error('该邮箱已存在成员或待处理邀请');return;}team.members.push({id:'member-'+Date.now(),name:get('name'),email:get('email'),role:get('role'),status:'待加入'});}
    if(form.dataset.teamForm==='member'){const m=team.members.find(m=>m.id===form.dataset.id);if(!m)return;if(m.role==='管理员'&&m.status==='正常'&&(get('role')!=='管理员'||get('status')!=='正常')&&!team.members.some(other=>other.id!==m.id&&other.role==='管理员'&&other.status==='正常')){error('不能停用或降级最后一位管理员');return;}m.role=get('role');m.status=get('status');if(m.id==='me')state.role=m.status==='正常'?m.role:'浏览者';}
    save();modal.close();render();
  });
  if(teamContext.warning)toast(teamContext.warning);
  return {switcher,page};
}
