/** 创建团队凭据库界面。@param {object} ctx 团队数据、项目、状态和表单工具。@returns {object} 页面渲染接口；只保存凭据元数据，不保存或发送输入的密钥。 */
export function createVault(ctx){
  const {data,state,projects,esc,icon,options,dialog,toast,persist,render,modal}=ctx;
  if(!data.vault)data.vault={items:[],requests:[],audit:[]};
  const store=data.vault,ui={selected:'',category:'全部',query:''};
  const admin=()=>state.role==='管理员';
  const stamp=()=>new Date().toLocaleString('zh-CN');
  const valid=item=>item?.enabled&&(!item.expiresAt||item.expiresAt>Date.now());
  const button=(action,label,id='',disabled=false)=>`<button type="button" class="btn" data-vault="${action}" data-id="${esc(id)}" ${disabled?'disabled':''}>${label}</button>`;
  const log=text=>store.audit.unshift(stamp()+' · '+text);
  const save=()=>{persist();render();};
  const end=label=>`<p class="field-error" role="alert"></p><div class="form-actions">${button('close','取消')}<button class="btn primary">${label}</button></div>`;
  /** 同步凭据引用的元数据，失效后阻塞依赖任务。@param {object} item 团队凭据记录。@returns {void} 更新本地引用与任务，不复制密钥值。 */
  function syncReferences(item){
    const refs=data.workspace.variables.filter(v=>v.keychainId===item.id);
    refs.forEach(v=>{v.version=item.version;v.enabled=valid(item)&&item.projects.includes(v.project);v.bots=v.bots.filter(id=>item.bots.includes(id));v.expiresAt=item.expiresAt;});
    data.workspace.tasks.filter(t=>t.requiredKey&&refs.some(v=>v.project===t.project&&v.environment===t.environment&&v.name===t.requiredKey&&(!v.enabled||!v.bots.includes(t.executor)))&&!['已完成','已取消'].includes(t.phase)).forEach(t=>{t.phase='等待配置';t.events.push(stamp()+' · 团队凭据授权失效');});
  }
  /** 渲染可搜索的凭据目录与详情。@returns {string} 双栏凭据库页面，无真实密钥明文。 */
  function page(){
    const categories=['全部','API 密钥','账号密码','SSH 密钥','已撤销'];
    const list=store.items.filter(i=>(ui.category==='全部'||(ui.category==='已撤销'?!i.enabled:i.kind===ui.category))&&`${i.name} ${i.account} ${i.host}`.toLowerCase().includes(ui.query.toLowerCase()));
    const selected=list.find(i=>i.id===ui.selected)||list[0];
    return `<div class="keychain-layout"><aside class="keychain-list"><div class="vault-toolbar"><button type="button" class="icon-btn mobile-menu" data-action="menu" aria-label="展开导航">${icon('menu')}</button><label class="search">${icon('search')}<input id="vault-search" aria-label="搜索凭据" placeholder="搜索凭据" value="${esc(ui.query)}"></label><button type="button" class="icon-btn vault-add" data-vault="${admin()?'new':'request'}" aria-label="${admin()?'添加凭据':'请求配置'}" title="${admin()?'添加凭据':'请求配置'}" ${state.role==='浏览者'?'disabled':''}>${icon('plus')}</button></div><div class="keychain-categories">${categories.map(c=>button('category',c,c)).join('')}</div>${list.map(i=>`<button class="keychain-item ${selected?.id===i.id?'selected':''}" data-vault="select" data-id="${i.id}"><span class="key-symbol">${icon('lock')}</span><span><strong>${esc(i.name)}</strong><small>${esc(i.account||i.kind)}</small></span>${valid(i)?'':'<small>不可用</small>'}</button>`).join('')||'<div class="empty"><p>暂无凭据</p><small>可添加 API、账号或 SSH 凭据。</small></div>'}</aside><section class="keychain-detail">${selected?detail(selected):`<div class="empty">${icon('lock')}<h2>团队的凭据保险箱</h2><p>由管理员配置；Bot 和项目按范围使用。</p>${admin()?button('new','添加第一条凭据'):''}</div>`}</section></div>${logBox()}`;
  }
  /** 渲染不占正文空间的日志入口。@returns {string} 右下角按钮和待配置数量。 */
  function logBox(){
    const pending=store.requests.filter(r=>r.status==='待配置').length;
    return `<button type="button" class="vault-log-trigger" data-vault="logs" aria-label="打开日志箱${pending?'，'+pending+' 项待配置':''}" title="日志箱">${icon('inbox')}${pending?`<span class="vault-log-count">${pending}</span>`:''}</button>`;
  }
  /** 打开活动记录弹窗；筛选只影响当前展示，不改变记录。@param {string} filter 记录类别，默认为全部。@returns {void} 使用共享弹窗并允许键盘关闭。 */
  function openLogs(filter='全部'){
    const requests=filter==='管理记录'?[]:store.requests;
    const audit=filter==='配置请求'?[]:store.audit;
    dialog('活动记录',`<div class="vault-log-filters" role="group" aria-label="日志类型">${['全部','配置请求','管理记录'].map(name=>`<button class="btn ${filter===name?'blue':''}" data-vault="logs" data-id="${name}" aria-pressed="${filter===name}">${name}</button>`).join('')}</div><div class="vault-log-entries">${requests.length?`<section aria-label="配置请求">${requests.map(request=>`<article class="vault-log-request"><div class="row"><strong>${esc(request.name)}</strong><span class="spacer"></span><span class="badge">${esc(request.status)}</span></div><p>${esc(request.purpose)}</p>${admin()&&request.status==='待配置'?button('resolve','配置',request.id):''}</article>`).join('')}</section>`:''}${audit.length?`<section aria-label="管理记录">${audit.map(entry=>`<p class="vault-log-entry">${esc(entry)}</p>`).join('')}</section>`:''}${!requests.length&&!audit.length?'<div class="vault-log-empty">暂无记录</div>':''}</div>`);
    modal.classList.add('vault-log-dialog');
    modal.querySelector(`[data-id="${filter}"]`).focus();
  }
  /** 显示选中条目的账号、范围、引用和操作。@param {object} item 凭据元数据。@returns {string} 已转义的详情 HTML。 */
  function detail(item){const refs=data.workspace.variables.filter(v=>v.keychainId===item.id);return `<div class="row"><span class="key-symbol large">${icon('lock')}</span><div><h2>${esc(item.name)}</h2><p>${esc(item.kind)} · v${item.version}</p></div><span class="spacer"></span><span class="badge">${valid(item)?'可用':'已撤销 / 过期'}</span></div><dl class="key-properties"><dt>账号</dt><dd>${esc(item.account||'不适用')}</dd><dt>地址</dt><dd>${esc(item.host||'未填写')}</dd><dt>密钥</dt><dd>•••••••• <span class="small muted">原型不保存明文</span></dd><dt>使用方式</dt><dd>运行时注入</dd><dt>授权期限</dt><dd>${item.expiresAt?esc(new Date(item.expiresAt).toLocaleString('zh-CN')):'长期有效'}</dd><dt>项目</dt><dd>${esc(item.projects.map(id=>projects.find(p=>p.id===id)?.name||id).join('、')||'未授权')}</dd><dt>Bots</dt><dd>${esc(item.bots.map(id=>data.bots.find(b=>b.id===id)?.name||id).join('、')||'未授权')}</dd></dl><div class="row key-actions">${button('copy','复制引用',item.id)}${admin()?button('edit','编辑 / 轮换',item.id)+button('bind','引用到项目环境',item.id,!valid(item))+button('revoke',item.enabled?'撤销授权':'已撤销',item.id,!item.enabled):''}</div><h3 class="work-gap">使用此凭据的环境</h3>${refs.map(v=>`<div class="credential-reference"><strong>${esc(projects.find(p=>p.id===v.project)?.name)} · ${esc(v.environment)}</strong><code>${esc(v.name)}</code><span>${v.enabled?'引用生效':'已失效'}</span></div>`).join('')||'<p class="small muted">还没有项目引用。配置项目授权后可选择目标环境。</p>'}`;}
  /** 打开新增或轮换表单；输入值不从数据回填。@param {object} item 可选已有条目。@param {object} request 可选配置请求。@returns {void} 打开表单。 */
  function form(item,request){dialog(item?'编辑 / 轮换凭据':'添加团队凭据',`<form data-vault-form="item" data-id="${item?.id||''}" data-request="${request?.id||''}"><div class="form-grid"><label class="field">名称<input name="name" required maxlength="60" value="${esc(item?.name||request?.name||'')}"></label><label class="field">类型<select name="kind">${options(['API 密钥','账号密码','SSH 密钥'],item?.kind||'API 密钥')}</select></label><label class="field">账号<input name="account" maxlength="120" value="${esc(item?.account||'')}"></label><label class="field">服务地址<input name="host" maxlength="200" value="${esc(item?.host||'')}"></label><label class="field full">${item?'新测试密钥（留空保留版本）':'测试密钥'}<input name="secret" type="password" autocomplete="new-password" ${item?'':'required'} maxlength="6000"></label><label class="field">授权期限<select name="expiry">${options(['24 小时','长期有效'],item?.expiresAt?'24 小时':'长期有效')}</select></label><div class="field full"><span>允许引用的项目</span><div class="work-checks">${projects.map(p=>`<label><input type="checkbox" name="projects" value="${p.id}" ${item?.projects.includes(p.id)?'checked':''}>${esc(p.name)}</label>`).join('')}</div></div><div class="field full"><span>允许使用的 Bots</span><div class="work-checks">${data.bots.filter(b=>b.enabled).map(b=>`<label><input type="checkbox" name="bots" value="${b.id}" ${item?.bots.includes(b.id)?'checked':''}>${esc(b.name)}</label>`).join('')}</div></div></div><p class="small muted">项目引用不会扩大授权。真实值不存入浏览器、聊天、模板或公开链接。</p>${end('保存凭据')}</form>`);}
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-vault]');if(!el)return;const action=el.dataset.vault,id=el.dataset.id,item=store.items.find(i=>i.id===id);
    if(action==='logs'){openLogs(id||'全部');return;}
    if(action==='close'){modal.close();return;}
    if(action==='category'){ui.category=id;render();return;}
    if(action==='select'){ui.selected=id;render();return;}
    if(action==='copy'&&item){const ref='keychain://'+teamId()+'/'+item.id;navigator.clipboard.writeText(ref).then(()=>toast('已复制凭据引用，不含密钥')).catch(()=>dialog('手动复制引用',`<input readonly value="${esc(ref)}">`));return;}
    if(action==='request'){if(state.role==='浏览者'){toast('浏览者不能提交请求');return;}dialog('请求团队配置',`<form data-vault-form="request"><label class="field">凭据名称<input name="name" required maxlength="60"></label><label class="field">用途与使用范围<textarea name="purpose" required maxlength="1000"></textarea></label>${end('提交请求')}</form>`);return;}
    if(!admin()){toast('只有管理员可以配置团队凭据');return;}
    if(action==='new'||action==='edit'||action==='resolve'){form(item,store.requests.find(r=>r.id===id));return;}
    if(!item)return;
    if(action==='revoke'){item.enabled=false;log('撤销凭据：'+item.name);syncReferences(item);save();return;}
    if(action==='bind'){dialog('引用到项目环境',`<form data-vault-form="bind" data-id="${id}"><label class="field">项目<select name="project">${projects.filter(p=>item.projects.includes(p.id)).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><label class="field">环境<select name="environment">${options(['开发','测试','生产'],'测试')}</select></label><label class="field">环境变量名<input name="name" required pattern="[A-Z_][A-Z0-9_]*" placeholder="CLOUD_API_TOKEN"></label><p class="small muted">引用仅限已授权项目和 Bots，不复制密钥。相同环境中的已有名称不会被覆盖。</p>${end('保存引用')}</form>`);}
  });
  const teamId=()=>ctx.teamContext.team.id;
  document.addEventListener('input',event=>{if(event.target.id!=='vault-search')return;ui.query=event.target.value;const pos=event.target.selectionStart;render();const input=document.getElementById('vault-search');input.focus();input.setSelectionRange(pos,pos);});
  document.addEventListener('submit',event=>{
    const f=event.target;if(!f.matches('[data-vault-form]'))return;event.preventDefault();const values=new FormData(f),get=k=>String(values.get(k)||'').trim(),error=msg=>f.querySelector('.field-error').textContent=msg;
    if(f.dataset.vaultForm==='request'){if(state.role==='浏览者')return;store.requests.unshift({id:'request-'+Date.now(),name:get('name'),purpose:get('purpose'),status:'待配置'});modal.close();save();return;}
    if(!admin()){error('只有管理员可以配置凭据');return;}
    if(f.dataset.vaultForm==='item'){
      let item=store.items.find(i=>i.id===f.dataset.id);if(store.items.some(i=>i.id!==item?.id&&i.name===get('name'))){error('已有同名凭据');return;}
      const rotate=!!get('secret');if(!item&&!rotate){error('请输入测试密钥');return;}
      const config={name:get('name'),kind:get('kind'),account:get('account'),host:get('host'),projects:values.getAll('projects').filter(id=>projects.some(p=>p.id===id)),bots:values.getAll('bots').filter(id=>data.bots.some(b=>b.id===id&&b.enabled)),enabled:true,expiresAt:get('expiry')==='24 小时'?Date.now()+86400000:null,updated:stamp()};
      if(item){Object.assign(item,config);if(rotate)item.version++;}else{item={id:'key-'+Date.now(),version:1,...config};store.items.push(item);}
      f.elements.secret.value='';values.delete('secret');ui.selected=item.id;log((rotate?'配置 / 轮换：':'更新授权：')+item.name);syncReferences(item);const request=store.requests.find(r=>r.id===f.dataset.request);if(request)request.status='已配置';
    }
    if(f.dataset.vaultForm==='bind'){
      const item=store.items.find(i=>i.id===f.dataset.id),project=get('project'),environment=get('environment');if(!valid(item)||!item.projects.includes(project)){error('凭据已失效或项目未获授权');return;}
      if(!item.bots.length){error('请先授权至少一位 Bot');return;}
      if(data.workspace.variables.some(v=>v.project===project&&v.environment===environment&&v.name===get('name'))){error('目标环境已有同名变量，请换一个名称');return;}
      data.workspace.variables.push({id:'env-'+Date.now(),project,environment,name:get('name'),type:'密钥',keychainId:item.id,value:'',mode:'运行时注入',bots:[...item.bots],configured:true,version:item.version,enabled:true,updated:stamp(),expires:item.expiresAt?'24 小时':'长期有效',expiresAt:item.expiresAt});log('引用 '+item.name+' → '+project+' / '+environment+' / '+get('name'));
    }
    modal.close();save();
  });
  modal.addEventListener('close',()=>{const input=modal.querySelector('[name="secret"]');if(input)input.value='';});
  return {page};
}
