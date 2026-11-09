/**
 * 安全 Markdown 渲染器。
 *
 * 仅依赖浏览器原生能力，供 AI 流式消息正文使用：先把原始文本做 HTML 转义，再按
 * Markdown 语法拼装受控标签，因此任何输入中的原始 HTML 都只会以文本形式展示。
 * 复制/下载按钮只输出结构，事件委托与下载行为由聊天视图统一处理。
 */

/** HTML 转义映射；单次遍历完成，避免二次转义。 */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** 常见语言到文件扩展名的映射，供下载代码块时决定文件名后缀。 */
const LANGUAGE_EXTENSIONS = {
  ts: 'ts', typescript: 'ts', tsx: 'tsx', js: 'js', javascript: 'js', jsx: 'jsx', mjs: 'mjs', cjs: 'cjs',
  json: 'json', jsonc: 'json', css: 'css', scss: 'scss', less: 'less', html: 'html', htm: 'html',
  xml: 'xml', svg: 'svg', md: 'md', markdown: 'md', py: 'py', python: 'py', sh: 'sh', bash: 'sh',
  zsh: 'sh', shell: 'sh', console: 'txt', yml: 'yml', yaml: 'yaml', sql: 'sql', go: 'go', java: 'java',
  rb: 'rb', ruby: 'rb', php: 'php', c: 'c', h: 'h', cpp: 'cpp', 'c++': 'cpp', cs: 'cs', csharp: 'cs',
  rs: 'rs', rust: 'rs', kt: 'kt', kotlin: 'kt', swift: 'swift', toml: 'toml', ini: 'ini', diff: 'diff',
  patch: 'patch', dockerfile: 'dockerfile', graphql: 'graphql', vue: 'vue', svelte: 'svelte',
  txt: 'txt', text: 'txt', plaintext: 'txt',
};

/** 强调片段占位符，防止行内代码、链接内部内容被后续强调规则改写。 */
const PLACEHOLDER = /\u0000(\d+)\u0000/g;

/**
 * 转义 HTML 特殊字符。
 * @param {string} text 待转义文本。
 * @returns {string} 可安全插入 innerHTML 的文本。
 */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/** 代码着色使用的语言别名与关键字集合。 */
const HIGHLIGHT_LANGUAGES = {
  js: ['js', 'javascript', 'jsx', 'mjs', 'cjs', 'ts', 'typescript', 'tsx'],
  py: ['py', 'python'],
  sh: ['sh', 'bash', 'zsh', 'shell', 'console'],
  sql: ['sql'],
  json: ['json', 'jsonc'],
  css: ['css', 'scss', 'less'],
};

/** 各语言的关键字着色列表；只用于代码块展示，不参与 Markdown 结构解析。 */
const CODE_KEYWORDS = {
  js: 'const let var function return if else for while do switch case break continue new class extends async await export import from default try catch finally throw typeof instanceof in of delete void this super yield interface type implements public private protected readonly enum namespace declare satisfies as keyof infer abstract override static get set',
  py: 'def class import from return if elif else for while try except finally with as async await lambda pass raise break continue global nonlocal yield assert del in is not and or print self',
  sh: 'if then else elif fi for while do done case esac function return export local readonly echo printf cd mkdir rm cp mv cat grep rg sed awk npm pnpm yarn node python pip git sudo chmod chown source alias set unset trap shift exit',
  sql: 'select from where insert into values update set delete create table alter drop join left right inner outer on group by order having limit offset and or not null as distinct union primary key foreign references index with',
};

/**
 * 判断语言是否启用简单语法着色。
 * @param {string} language 围栏语言标记。
 * @returns {string} 语言分组：js、py、sh、sql、json、css 或空字符串。
 */
function codeLanguageGroup(language) {
  const key = String(language || '').trim().toLowerCase();
  return Object.keys(HIGHLIGHT_LANGUAGES).find((group) => HIGHLIGHT_LANGUAGES[group].includes(key)) || '';
}

/**
 * 为代码块生成受控的着色 HTML。
 *
 * 只识别注释、字符串、数字、关键字、布尔与函数调用等高价值片段；其余内容保持转义文本。
 * 无法识别的语言直接返回转义后的纯文本，不做高亮或 HTML 注入。
 *
 * @param {string} code 代码原文。
 * @param {string} language 围栏语言标记。
 * @returns {string} 可安全插入 innerHTML 的代码 HTML。
 */
function highlightCode(code, language) {
  const group = codeLanguageGroup(language);
  if (!group) return escapeHtml(code);
  const comment = group === 'py' || group === 'sh' ? '#[^\\n]*'
    : group === 'sql' ? '(?:--[^\\n]*|/\\*[\\s\\S]*?\\*/)'
    : '(?:\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*/)';
  const keywords = (CODE_KEYWORDS[group] || '').split(/\s+/).filter(Boolean).join('|');
  const keywordGroup = keywords ? `(\\b(?:${keywords})\\b)` : '()';
  const pattern = new RegExp(
    `(${comment})|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'|\`(?:[^\`\\\\]|\\\\.)*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|${keywordGroup}|([A-Za-z_$][\\w$]*)(?=\\s*\\()|(\\b(?:true|false|null|undefined|None|True|False|NULL)\\b)`,
    group === 'sql' ? 'gi' : 'g',
  );
  const wrap = (className, text) => `<span class="${className}">${escapeHtml(text)}</span>`;
  let output = '';
  let lastIndex = 0;
  let match = pattern.exec(code);
  while (match) {
    if (match.index > lastIndex) output += escapeHtml(code.slice(lastIndex, match.index));
    if (match[1]) output += wrap('tok-com', match[1]);
    else if (match[2]) output += wrap('tok-str', match[2]);
    else if (match[3]) output += wrap('tok-num', match[3]);
    else if (match[4]) output += wrap('tok-key', match[4]);
    else if (match[5]) output += wrap('tok-fn', match[5]);
    else if (match[6]) output += wrap('tok-bool', match[6]);
    lastIndex = pattern.lastIndex;
    match = pattern.exec(code);
  }
  output += escapeHtml(code.slice(lastIndex));
  return output;
}

/**
 * 判断一行是否开启新的块级结构，供段落收集时提前结束当前段落。
 * @param {string} line 单行原文。
 * @param {string[]} lines 全部行，用于判断表格分隔行。
 * @param {number} index 当前行下标。
 * @returns {boolean} 为 true 时段落在此行之前结束。
 */
function startsBlock(line, lines, index) {
  if (/^ {0,3}(`{3,}|~{3,})/.test(line)) return true;
  if (/^ {0,3}#{1,6}\s+/.test(line)) return true;
  if (/^ {0,3}>/.test(line)) return true;
  if (/^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+/.test(line)) return true;
  if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return true;
  return line.includes('|') && isTableSeparator(lines[index + 1]);
}

/**
 * 判断下一行是否为管道表格的对齐分隔行。
 * @param {string|undefined} line 候选行。
 * @returns {boolean} 每格都匹配 `:---:` 形式的分隔行返回 true。
 */
function isTableSeparator(line) {
  if (!line || !line.includes('|')) return false;
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * 拆分管道表格的行，忽略首尾竖线。
 * @param {string} line 表格行原文。
 * @returns {string[]} 去除首尾空白后的单元格文本。
 */
function splitTableRow(line) {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|')) row = row.slice(0, -1);
  return row.split('|').map((cell) => cell.trim());
}

/**
 * 把表格对齐行转换为 CSS 对齐值。
 * @param {string} cell `:---`、`:---:` 或 `---:` 形式的分隔单元格。
 * @returns {string} `left`、`center` 或 `right`。
 */
function tableAlignment(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

/**
 * 应用强调类行内语法（加粗、斜体、删除线），输入必须是已转义文本。
 * @param {string} text 已转义的行内文本。
 * @returns {string} 含受控强调标签的 HTML。
 */
function applyEmphasis(text) {
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>');
}

/**
 * 渲染行内 Markdown。调用方必须先对文本做 HTML 转义，本函数只输出受控标签。
 * @param {string} escapedText 已转义的行内文本。
 * @returns {string} 行内 HTML；原始 HTML 不会透传。
 */
function formatInline(escapedText) {
  /** @type {string[]} 受保护片段，顺序与占位符编号一致。 */
  const stash = [];
  /** 暂存已渲染片段并返回占位符，避免后续规则二次处理。 */
  const protect = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  /** 用已暂存片段还原文本中的占位符。 */
  const resolve = (text) => text.replace(PLACEHOLDER, (_, index) => stash[Number(index)]);

  // 行内代码优先保护，代码内部的 *、_、[] 不再参与其他语法解析。
  let output = escapedText.replace(/`([^`\n]+)`/g, (_, code) => protect(`<code>${code}</code>`));

  // 链接仅接受 http/https；非法协议保留原文本，不生成可点击链接。
  output = output.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label, url) => {
    if (!/^https?:\/\//i.test(url)) return whole;
    const safeLabel = applyEmphasis(resolve(label));
    return protect(`<a href="${url}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`);
  });

  output = applyEmphasis(output);
  return resolve(output);
}

/**
 * 渲染围栏代码块。
 * @param {string} language 代码语言标记，可为空。
 * @param {string} code 代码原文，函数内部负责转义。
 * @returns {string} 带语言头、复制/下载按钮与可横向滚动代码区的结构。
 */
function renderCodeBlock(language, code) {
  const normalized = language.trim();
  const label = normalized || 'text';
  const codeClass = normalized || 'text';
  return `<div class="md-code" data-language="${escapeHtml(normalized)}"><div class="md-code-head"><span class="md-code-lang">${escapeHtml(label)}</span><span class="md-code-actions"><button type="button" class="md-code-copy" data-copy-code aria-label="复制代码">复制</button><button type="button" class="md-code-download" data-download-code aria-label="下载代码">下载</button></span></div><pre><code class="language-${escapeHtml(codeClass)}">${highlightCode(code, normalized)}</code></pre></div>`;
}

/**
 * 渲染管道表格。
 * @param {string[]} headerCells 表头单元格原文。
 * @param {string[]} alignCells 对齐分隔行单元格。
 * @param {string[][]} bodyRows 表体各行的单元格原文。
 * @returns {string} 外层可横向滚动的表格 HTML。
 */
function renderTable(headerCells, alignCells, bodyRows) {
  const columnCount = headerCells.length;
  const alignments = Array.from({ length: columnCount }, (_, index) => tableAlignment(alignCells[index] || '---'));
  const renderCells = (cells, tag) => cells.map((cell, index) => `<${tag} style="text-align:${alignments[index]}">${formatInline(escapeHtml(cell))}</${tag}>`).join('');
  const head = `<thead><tr>${renderCells(headerCells, 'th')}</tr></thead>`;
  const body = bodyRows.length
    ? `<tbody>${bodyRows.map((cells) => `<tr>${renderCells(Array.from({ length: columnCount }, (_, index) => cells[index] || ''), 'td')}</tr>`).join('')}</tbody>`
    : '';
  return `<div class="md-table-wrap"><table>${head}${body}</table></div>`;
}

/**
 * 渲染 Markdown 文档为安全 HTML。
 *
 * 支持的块级语法：ATX 标题（# ~ ######）、段落、引用、无序/有序列表、分隔线、
 * 管道表格（含对齐行）、围栏代码块（```lang 或 ~~~lang）。行内语法：加粗、斜体、
 * 删除线、行内代码、http/https 链接。代码块内不解析 Markdown；表格单元格支持行内语法。
 *
 * @param {string} source Markdown 原文；传入 null、undefined 或空字符串时返回空字符串。
 * @returns {string} 已转义并拼接完成的 HTML 字符串，可直接写入 innerHTML。
 * @throws 不会抛出异常；未闭合的围栏代码块按普通代码块渲染到文本结尾。
 */
export function renderMarkdown(source) {
  if (source === null || source === undefined) return '';
  const text = String(source).replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  if (!text.trim()) return '';

  const lines = text.split('\n');
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    // 空行只用于分隔块，不产生输出。
    if (!line.trim()) {
      index += 1;
      continue;
    }

    // 围栏代码块：收集到同类型且不短于开围栏的结束行；未闭合时消费到结尾。
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/);
    if (fence) {
      const marker = fence[1][0];
      const markerLength = fence[1].length;
      const language = fence[2] || '';
      const codeLines = [];
      index += 1;
      while (index < lines.length) {
        const closePattern = new RegExp(`^ {0,3}${marker === '`' ? '`' : '~'}{${markerLength},}\\s*$`);
        if (closePattern.test(lines[index])) {
          index += 1;
          break;
        }
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderCodeBlock(language, codeLines.join('\n')));
      continue;
    }

    // ATX 标题。
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${formatInline(escapeHtml(heading[2]))}</h${level}>`);
      index += 1;
      continue;
    }

    // 分隔线。
    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push('<hr>');
      index += 1;
      continue;
    }

    // 引用：连续 > 行合并为一个段落，保留手动换行。
    if (/^ {0,3}>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^ {0,3}>\s?/, ''));
        index += 1;
      }
      const content = quoteLines.map((quoteLine) => formatInline(escapeHtml(quoteLine))).join('<br>');
      blocks.push(`<blockquote><p>${content}</p></blockquote>`);
      continue;
    }

    // 无序列表。
    if (/^ {0,3}[-*+]\s+/.test(line)) {
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^ {0,3}[-*+]\s+(.*)$/);
        if (!item) break;
        items.push(`<li>${formatInline(escapeHtml(item[1]))}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    // 有序列表。
    if (/^ {0,3}\d{1,9}[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(/^ {0,3}\d{1,9}[.)]\s+(.*)$/);
        if (!item) break;
        items.push(`<li>${formatInline(escapeHtml(item[1]))}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    // 管道表格：当前行含竖线且下一行为对齐分隔行。
    if (line.includes('|') && isTableSeparator(lines[index + 1])) {
      const headerCells = splitTableRow(line);
      const alignCells = splitTableRow(lines[index + 1]);
      const bodyRows = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        bodyRows.push(splitTableRow(lines[index]));
        index += 1;
      }
      blocks.push(renderTable(headerCells, alignCells, bodyRows));
      continue;
    }

    // 普通段落：收集到空行或新块开始，手动换行保留为 <br>。
    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !startsBlock(lines[index], lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    // 防御：若首行本身即块开始（极端输入），至少消费一行避免死循环。
    if (!paragraphLines.length) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${paragraphLines.map((paragraphLine) => formatInline(escapeHtml(paragraphLine))).join('<br>')}</p>`);
  }

  return blocks.join('\n');
}

/**
 * 把代码块语言标记映射为下载文件的扩展名。
 * @param {string} language 围栏代码块的语言标记，例如 `ts`、`python`；大小写不敏感。
 * @returns {string} 常用扩展名；未知或空语言回退为 `txt`。
 */
export function languageToExtension(language) {
  const key = String(language || '').trim().toLowerCase();
  return LANGUAGE_EXTENSIONS[key] || 'txt';
}
