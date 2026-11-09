/**
 * 页面元素框选批注工具。
 *
 * 用于「框选页面元素并批注后作为上下文附件发送给 AI」的交互：启动后覆盖整个视口，
 * 悬停高亮下层元素，拖动框选区域，松开后在选框旁弹出批注气泡。工具只负责采集批注数据，
 * 不直接改动业务页面，所有 DOM 与事件都会在 stop() 时清理。
 */

/** 小于该尺寸的拖动按点击处理，避免误触产生空框选。 */
const MIN_SELECTION_SIZE = 8;
/** 气泡与视口边缘的最小间距，保证窄屏可用。 */
const POPOVER_MARGIN = 12;
/** 目标标签展示上限，避免长 class 组合撑破提示条。 */
const TARGET_LABEL_MAX = 40;
/** 目标文字摘要上限。 */
const TARGET_TEXT_MAX = 80;
/** 气泡优先放在选框下方的间距。 */
const POPOVER_GAP = 10;

/**
 * 截取字符串到上限长度，超出部分以省略号结束。
 * @param {string} value 原始文字。
 * @param {number} limit 最大字符数。
 * @returns {string} 不超长的展示文字。
 */
function truncate(value, limit) {
  return value.length > limit ? `${value.slice(0, Math.max(0, limit - 1))}…` : value;
}

/**
 * 组合元素标签，格式为 tag#id.class，最多保留 TARGET_LABEL_MAX 个字符。
 * @param {string} tag 小写标签名。
 * @param {string} id 元素 id，可为空。
 * @param {string[]} classes 元素 class 列表。
 * @returns {string} 供 UI 展示的标签；超长时截断。
 */
function buildTargetLabel(tag, id, classes) {
  let label = id ? `${tag}#${id}` : tag;
  for (const className of classes) {
    const next = `${label}.${className}`;
    if (next.length > TARGET_LABEL_MAX) break;
    label = next;
  }
  return truncate(label, TARGET_LABEL_MAX);
}

/**
 * 读取元素的展示信息；元素已脱离文档时退化为 body，避免抛出异常。
 * @param {Element|null} element 框选起点对应的下层元素。
 * @returns {{tag:string,id:string,classes:string[],label:string,text:string}} 批注目标快照。
 */
function readTarget(element) {
  const safeElement = element && element.isConnected ? element : document.body;
  const tag = safeElement.tagName ? safeElement.tagName.toLowerCase() : 'body';
  const id = typeof safeElement.id === 'string' ? safeElement.id : '';
  const classes = safeElement.classList ? Array.from(safeElement.classList) : [];
  const rawText = safeElement.innerText || safeElement.textContent || '';
  return {
    tag,
    id,
    classes,
    label: buildTargetLabel(tag, id, classes),
    text: truncate(rawText.replace(/\s+/g, ' ').trim(), TARGET_TEXT_MAX),
  };
}

/**
 * 将视口坐标下的矩形四舍五入为整数，宽高保持非负。
 * @param {{left:number,top:number,right:number,bottom:number}} rect 未取整的矩形。
 * @returns {{x:number,y:number,width:number,height:number}} 取整后的视口矩形。
 */
function roundViewportRect(rect) {
  const x = Math.round(rect.left);
  const y = Math.round(rect.top);
  return {
    x,
    y,
    width: Math.max(0, Math.round(rect.right) - x),
    height: Math.max(0, Math.round(rect.bottom) - y),
  };
}

/**
 * 创建框选批注工具实例。
 *
 * @param {object} [options] 配置项。
 * @param {(annotation:object)=>void} [options.onComplete] 发送批注后的回调，参数为批注对象：
 *   `{type:'annotation', rect, pageRect, viewport, target, note}`，各矩形坐标均为 CSS px 整数。
 * @param {()=>void} [options.onCancel] 用户取消时的回调，单次取消只触发一次。
 * @param {(message:string)=>void} [options.toast] 可选的轻提示函数，当前保留给宿主扩展。
 * @returns {{start:Function,stop:Function,isActive:Function}} 工具控制接口。
 *
 * 边界说明：start() 与 stop() 均幂等；同一实例同时只会存在一套遮罩。
 * 取消路径包括 Escape、气泡取消按钮、顶部关闭按钮，以及点击遮罩空白区域。
 * 副作用：start() 时暂存并覆盖 body 的 cursor/user-select/overflow，stop() 时恢复；
 * 发送与取消都会移除遮罩、解绑事件并尝试把焦点还给启动前的元素。
 */
export function createAnnotationTool(options = {}) {
  const { onComplete, onCancel } = options;

  /** 工具是否处于激活状态。 */
  let active = false;
  /** 是否正在拖拽画框。 */
  let dragging = false;
  /** 拖拽起点（视口坐标）。 */
  let dragStart = null;
  /** 当前选框（视口坐标，left/top/right/bottom）。 */
  let selectionRect = null;
  /** 拖拽起点对应的下层元素，发送时作为批注目标。 */
  let targetElement = null;
  /** 当前悬停的下层元素。 */
  let hoverElement = null;
  /** 本次按下前气泡是否已经打开，用于把气泡外点击识别为取消。 */
  let popoverWasOpen = false;
  /** 启动前的焦点元素，用于关闭后恢复。 */
  let previousFocus = null;
  /** body 原始内联样式，stop() 时恢复。 */
  let savedBodyStyles = [];

  /** 遮罩根节点。 */
  let overlay = null;
  /** 悬停虚线框。 */
  let hoverBox = null;
  /** 悬停标签。 */
  let hoverLabel = null;
  /** 选框。 */
  let selectionBox = null;
  /** 选框尺寸标签。 */
  let sizeLabel = null;
  /** 批注气泡。 */
  let popover = null;
  /** 气泡内的目标标签。 */
  let popoverTarget = null;
  /** 批注输入框。 */
  let noteInput = null;
  /** 发送按钮。 */
  let sendButton = null;

  /** window/document 上的监听器记录，stop() 时成对解绑。 */
  const listeners = [];

  /**
   * 注册监听并在清理阶段统一解绑。
   * @param {EventTarget} target 监听目标。
   * @param {string} type 事件名。
   * @param {EventListener} handler 事件处理函数。
   * @param {boolean|AddEventListenerOptions} [opts] 监听选项。
   * @returns {void}
   */
  function listen(target, type, handler, opts) {
    target.addEventListener(type, handler, opts);
    listeners.push(() => target.removeEventListener(type, handler, opts));
  }

  /**
   * 保存并覆盖 body 的内联样式，避免拖拽时选中页面文字或滚动底层页面。
   * @returns {void}
   */
  function lockBody() {
    const properties = ['cursor', 'user-select', 'overflow'];
    savedBodyStyles = properties.map((property) => [
      property,
      document.body.style.getPropertyValue(property),
      document.body.style.getPropertyPriority(property),
    ]);
    document.body.style.setProperty('cursor', 'crosshair');
    document.body.style.setProperty('user-select', 'none');
    document.body.style.setProperty('overflow', 'hidden');
  }

  /**
   * 恢复 lockBody() 覆盖的 body 内联样式；未保存过时不处理。
   * @returns {void}
   */
  function unlockBody() {
    for (const [property, value, priority] of savedBodyStyles) {
      if (value) document.body.style.setProperty(property, value, priority);
      else document.body.style.removeProperty(property);
    }
    savedBodyStyles = [];
  }

  /**
   * 在视口坐标处查找遮罩下方的真实元素，跳过遮罩自身及其子节点。
   * @param {number} x 视口横坐标。
   * @param {number} y 视口纵坐标。
   * @returns {Element|null} 最上层的下层元素；没有时返回 null。
   */
  function elementUnderPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    return (
      stack.find((element) => {
        if (element === overlay || (overlay && overlay.contains(element))) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) || null
    );
  }

  /**
   * 判断元素是否可作为悬停高亮目标：body/html 视为空白区域，不展示高亮。
   * @param {Element|null} element 下层元素。
   * @returns {boolean} 是否为有意义的页面元素。
   */
  function isMeaningfulElement(element) {
    return Boolean(element && element !== document.body && element !== document.documentElement);
  }

  /**
   * 隐藏悬停高亮并清空记录。
   * @returns {void}
   */
  function hideHover() {
    hoverElement = null;
    if (hoverBox) hoverBox.hidden = true;
  }

  /**
   * 按元素视口矩形定位悬停虚线框与标签；靠近顶部时把标签放到框内。
   * @param {Element} element 悬停元素。
   * @returns {void}
   */
  function showHover(element) {
    if (!hoverBox || !isMeaningfulElement(element)) {
      hideHover();
      return;
    }
    hoverElement = element;
    const rect = element.getBoundingClientRect();
    const target = readTarget(element);
    hoverBox.hidden = false;
    hoverBox.style.left = `${rect.left - 1}px`;
    hoverBox.style.top = `${rect.top - 1}px`;
    hoverBox.style.width = `${Math.max(0, rect.width + 2)}px`;
    hoverBox.style.height = `${Math.max(0, rect.height + 2)}px`;
    hoverBox.classList.toggle('is-below', rect.top < 28);
    if (hoverLabel) {
      hoverLabel.textContent = `${target.label} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    }
  }

  /**
   * 按拖拽起点与当前点更新选框几何、尺寸文字与四角手柄。
   * @param {number} x 当前视口横坐标。
   * @param {number} y 当前视口纵坐标。
   * @returns {void}
   */
  function updateSelection(x, y) {
    if (!dragStart || !selectionBox) return;
    const left = Math.max(0, Math.min(dragStart.x, x));
    const top = Math.max(0, Math.min(dragStart.y, y));
    const right = Math.min(window.innerWidth, Math.max(dragStart.x, x));
    const bottom = Math.min(window.innerHeight, Math.max(dragStart.y, y));
    selectionRect = { left, top, right, bottom };
    selectionBox.hidden = false;
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${Math.max(0, right - left)}px`;
    selectionBox.style.height = `${Math.max(0, bottom - top)}px`;
    if (sizeLabel) {
      sizeLabel.textContent = `${Math.round(right - left)} × ${Math.round(bottom - top)}`;
      selectionBox.classList.toggle('is-above', bottom > window.innerHeight - 36);
    }
  }

  /**
   * 隐藏选框并清空选框状态，保留工具本身继续工作。
   * @returns {void}
   */
  function clearSelection() {
    selectionRect = null;
    targetElement = null;
    if (selectionBox) selectionBox.hidden = true;
  }

  /**
   * 关闭批注气泡并清空未发送的批注文字。
   * @returns {void}
   */
  function closePopover() {
    if (!popover) return;
    popover.hidden = true;
    if (noteInput) noteInput.value = '';
    if (sendButton) sendButton.disabled = true;
  }

  /**
   * 计算并写入气泡位置：优先选框下方，空间不足时放到上方，并 clamp 在视口内。
   * @param {{left:number,top:number,right:number,bottom:number}} rect 选框视口矩形。
   * @returns {void}
   */
  function positionPopover(rect) {
    if (!popover) return;
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const maxLeft = Math.max(POPOVER_MARGIN, window.innerWidth - width - POPOVER_MARGIN);
    const left = Math.min(Math.max(POPOVER_MARGIN, rect.left), maxLeft);
    const below = rect.bottom + POPOVER_GAP;
    let top = below;
    if (below + height > window.innerHeight - POPOVER_MARGIN) {
      const above = rect.top - height - POPOVER_GAP;
      top = above >= POPOVER_MARGIN ? above : window.innerHeight - height - POPOVER_MARGIN;
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${Math.max(POPOVER_MARGIN, Math.min(top, window.innerHeight - height - POPOVER_MARGIN))}px`;
  }

  /**
   * 在选框旁打开批注气泡，聚焦输入框并刷新发送按钮状态。
   * @param {{left:number,top:number,right:number,bottom:number}} rect 选框视口矩形。
   * @returns {void}
   */
  function openPopover(rect) {
    if (!popover || !noteInput) return;
    popover.hidden = false;
    if (popoverTarget) popoverTarget.textContent = readTarget(targetElement).label;
    positionPopover(rect);
    noteInput.value = '';
    if (sendButton) sendButton.disabled = true;
    noteInput.focus({ preventScroll: true });
  }

  /**
   * 构造并发送批注对象：先打印 JSON，再回调宿主，最后关闭遮罩。
   * @returns {void}
   */
  function sendAnnotation() {
    if (!active || !noteInput || !selectionRect) return;
    const note = noteInput.value.trim();
    if (!note) return;
    const rect = roundViewportRect(selectionRect);
    const annotation = {
      type: 'annotation',
      rect,
      pageRect: {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      target: readTarget(targetElement || hoverElement),
      note,
    };
    console.log(JSON.stringify(annotation));
    try {
      onComplete?.(annotation);
    } finally {
      stop();
    }
  }

  /**
   * 取消批注：只触发一次 onCancel，并关闭遮罩。
   * @returns {void}
   */
  function cancel() {
    if (!active) return;
    try {
      onCancel?.();
    } finally {
      stop();
    }
  }

  /**
   * 处理遮罩上的按下：开始拖拽；气泡外的按下会先关闭气泡再重新框选。
   * @param {PointerEvent} event 指针事件。
   * @returns {void}
   */
  function onPointerDown(event) {
    if (!active || dragging) return;
    if (event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.annotation-close') || target.closest('.annotation-popover')) return;
    popoverWasOpen = Boolean(popover && !popover.hidden);
    if (popoverWasOpen) closePopover();
    event.preventDefault();
    dragging = true;
    dragStart = { x: event.clientX, y: event.clientY };
    if (popoverWasOpen) clearSelection();
    targetElement = elementUnderPoint(event.clientX, event.clientY);
    selectionRect = {
      left: dragStart.x,
      top: dragStart.y,
      right: dragStart.x,
      bottom: dragStart.y,
    };
    hideHover();
    updateSelection(event.clientX, event.clientY);
  }

  /**
   * 处理指针移动：拖拽中更新选框，否则更新悬停高亮；气泡打开时暂停悬停。
   * @param {PointerEvent} event 指针事件。
   * @returns {void}
   */
  function onPointerMove(event) {
    if (!active) return;
    if (dragging) {
      event.preventDefault();
      updateSelection(event.clientX, event.clientY);
      return;
    }
    if (popover && !popover.hidden) return;
    const element = elementUnderPoint(event.clientX, event.clientY);
    if (element && isMeaningfulElement(element)) {
      if (element !== hoverElement) showHover(element);
    } else {
      hideHover();
    }
  }

  /**
   * 处理指针松开：过小的拖动视为点击；点击空白取消，点击元素仅清除选框。
   * @param {PointerEvent} event 指针事件。
   * @returns {void}
   */
  function onPointerUp(event) {
    if (!active || !dragging) return;
    dragging = false;
    updateSelection(event.clientX, event.clientY);
    const width = selectionRect ? selectionRect.right - selectionRect.left : 0;
    const height = selectionRect ? selectionRect.bottom - selectionRect.top : 0;
    if (width < MIN_SELECTION_SIZE || height < MIN_SELECTION_SIZE) {
      clearSelection();
      const clickedOutsidePopover = popoverWasOpen;
      popoverWasOpen = false;
      if (clickedOutsidePopover) {
        cancel();
        return;
      }
      const element = elementUnderPoint(event.clientX, event.clientY);
      if (!isMeaningfulElement(element)) {
        cancel();
        return;
      }
      showHover(element);
      return;
    }
    popoverWasOpen = false;
    openPopover(selectionRect);
  }

  /**
   * 处理键盘：Escape 取消；气泡打开时 Cmd/Ctrl+Enter 发送。
   * @param {KeyboardEvent} event 键盘事件。
   * @returns {void}
   */
  function onKeyDown(event) {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    const isSendShortcut = (event.metaKey || event.ctrlKey) && event.key === 'Enter';
    if (isSendShortcut && popover && !popover.hidden) {
      event.preventDefault();
      event.stopPropagation();
      sendAnnotation();
    }
  }

  /**
   * 输入变化时同步发送按钮可用状态。
   * @returns {void}
   */
  function onNoteInput() {
    if (sendButton && noteInput) sendButton.disabled = noteInput.value.trim().length === 0;
  }

  /**
   * 点击发送按钮。
   * @returns {void}
   */
  function onSendClick() {
    sendAnnotation();
  }

  /**
   * 点击取消按钮。
   * @returns {void}
   */
  function onCancelClick() {
    cancel();
  }

  /**
   * 点击顶部关闭按钮。
   * @returns {void}
   */
  function onCloseClick() {
    cancel();
  }

  /**
   * 视口尺寸变化时重新定位气泡并隐藏可能过期的悬停框。
   * @returns {void}
   */
  function onResize() {
    hideHover();
    if (popover && !popover.hidden && selectionRect) positionPopover(selectionRect);
  }

  /**
   * 创建遮罩 DOM、绑定事件并保存启动前焦点。
   * @returns {void}
   */
  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.className = 'annotation-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '页面批注');
    overlay.innerHTML = `
      <div class="annotation-hint" role="note">
        <span class="annotation-hint-text">拖动框选页面区域，或点击元素后拖动</span>
        <kbd class="annotation-kbd">Escape</kbd>
        <span class="annotation-hint-cancel">取消</span>
        <button type="button" class="annotation-close" aria-label="取消页面批注">×</button>
      </div>
      <div class="annotation-hover" hidden>
        <span class="annotation-hover-label"></span>
      </div>
      <div class="annotation-rect" hidden>
        <span class="annotation-handle is-top-left"></span>
        <span class="annotation-handle is-top-right"></span>
        <span class="annotation-handle is-bottom-left"></span>
        <span class="annotation-handle is-bottom-right"></span>
        <span class="annotation-size"></span>
      </div>
      <div class="annotation-popover" role="group" aria-label="批注输入" hidden>
        <div class="annotation-popover-head">
          <span class="annotation-target"></span>
        </div>
        <label class="annotation-label" for="annotation-input">批注</label>
        <textarea id="annotation-input" class="annotation-input" maxlength="500"
          placeholder="写下你希望 AI 关注的细节"></textarea>
        <div class="annotation-actions">
          <span class="annotation-shortcut">⌘/Ctrl + Enter 发送</span>
          <button type="button" class="annotation-cancel">取消</button>
          <button type="button" class="annotation-send" disabled><svg class="annotation-send-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 12.5V3.5M4.5 7 8 3.5 11.5 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>发送</button>
        </div>
      </div>`;
    document.body.append(overlay);

    hoverBox = overlay.querySelector('.annotation-hover');
    hoverLabel = overlay.querySelector('.annotation-hover-label');
    selectionBox = overlay.querySelector('.annotation-rect');
    sizeLabel = overlay.querySelector('.annotation-size');
    popover = overlay.querySelector('.annotation-popover');
    popoverTarget = overlay.querySelector('.annotation-target');
    noteInput = overlay.querySelector('.annotation-input');
    sendButton = overlay.querySelector('.annotation-send');

    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('click', (event) => event.stopPropagation());
    overlay.querySelector('.annotation-close').addEventListener('click', onCloseClick);
    overlay.querySelector('.annotation-cancel').addEventListener('click', onCancelClick);
    sendButton.addEventListener('click', onSendClick);
    noteInput.addEventListener('input', onNoteInput);
    listen(window, 'pointermove', onPointerMove);
    listen(window, 'pointerup', onPointerUp);
    listen(window, 'resize', onResize);
    listen(document, 'keydown', onKeyDown, true);
  }

  /**
   * 启动框选遮罩；重复调用不会叠加实例。
   * @returns {void} 副作用为挂载遮罩、暂存并覆盖 body 样式、注册事件并保存启动前焦点。
   */
  function start() {
    if (active) return;
    active = true;
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBody();
    buildOverlay();
  }

  /**
   * 停止框选遮罩：移除 DOM、解绑事件、恢复 body 样式与焦点；重复调用安全。
   * @returns {void} 不触发 onComplete 或 onCancel，仅做清理。
   */
  function stop() {
    if (!active) return;
    active = false;
    dragging = false;
    dragStart = null;
    selectionRect = null;
    targetElement = null;
    hoverElement = null;
    popoverWasOpen = false;
    for (const off of listeners.splice(0)) off();
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    hoverBox = null;
    hoverLabel = null;
    selectionBox = null;
    sizeLabel = null;
    popover = null;
    popoverTarget = null;
    noteInput = null;
    sendButton = null;
    unlockBody();
    const focusTarget = previousFocus;
    previousFocus = null;
    if (focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') {
      focusTarget.focus({ preventScroll: true });
    }
  }

  /**
   * 查询工具是否处于框选状态。
   * @returns {boolean} 遮罩已挂载且尚未 stop 时为 true。
   */
  function isActive() {
    return active;
  }
  return { start, stop, isActive };
}
