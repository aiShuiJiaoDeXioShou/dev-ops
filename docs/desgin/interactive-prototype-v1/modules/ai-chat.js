/**
 * AI 对话状态模块：对话、执行轨迹、上下文与生成控制。
 *
 * 原型未接入真实模型或执行器，回复、轨迹和耗时均为本地演示，并始终显示“本地模拟”
 * 标识。执行轨迹、上下文与编队信息收进独立页签，聊天流只保留对话本身。
 */
import {renderMarkdown} from './markdown.js?v=20261108-30';

/** 生成过程各阶段等待时长，仅用于让状态变化可观察。 */
const STEP_WAIT = {think: 420, file: 620, cmd: 780, tool: 520, failed: 480, chat: 380};
/** 流式输出每次追加的字符数与间隔。 */
const STREAM_CHARS = 5;
const STREAM_INTERVAL = 16;
/** 完成后延迟重建视图，让输入区恢复空闲态。 */
const FINISH_DELAY = 260;

/** 把毫秒转换为一位小数的秒数文本。@param {number} ms 毫秒。@returns {string} 形如 `1.2 秒` 的耗时。 */
function seconds(ms) {
  const value = Math.max(0, ms) / 1000;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} 秒`;
}

/** 按字符长度切分文本，避免流式输出一次渲染过多节点。@param {string} text 完整文本。@param {number} size 每段字符数。@returns {string[]} 文本片段。 */
function sliceText(text, size) {
  const chunks = [];
  for (let index = 0; index < text.length; index += size) chunks.push(text.slice(index, index + size));
  return chunks;
}

/**
 * 创建 AI 对话状态控制器。
 * @param {object} ctx 会话共享上下文：data、db、ui、state、esc、icon、botAvatar、bot、persist、render、toast、action、mutator。
 * @returns {object} 消息渲染、页签视图、生成控制与附件渲染接口。
 */
export function createAiChat(ctx) {
  const {data, db, ui, state, esc, icon, botAvatar, bot, persist, render, toast, action, mutator} = ctx;
  /** 当前正在运行的演示；同一时间只允许一条。 */
  let active = null;
  let timerSeed = 0;

  const stamp = () => new Date().toLocaleString('zh-CN', {hour12: false});
  const nextId = prefix => `${prefix}-${Date.now()}-${(timerSeed += 1)}`;
  const roleDisabled = () => (state?.role === '浏览者' ? 'disabled' : '');
  const shortTime = value => String(value || '').split(' ').at(-1) || '';
  const durationOf = entry => seconds(entry?.trace?.durationMs || 0);

  /** 步骤类型对应的图形与中文标签。@param {string} type 步骤类型。@returns {object} 图标名和可读名称。 */
  function stepMeta(type) {
    const map = {
      think: {icon: 'model', label: '思考'},
      file: {icon: 'file', label: '读取文件'},
      cmd: {icon: 'terminal', label: '运行命令'},
      tool: {icon: 'skill', label: '工具调用'},
      failed: {icon: 'bug', label: '执行失败'},
      chat: {icon: 'chat', label: '生成回答'},
    };
    return map[type] || map.think;
  }

  /** 输出步骤状态图形，进行中使用旋转圆环。@param {string} status 步骤状态。@returns {string} 状态图标 HTML。 */
  function stepStatusIcon(status) {
    if (status === 'running') return '<span class="dsh-spinner" aria-label="进行中"></span>';
    if (status === 'done') return icon('check');
    if (status === 'failed') return icon('close');
    if (status === 'interrupted') return icon('stop');
    return '<span class="dsh-pending" aria-hidden="true"></span>';
  }

  /** 输出可读的步骤状态。@param {string} status 步骤状态。@returns {string} 中文状态。 */
  function stepStatusLabel(status) {
    return ({running: '进行中', done: '已完成', failed: '失败', interrupted: '已中断'})[status] || '等待';
  }

  /** 输出可读的运行状态。@param {object} entry AI 消息记录。@returns {string} 中文状态。 */
  function runStatusLabel(entry) {
    if (entry.status === 'streaming') return '进行中';
    if (entry.status === 'stopped') return '已中断';
    return '已完成';
  }

  /**
   * 生成一条演示回复的执行轨迹。
   * @param {object} context 生成上下文：botName、userText、attachments。
   * @returns {object[]} 步骤数组；失败步骤单独标记，用于核对失败与恢复状态。
   */
  function buildSteps(context) {
    const attachmentCount = context.attachments.length;
    const annotation = context.attachments.find(item => item.type === 'annotation');
    const attachmentLine = attachmentCount
      ? `识别到 ${attachmentCount} 项上下文附件${annotation ? `，包含对「${annotation.target?.label || '页面区域'}」的批注` : ''}。`
      : '当前会话没有显式附件，按会话上下文继续。';
    const target = String(context.userText || '').replace(/\s+/g, ' ').slice(0, 36);
    return [
      {type: 'think', title: '理解目标与上下文', summary: annotation ? '结合页面批注理解目标' : '解析会话目标与可用资源', detail: `${attachmentLine}目标摘要：${target || '核对登录权限刷新流程'}。`, wait: STEP_WAIT.think},
      {type: 'file', title: '读取文件 · src/auth/session.ts', summary: '定位 token 刷新与权限缓存', detail: '读取 214 行，重点检查登录成功后的权限快照写入、token 刷新回调与缓存失效条件。', wait: STEP_WAIT.file},
      {type: 'cmd', title: '运行命令 · rg "permissions" src', summary: '搜索权限相关调用点', detail: '匹配 7 处，其中 3 处位于登录与 token 刷新路径，未发现重复写入。', wait: STEP_WAIT.cmd},
      {type: 'tool', title: '工具调用 · 查询最近登录告警', summary: '聚合同类异常 2 条', detail: '最近一次出现在 09:40，均为登录后首次请求权限错误，暂未发现服务端 5xx。', wait: STEP_WAIT.tool},
      {type: 'failed', title: '查询历史 PR 失败', summary: '远端连接超时，已降级', detail: '远端代码平台在本原型中不可用，无法读取历史 PR；改为使用本地事项记录继续核对。', wait: STEP_WAIT.failed, willFail: true},
      {type: 'tool', title: '改用本地事项记录', summary: '读取关联事项 BUG-018', detail: '本地记录显示该问题仍处于修复中，已有排查结论保留；本次回复不会修改事项状态。', wait: 420},
      {type: 'chat', title: '整理修复建议', summary: '生成结论、代码与核对表', detail: '按结论、建议改动和核对项组织回复，并在页签中保留执行轨迹。', wait: STEP_WAIT.chat},
    ];
  }

  /**
   * 生成演示回复正文（Markdown）。
   * @param {object} context 生成上下文：botName、attachments、userText。
   * @returns {string} 带标题、列表、代码块、表格与引用的示例回复。
   */
  function composeReply(context) {
    const attachmentCount = context.attachments.length;
    const lines = [
      '## 排查结论',
      '',
      `结合${attachmentCount ? ` ${attachmentCount} 项上下文附件` : '当前会话上下文'}核对后，登录后权限未刷新更可能是**权限快照没有失效**，而不是接口返回异常。`,
      '',
      '1. 登录成功时写入的权限快照，在后续请求中继续生效。',
      '2. token 刷新后没有触发权限重新拉取。',
      '3. 权限变更事件缺少短时间去重，可能重复刷新。',
      '',
      '### 建议改动',
      '',
      '```ts',
      'export async function refreshPermissions(session: Session) {',
      '  const latest = await api.getPermissions(session.userId, {force: true});',
      '  session.permissions = latest.permissions;',
      '  session.permissionsUpdatedAt = Date.now();',
      '  return latest;',
      '}',
      '```',
      '',
      '| 检查项 | 当前表现 | 建议 |',
      '| --- | --- | --- |',
      '| 首次请求 | 使用旧快照 | 登录后强制刷新 |',
      '| token 刷新 | 未重新拉取 | 增加刷新回调 |',
      '| 权限事件 | 可能重复触发 | 增加 500ms 去重窗口 |',
      '',
      '> 本地演示内容：未调用真实模型或执行器，仅用于核对生成中的状态与中断交互。',
      '',
      `需要我把这个结论整理成修复任务，交给 **${context.botName}** 跟进吗？`,
    ];
    return lines.join('\n');
  }

  /** 输出附件类型对应的图标名。@param {string} type 附件类型。@returns {string} 图标名。 */
  function attachmentIcon(type) {
    if (type === 'link') return 'link';
    if (type === 'image') return 'image';
    if (type === 'annotation') return 'crosshair';
    return 'file';
  }

  /** 输出附件类型的中文名称。@param {string} type 附件类型。@returns {string} 类型文案。 */
  function attachmentLabel(type) {
    if (type === 'link') return '网页链接';
    if (type === 'image') return '图片';
    if (type === 'annotation') return '页面批注';
    return '文件';
  }

  /**
   * 输出一排上下文附件标签。
   * @param {object[]} attachments 附件数组。
   * @param {boolean} removable 是否显示移除按钮。
   * @returns {string} 可横向滚动的标签 HTML；空数组返回空字符串。
   */
  function attachmentChips(attachments, removable = false) {
    if (!Array.isArray(attachments) || !attachments.length) return '';
    return attachments.map(item => {
      const remove = removable
        ? `<button type="button" class="ctx-chip-remove" data-work="attachment-remove" data-id="${esc(item.id)}" aria-label="移除${esc(item.name)}">${icon('close')}</button>`
        : '';
      return `<span class="ctx-chip" data-kind="${esc(item.type)}" title="${esc(item.name)}">${icon(attachmentIcon(item.type))}<span class="ctx-chip-name">${esc(item.name)}</span>${remove}</span>`;
    }).join('');
  }

  /** 输出输入框上方的上下文标签行；没有附件时不占位。@param {object} room 当前会话。@returns {string} 标签行 HTML。 */
  function composerAttachments(room) {
    const attachments = room?.attachments || [];
    if (!attachments.length) return '';
    return `<div class="ctx-chips" data-context-chips aria-label="已添加上下文">${attachmentChips(attachments, true)}<button type="button" class="ctx-chip-add" data-work="attachment-add">${icon('plus')}添加上下文</button></div>`;
  }

  /** 输出用户消息中的附件摘要，详细内容收进“上下文”页签。@param {object} entry 消息记录。@returns {string} 摘要 HTML 或空字符串。 */
  function attachmentSummary(entry) {
    const count = Array.isArray(entry.attachments) ? entry.attachments.length : 0;
    if (!count) return '';
    return `<span class="dsh-sep" aria-hidden="true"></span><button type="button" class="dsh-link" data-work="chat-tab" data-id="上下文">${count} 个上下文附件</button>`;
  }

  /** 输出运行中的状态点与计时。@param {object} entry AI 消息记录。@returns {string} 进度 HTML。 */
  function runningFoot(entry) {
    const done = entry.trace.steps.filter(step => ['done', 'failed', 'interrupted'].includes(step.status)).length;
    return `<span class="dsh-pulse" aria-hidden="true"></span><span>深度求索中…</span><span data-run-elapsed>${Math.floor((Date.now() - entry.trace.startedAt) / 1000)} 秒</span><span class="dsh-sep" aria-hidden="true"></span><span data-run-progress>${done}/${entry.trace.steps.length} 步</span><button type="button" class="dsh-link" data-work="chat-tab" data-id="轨迹">查看轨迹</button>`;
  }

  /** 输出完成态的底部信息。@param {object} entry AI 消息记录。@returns {string} 摘要 HTML。 */
  function finishedFoot(entry) {
    if (entry.status === 'stopped') {
      return `<span class="dsh-stopped">已停止生成</span><span>用时 ${durationOf(entry)} · 已保留部分结果</span>${attachmentSummary(entry)}<button type="button" class="dsh-link" data-work="chat-tab" data-id="轨迹">查看轨迹</button>`;
    }
    return `<span>用时 ${durationOf(entry)} · ${entry.trace.steps.length} 步</span>${attachmentSummary(entry)}<button type="button" class="dsh-link" data-work="chat-tab" data-id="轨迹">查看轨迹</button>`;
  }

  /** 输出消息底部信息，生成中显示进度。@param {object} entry AI 消息记录。@returns {string} 底部 HTML。 */
  function messageFoot(entry) {
    return entry.status === 'streaming' ? runningFoot(entry) : finishedFoot(entry);
  }

  /** 输出消息操作栏；生成中隐藏，完成后可用。@param {object} entry AI 消息记录。@returns {string} 操作栏 HTML。 */
  function actionsBar(entry) {
    const busy = entry.status === 'streaming';
    const feedback = entry.feedback || '';
    return `<div class="dsh-message-actions" data-run-actions ${busy ? 'hidden' : ''}><button type="button" class="dsh-action" data-work="message-action" data-kind="copy" data-id="${esc(entry.id)}" aria-label="复制回复" title="复制回复">${icon('copy')}</button><button type="button" class="dsh-action" data-work="message-action" data-kind="regenerate" data-id="${esc(entry.id)}" aria-label="重新生成" title="重新生成">${icon('refresh')}</button><span class="dsh-action-sep" aria-hidden="true"></span><button type="button" class="dsh-action" data-work="message-action" data-kind="like" data-id="${esc(entry.id)}" aria-pressed="${feedback === 'like'}" aria-label="有帮助" title="有帮助">${icon('thumb-up')}</button><button type="button" class="dsh-action" data-work="message-action" data-kind="dislike" data-id="${esc(entry.id)}" aria-pressed="${feedback === 'dislike'}" aria-label="需要改进" title="需要改进">${icon('thumb-down')}</button><button type="button" class="dsh-action" data-work="message-action" data-kind="speak" data-id="${esc(entry.id)}" aria-label="朗读回复" title="朗读">${icon('volume')}</button></div>`;
  }

  /** 输出 AI 回复消息主体，只保留对话内容与底部摘要。@param {object} entry AI 消息记录。@param {object} room 当前会话。@returns {string} 消息 HTML。 */
  function assistantMessage(entry, room) {
    const author = data.bots.find(item => item.name === entry.who) || bot(room?.leader);
    const busy = entry.status === 'streaming';
    const body = entry.text
      ? `${renderMarkdown(entry.text)}${busy ? '<span class="dsh-cursor" aria-hidden="true"></span>' : ''}`
      : '<p class="dsh-waiting">正在准备回复…</p>';
    return `<article class="dsh-message dsh-assistant ${busy ? 'is-streaming' : ''} ${entry.status === 'stopped' ? 'is-stopped' : ''}" data-run-id="${esc(entry.id)}" data-msg-id="${esc(entry.id)}"><div class="dsh-assistant-head">${botAvatar(author, 'tiny')}<span class="dsh-author">${esc(entry.who)}</span><span class="dsh-sim" title="本地演示，未调用模型或执行器">本地模拟</span><time class="dsh-time" title="${esc(entry.time)}">${esc(shortTime(entry.time))}</time></div><div class="md-body dsh-markdown" data-run-text>${body}</div><div class="dsh-message-foot" data-run-foot-wrap>${messageFoot(entry)}</div>${actionsBar(entry)}</article>`;
  }

  /** 输出用户消息气泡，附件详情收进上下文页签。@param {object} entry 消息记录。@returns {string} 消息 HTML。 */
  function userMessage(entry) {
    return `<article class="dsh-message dsh-user"><div class="dsh-user-bubble">${esc(entry.text)}</div><div class="dsh-user-meta"><span>${esc(shortTime(entry.time))}</span>${attachmentSummary(entry)}</div></article>`;
  }

  /** 输出普通 Bot 消息（任务、工具回执），不参与 AI 生成状态。@param {object} entry 消息记录。@param {object} room 当前会话。@returns {string} 消息 HTML。 */
  function plainMessage(entry, room) {
    const author = data.bots.find(item => item.name === entry.who) || bot(room?.leader);
    return `<article class="dsh-message dsh-assistant dsh-plain-message"><div class="dsh-assistant-head">${botAvatar(author, 'tiny')}<span class="dsh-author">${esc(entry.who)}</span><time class="dsh-time" title="${esc(entry.time)}">${esc(shortTime(entry.time))}</time></div><div class="dsh-plain-text">${esc(entry.text)}</div></article>`;
  }

  /**
   * 输出单条会话消息；AI 消息使用页签结构，普通消息保持简洁样式。
   * @param {object} entry 消息记录。
   * @param {object} room 当前会话。
   * @returns {string} 消息 HTML。
   */
  function messageHtml(entry, room) {
    if (entry.kind === 'ai-reply') return assistantMessage(entry, room);
    if (entry.who === '我') return userMessage(entry);
    return plainMessage(entry, room);
  }

  /** 查找消息所属会话。@param {object} entry 消息记录。@returns {object|undefined} 会话。 */
  function roomOf(entry) {
    return db.rooms.find(room => room.messages.includes(entry));
  }

  /** 收集会话内带执行轨迹的消息，新的在前。@param {object} room 会话。@returns {object[]} AI 回复列表。 */
  function traceRuns(room) {
    return (room?.messages || []).filter(entry => entry.kind === 'ai-reply' && entry.trace).reverse();
  }

  /** 输出页签角标数量。@param {object} room 会话。@returns {object} 轨迹与上下文数量。 */
  function badgeCounts(room) {
    if (!room) return {轨迹: 0, 上下文: 0};
    const attachments = (room.attachments || []).length
      + room.messages.reduce((total, message) => total + ((message.attachments || []).length), 0);
    return {轨迹: traceRuns(room).length, 上下文: attachments};
  }

  /** 输出执行轨迹页签的空状态。@param {object} room 会话。@returns {string} 空状态 HTML。 */
  function trajectoryEmpty(room) {
    return `<div class="dsh-empty"><span class="dsh-empty-icon">${icon('layers')}</span><h3>还没有执行轨迹</h3><p>在“对话”中发送一条消息，这里会按时间线显示理解、工具调用与生成过程。</p>${action('demo-ai', '演示一次 AI 回复', '', 'dsh-button')}</div>`;
  }

  /** 输出执行耗时概览条。@param {object} entry AI 消息记录。@returns {string} 概览 HTML。 */
  function trajectoryOverview(entry) {
    const steps = entry.trace.steps;
    const total = steps.reduce((sum, step) => sum + (step.wait || 0), 0) || 1;
    const segments = steps.map((step, index) => {
      const meta = stepMeta(step.type);
      return `<span class="traj-seg ${esc(step.status)} ${esc(step.type)}" style="flex:${Math.max(1, step.wait || 0)}" title="${esc(`${index + 1}. ${meta.label} · ${step.title} · ${step.duration || '进行中'}`)}"></span>`;
    }).join('');
    return `<div class="traj-overview" aria-label="步骤耗时概览">${segments}</div><div class="traj-axis"><span>0 秒</span><span>${seconds(total)}</span></div>`;
  }

  /** 输出单条轨迹记录行。@param {object} entry AI 消息记录。@param {object} step 步骤。@param {number} index 步骤序号。@returns {string} 轨迹行 HTML。 */
  function trajectoryRow(entry, step, index) {
    const meta = stepMeta(step.type);
    const start = entry.trace.steps.slice(0, index).reduce((sum, item) => sum + (item.wait || 0), 0) / 1000;
    const status = step.status || 'pending';
    return `<li class="traj-step ${esc(status)}"><details class="traj-step-details"><summary class="traj-row"><span class="traj-time">${start.toFixed(1)}s</span><span class="traj-icon ${esc(step.type)}">${icon(meta.icon)}</span><span class="traj-main"><strong>${esc(step.title)}</strong><small>${esc(step.summary || '')}</small></span><span class="traj-duration">${esc(step.duration || '')}</span><span class="traj-status">${stepStatusIcon(status)}</span></summary><div class="traj-record"><div class="traj-record-label">记录</div><p>${esc(step.detail || '')}</p><div class="traj-record-meta"><span>类型 · ${esc(meta.label)}</span><span>状态 · ${esc(stepStatusLabel(status))}</span><span>耗时 · ${esc(step.duration || '进行中')}</span></div></div></details></li>`;
  }

  /** 输出单次运行的详细轨迹。@param {object} entry AI 消息记录。@returns {string} 轨迹详情 HTML。 */
  function trajectoryDetail(entry) {
    const running = entry.status === 'streaming';
    const done = entry.trace.steps.filter(step => ['done', 'failed', 'interrupted'].includes(step.status)).length;
    const stopped = entry.status === 'stopped';
    return `<div class="traj-detail-head"><div class="traj-detail-title"><span class="dsh-author">${esc(entry.who)}</span><span class="traj-state ${esc(entry.status)}">${runStatusLabel(entry)}</span><span class="traj-meta">${esc(durationOf(entry))} · ${done}/${entry.trace.steps.length} 步</span></div><div class="traj-detail-actions">${running ? '<button type="button" class="dsh-link" data-work="skip-generation">跳过动画</button><button type="button" class="dsh-link" data-work="stop-generation">停止生成</button>' : ''}<button type="button" class="dsh-link" data-work="trace-toggle-all">展开全部</button></div></div>${trajectoryOverview(entry)}<ol class="traj-list">${entry.trace.steps.map((step, index) => trajectoryRow(entry, step, index)).join('')}</ol><div class="traj-foot">${icon('arrow')}<span>${running ? `深度求索中… ${done}/${entry.trace.steps.length} 步` : stopped ? `已停止生成 · 用时 ${durationOf(entry)} · 已保留部分结果` : `共 ${entry.trace.steps.length} 步 · 用时 ${durationOf(entry)}`}</span></div>`;
  }

  /** 输出一次运行的切换按钮。@param {object} entry AI 消息记录。@param {object} selected 当前选中的运行。@returns {string} 运行切换按钮 HTML。 */
  function trajectoryPill(entry, selected) {
    return `<button type="button" class="traj-run ${entry === selected ? 'is-active' : ''}" data-work="trace-run" data-id="${esc(entry.id)}" title="${esc(`${runStatusLabel(entry)} · ${entry.trace.steps.length} 步`)}"><span class="traj-run-dot ${esc(entry.status)}" aria-hidden="true"></span><span>${esc(shortTime(entry.time))}</span><span class="traj-run-duration">${entry.status === 'streaming' ? '进行中' : durationOf(entry)}</span></button>`;
  }

  /**
   * 输出执行轨迹页签：运行切换、耗时概览与记录表。
   * @param {object} room 会话。
   * @returns {string} 轨迹页 HTML；没有运行时显示空状态。
   */
  function trajectoryPanel(room) {
    const runs = traceRuns(room);
    if (!runs.length) return trajectoryEmpty(room);
    const selected = runs.find(entry => entry.id === ui.traceRun) || runs[0];
    return `<div class="traj-wrap" data-trajectory-panel><div class="traj-toolbar"><div class="traj-toolbar-title"><strong>执行轨迹</strong><span class="traj-count">${runs.length} 次运行</span></div><div class="traj-runs" role="tablist" aria-label="运行记录">${runs.map(entry => trajectoryPill(entry, selected)).join('')}</div></div><section class="traj-detail" data-trajectory-detail data-run-id="${esc(selected.id)}">${trajectoryDetail(selected)}</section></div>`;
  }

  /** 从消息中收集 @ 引用并统计次数。@param {object} room 会话。@returns {object[]} 去重后的引用与次数。 */
  function collectReferences(room) {
    const counts = new Map();
    (room?.messages || []).forEach(message => {
      const tokens = String(message.text || '').match(/@[^\s，。！？、；：()（）]+/g) || [];
      tokens.forEach(token => counts.set(token, (counts.get(token) || 0) + 1));
    });
    return [...counts].map(([token, count]) => ({token, count}));
  }

  /** 输出上下文页签中的附件行。@param {object} item 附件记录。@param {boolean} pending 是否仍待发送。@returns {string} 附件行 HTML。 */
  function contextRow(item, pending, readonly = false) {
    const annotation = item.type === 'annotation';
    const actionsHtml = `<div class="ctx-row-actions">${annotation ? `<button type="button" class="dsh-link" data-work="annotation-view" data-id="${esc(item.id)}">查看坐标</button>` : ''}${pending && !readonly ? `<button type="button" class="dsh-link" data-work="attachment-remove" data-id="${esc(item.id)}">移除</button>` : ''}</div>`;
    const note = annotation
      ? `<p class="ctx-note">${esc(item.note || '未填写批注说明')}</p><small>${esc(item.target?.label || '页面区域')} · ${esc(`${item.rect?.width || 0}×${item.rect?.height || 0}`)}</small>`
      : `<small>${esc(item.url || '本地上下文')}${pending ? ' · 待发送' : ' · 已随消息保存'}</small>`;
    return `<li class="ctx-row" data-kind="${esc(item.type)}"><span class="ctx-icon">${icon(attachmentIcon(item.type))}</span><div class="ctx-main"><div class="ctx-title"><strong>${esc(item.name)}</strong><span class="ctx-kind">${esc(attachmentLabel(item.type))}</span></div>${note}</div>${actionsHtml}</li>`;
  }

  /**
   * 输出上下文页签：当前待发送附件、历史附件与消息引用。
   * @param {object} room 会话。
   * @returns {string} 上下文页 HTML。
   */
  function contextPanel(room, readonly = false) {
    const pending = (room?.attachments || []).map(item => ({item, pending: true}));
    const saved = (room?.messages || []).flatMap(message => (message.attachments || []).map(item => ({item, pending: false})));
    const items = [...pending, ...saved];
    const references = collectReferences(room);
    const rows = items.map(({item, pending: isPending}) => contextRow(item, isPending, readonly)).join('');
    const empty = `<div class="dsh-empty"><span class="dsh-empty-icon">${icon('paperclip')}</span><h3>还没有上下文</h3><p>添加文件、链接、图片，或框选页面区域并写下批注，发送后统一保留在这里。</p>${!readonly && mutator ? mutator('attachment-add', '添加上下文', '', 'dsh-button') : ''}</div>`;
    const referencesHtml = references.length
      ? `<section class="ctx-section"><div class="ctx-section-head"><h3>消息引用</h3><span class="ctx-count">${references.length}</span></div><div class="ctx-refs">${references.map(({token, count}) => `<span class="ctx-ref">${icon('link')}<span>${esc(token)}</span><small>×${count}</small></span>`).join('')}</div></section>`
      : '';
    const actionsHtml = readonly ? '' : `<div class="dsh-panel-actions">${mutator ? mutator('attachment-add', '添加上下文', '', 'dsh-button') : ''}${mutator ? mutator('attachment-annotate', '框选批注', '', 'dsh-button') : ''}</div>`;
    return `<div class="ctx-wrap" data-context-panel><div class="dsh-panel-head"><div><strong>上下文</strong><span class="dsh-panel-meta">${items.length} 项附件${references.length ? ` · ${references.length} 项引用` : ''}</span></div>${actionsHtml}</div>${items.length ? `<ul class="ctx-list">${rows}</ul>` : empty}${referencesHtml}<p class="dsh-note">附件与页面批注只保存在本地原型，不会上传文件、访问链接或调用模型。</p></div>`;
  }

  /** 输出对话页签中运行中的状态条。@param {object} room 会话。@returns {string} 状态条 HTML；空闲时为空字符串。 */
  function runningBar(room) {
    if (!active || active.roomId !== room?.id) return '';
    return `<div class="dsh-running" data-generation-bar role="status"><span class="dsh-pulse" aria-hidden="true"></span><span class="dsh-running-label">深度求索中…</span><span class="dsh-running-time" data-gen-elapsed>0 秒</span><span class="dsh-sep" aria-hidden="true"></span><span class="dsh-running-steps" data-gen-steps>0/${active.entry.trace.steps.length} 步</span><span class="spacer"></span><button type="button" class="dsh-link" data-work="skip-generation">跳过动画</button><button type="button" class="dsh-link" data-work="chat-tab" data-id="轨迹">查看轨迹</button></div>`;
  }

  /** 判断指定会话是否正在生成。@param {string} roomId 会话标识。@returns {boolean} 是否处于生成状态。 */
  function isGenerating(roomId) {
    return !!active && (!roomId || active.roomId === roomId);
  }

  /** 把耗时写入步骤。@param {object} step 步骤。@param {number} ms 耗时。@returns {void} */
  function settleStep(step, ms) {
    if (!step) return;
    step.duration = seconds(ms);
  }

  /** 刷新对话流中的正文。@param {object} entry AI 消息记录。@returns {void} */
  function paintText(entry) {
    const root = document.querySelector(`[data-run-id="${entry.id}"]`);
    const body = root?.querySelector('[data-run-text]');
    if (!body) return;
    const busy = entry.status === 'streaming';
    body.innerHTML = entry.text
      ? `${renderMarkdown(entry.text)}${busy ? '<span class="dsh-cursor" aria-hidden="true"></span>' : ''}`
      : '<p class="dsh-waiting">正在准备回复…</p>';
  }

  /** 刷新对话流中的消息底部信息。@param {object} entry AI 消息记录。@returns {void} */
  function paintFoot(entry) {
    const root = document.querySelector(`[data-run-id="${entry.id}"]`);
    const foot = root?.querySelector('[data-run-foot-wrap]');
    if (foot) foot.innerHTML = messageFoot(entry);
  }

  /** 刷新执行轨迹页签；用户切到其他页签时不重建。@param {object} entry AI 消息记录。@returns {void} */
  function paintTrajectory(entry) {
    const panel = document.querySelector('[data-trajectory-panel]');
    if (!panel) return;
    const room = roomOf(entry);
    if (!room) return;
    const wrapper = document.createElement('div');
    wrapper.innerHTML = trajectoryPanel(room);
    const next = wrapper.firstElementChild;
    if (next) panel.replaceWith(next);
  }

  /** 刷新全局生成状态条与轨迹进度。@param {object} entry AI 消息记录。@returns {void} */
  function paintBars(entry) {
    const elapsed = Math.max(0, (Date.now() - entry.trace.startedAt) / 1000);
    const done = entry.trace.steps.filter(step => ['done', 'failed', 'interrupted'].includes(step.status)).length;
    document.querySelectorAll('[data-gen-elapsed]').forEach(node => { node.textContent = `${Math.floor(elapsed)} 秒`; });
    document.querySelectorAll('[data-gen-steps]').forEach(node => { node.textContent = `${done}/${entry.trace.steps.length} 步`; });
    document.querySelectorAll(`[data-run-id="${entry.id}"] [data-run-elapsed]`).forEach(node => { node.textContent = `${Math.floor(elapsed)} 秒`; });
    const root = document.querySelector(`[data-run-id="${entry.id}"]`);
    const progress = root?.querySelector('[data-run-progress]');
    if (progress) progress.textContent = `${done}/${entry.trace.steps.length} 步`;
  }

  /** 让对话流跟随生成内容滚动；用户向上查看历史时不强制拉回底部。@param {object} entry AI 消息记录。@returns {void} */
  function keepScroll(entry) {
    const feed = document.querySelector('.dsh-chat-scroll');
    if (!feed) return;
    const root = document.querySelector(`[data-run-id="${entry.id}"]`);
    if (!root) return;
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 160;
    if (nearBottom) feed.scrollTop = feed.scrollHeight;
  }

  /** 在停止或完成后把消息切换到终态并呈现操作栏。@param {object} entry AI 消息记录。@returns {void} */
  function paintFinished(entry) {
    const root = document.querySelector(`[data-run-id="${entry.id}"]`);
    if (root) {
      root.classList.remove('is-streaming');
      root.classList.toggle('is-stopped', entry.status === 'stopped');
      paintText(entry);
      paintFoot(entry);
      const actions = root.querySelector('[data-run-actions]');
      if (actions) actions.removeAttribute('hidden');
    }
    document.querySelectorAll('[data-generation-bar]').forEach(node => node.remove());
    paintTrajectory(entry);
  }

  /** 重建视图并在完成后恢复阅读位置。@returns {void} */
  function scheduleRerender() {
    setTimeout(() => {
      const feed = document.querySelector('.dsh-chat-scroll');
      const stickBottom = !feed || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 200;
      const position = feed ? feed.scrollTop : 0;
      render();
      const next = document.querySelector('.dsh-chat-scroll');
      if (next) next.scrollTop = stickBottom ? next.scrollHeight : position;
    }, FINISH_DELAY);
  }

  /** 结束当前演示并写入最终状态。@param {boolean} stopped 是否为用户主动停止。@returns {void} */
  function finish(stopped) {
    if (!active) return;
    const run = active;
    const entry = run.entry;
    run.timers.forEach(timer => clearTimeout(timer));
    run.timers.clear();
    if (run.ticker) clearInterval(run.ticker);
    const running = entry.trace.steps.find(step => step.status === 'running');
    if (stopped) {
      if (running) {
        running.status = 'interrupted';
        settleStep(running, Date.now() - entry.trace.startedAt);
      }
      entry.status = 'stopped';
      entry.trace.status = 'stopped';
      entry.trace.durationMs = Date.now() - entry.trace.startedAt;
      toast('已停止生成，已保留部分结果');
    } else {
      entry.trace.steps.forEach(step => {
        if (step.status === 'running') step.status = 'done';
        if (!step.duration && step.status === 'done') settleStep(step, step.wait || 0);
      });
      entry.status = 'done';
      entry.trace.status = 'done';
      entry.trace.durationMs = entry.trace.startedAt ? Date.now() - entry.trace.startedAt : 0;
      entry.time = stamp();
    }
    active = null;
    persist();
    paintFinished(entry);
    scheduleRerender();
  }

  /** 开始流式输出正文。@returns {void} */
  function beginStream() {
    if (!active) return;
    const run = active;
    const last = run.entry.trace.steps.at(-1);
    last.status = 'running';
    paintTrajectory(run.entry);
    paintFoot(run.entry);
    const chunks = sliceText(run.reply, STREAM_CHARS);
    let index = 0;
    const tick = () => {
      if (!active || active !== run) return;
      run.entry.text += chunks[index] || '';
      index += 1;
      if (index % 2 === 0 || index >= chunks.length) {
        paintText(run.entry);
        paintBars(run.entry);
        keepScroll(run.entry);
      }
      if (index >= chunks.length) {
        settleStep(last, Date.now() - run.streamStartedAt);
        finish(false);
        return;
      }
      const timer = setTimeout(tick, STREAM_INTERVAL);
      run.timers.add(timer);
    };
    run.streamStartedAt = Date.now();
    tick();
  }

  /** 顺序执行轨迹步骤，最后一步在流式结尾结算。@param {number} index 步骤序号。@returns {void} */
  function runStep(index) {
    if (!active) return;
    const run = active;
    const step = run.entry.trace.steps[index];
    if (!step) { beginStream(); return; }
    step.status = 'running';
    paintTrajectory(run.entry);
    paintFoot(run.entry);
    paintBars(run.entry);
    const timer = setTimeout(() => {
      if (!active || active !== run) return;
      step.status = step.willFail ? 'failed' : 'done';
      settleStep(step, step.wait);
      paintTrajectory(run.entry);
      paintFoot(run.entry);
      paintBars(run.entry);
      if (index + 1 < run.entry.trace.steps.length) runStep(index + 1);
      else beginStream();
    }, step.wait);
    run.timers.add(timer);
  }

  /** 启动每秒刷新的耗时提示。@param {object} run 当前运行。@returns {void} */
  function startTicker(run) {
    run.ticker = setInterval(() => {
      if (!active || active !== run) return;
      paintBars(run.entry);
    }, 500);
  }

  /**
   * 为指定会话启动一条本地演示回复。
   * @param {object} room 会话记录。
   * @param {string} userText 触发本次回复的用户文本。
   * @returns {object|null} 新建的 AI 消息记录；正在生成时返回 null。
   */
  function startReply(room, userText) {
    if (!room || isGenerating()) return null;
    const botName = bot(room.leader)?.name || 'Bot';
    const attachments = Array.isArray(room.attachments) ? room.attachments.slice() : [];
    const steps = buildSteps({userText, attachments, botName});
    steps.forEach(step => { step.status = 'pending'; });
    const entry = {
      id: nextId('msg'),
      who: botName,
      text: '',
      time: stamp(),
      kind: 'ai-reply',
      status: 'streaming',
      attachments: [],
      feedback: '',
      trace: {steps, status: 'running', startedAt: Date.now(), durationMs: 0},
    };
    const controller = new AbortController();
    const run = {roomId: room.id, entry, controller, timers: new Set(), ticker: null, reply: composeReply({botName, attachments, userText}), streamStartedAt: 0};
    room.messages.push(entry);
    room.draft = '';
    room.attachments = [];
    ui.chatTab = '对话';
    ui.traceRun = '';
    active = run;
    persist();
    render();
    startTicker(run);
    runStep(0);
    return entry;
  }

  /**
   * 从页签空状态或菜单触发演示；必要时补一条示例用户消息。
   * @param {object} room 会话记录。
   * @returns {void}
   */
  function startDemo(room) {
    if (!room || isGenerating()) return;
    ui.chatTab = '对话';
    const last = room.messages.at(-1);
    if (!last || last.who !== '我') {
      room.messages.push({who: '我', text: '请结合当前上下文，给出登录权限刷新的排查建议。', time: stamp(), attachments: []});
    }
    const lastUser = [...room.messages].reverse().find(item => item.who === '我');
    startReply(room, lastUser?.text || '核对登录后权限刷新流程');
  }

  /** 用户主动停止生成。@returns {void} */
  function stopGeneration() {
    if (!active) return;
    finish(true);
  }

  /** 跳过动画，直接呈现完整结果。@returns {void} */
  function skipGeneration() {
    if (!active) return;
    const run = active;
    run.timers.forEach(timer => clearTimeout(timer));
    run.timers.clear();
    if (run.ticker) clearInterval(run.ticker);
    run.entry.text = run.reply;
    run.entry.trace.steps.forEach(step => {
      step.status = step.willFail ? 'failed' : 'done';
      if (!step.duration) settleStep(step, step.wait);
    });
    run.entry.trace.durationMs = run.entry.trace.steps.reduce((total, step) => total + (step.wait || 0), 0);
    run.entry.status = 'done';
    run.entry.trace.status = 'done';
    run.entry.time = stamp();
    active = null;
    persist();
    paintFinished(run.entry);
    scheduleRerender();
    toast('已跳过动画，展示完成态');
  }

  /** 切换轨迹页签中全部步骤的展开状态。@returns {void} */
  function toggleTraceAll() {
    const details = [...document.querySelectorAll('.traj-step-details')];
    if (!details.length) return;
    const nextOpen = !details[0].open;
    details.forEach(detail => { detail.open = nextOpen; });
    const button = document.querySelector('[data-work="trace-toggle-all"]');
    if (button) button.textContent = nextOpen ? '折叠全部' : '展开全部';
  }

  /** 复制回复正文到剪贴板。@param {object} entry AI 消息记录。@returns {Promise<boolean>} 是否复制成功。 */
  async function copyReply(entry) {
    try {
      await navigator.clipboard.writeText(entry.text || '');
      toast('已复制回复');
      return true;
    } catch (error) {
      toast('浏览器拒绝剪贴板权限，请手动选择文本复制');
      return false;
    }
  }

  /** 切换点赞或点踩状态。@param {object} entry AI 消息记录。@param {string} kind like 或 dislike。@returns {void} */
  function toggleFeedback(entry, kind) {
    entry.feedback = entry.feedback === kind ? '' : kind;
    persist();
    const root = document.querySelector(`[data-run-id="${entry.id}"]`);
    root?.querySelectorAll('[data-kind]').forEach(button => {
      if (['like', 'dislike'].includes(button.dataset.kind)) button.setAttribute('aria-pressed', String(entry.feedback === button.dataset.kind));
    });
    toast(entry.feedback === 'like' ? '已记录为有帮助' : entry.feedback === 'dislike' ? '已记录为待改进' : '已取消反馈');
  }

  /** 朗读回复正文；浏览器不支持时明确提示。@param {object} entry AI 消息记录。@returns {void} */
  function speakReply(entry) {
    if (!('speechSynthesis' in window)) { toast('当前浏览器不支持语音朗读'); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(entry.text);
    utterance.lang = 'zh-CN';
    window.speechSynthesis.speak(utterance);
    toast('正在朗读回复');
  }

  /** 重新生成指定回复，保留原用户消息并替换旧的 AI 结果。@param {object} room 会话记录。@param {object} entry AI 消息记录。@returns {void} */
  function regenerate(room, entry) {
    if (isGenerating()) { toast('请先停止当前生成'); return; }
    const index = room.messages.indexOf(entry);
    if (index < 0) return;
    const userEntry = [...room.messages.slice(0, index)].reverse().find(item => item.who === '我');
    room.messages.splice(index, 1);
    room.attachments = userEntry?.attachments ? userEntry.attachments.slice() : [];
    render();
    startReply(room, userEntry?.text || '请重新生成建议');
  }

  /**
   * 处理消息操作栏动作。
   * @param {object} room 会话记录。
   * @param {object} entry AI 消息记录。
   * @param {string} kind 动作类型：copy、regenerate、like、dislike、speak。
   * @returns {void}
   */
  function messageAction(room, entry, kind) {
    if (entry.status === 'streaming') return;
    if (kind === 'copy') {
      const button = document.querySelector(`[data-run-id="${entry.id}"] [data-kind="copy"]`);
      void copyReply(entry).then(copied => {
        if (!copied || !button) return;
        button.innerHTML = icon('check');
        setTimeout(() => { button.innerHTML = icon('copy'); }, 1600);
      });
      return;
    }
    if (kind === 'regenerate') { regenerate(room, entry); return; }
    if (kind === 'like' || kind === 'dislike') { toggleFeedback(entry, kind); return; }
    if (kind === 'speak') { speakReply(entry); return; }
  }

  return {
    messageHtml,
    composerAttachments,
    runningBar,
    isGenerating,
    trajectoryPanel,
    contextPanel,
    badgeCounts,
    startReply,
    startDemo,
    stopGeneration,
    skipGeneration,
    toggleTraceAll,
    messageAction,
    regenerate,
  };
}
