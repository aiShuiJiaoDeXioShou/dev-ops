#!/usr/bin/env node
/**
 * Codex 与 Claude Code 共用的 DevOps 事项追踪 hook。
 *
 * 两个工具的 hooks.json 输入输出约定一致：stdin 读事件 JSON，stdout 输出
 * `hookSpecificOutput.additionalContext`、`permissionDecision` 或 `decision: "block"`。
 * 本脚本只做判断与提示，事项读写全部交给 `devops work` 命令，规则只保留一份。
 *
 * 用法：node tooling/agent-hooks/devops-hook.mjs <session-start|pre-edit|post-bash|stop>
 *
 * 环境变量：
 * - DEVOPS_HOOKS_DISABLED=1：跳过全部检查，用于平台故障等需要临时绕开的场景。
 * - DEVOPS_HOOK_CLI：指定 devops CLI 可执行文件；以 .js/.mjs/.ts 结尾时用 node 运行。
 */
import { execFile } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** 各事件调用 CLI 的超时；需低于 hooks.json 中声明的 hook 超时，留出启动余量。 */
const TIMEOUTS_MS = { local: 5_000, status: 12_000, link: 25_000 }

/**
 * @typedef {{ code: string, blocking: boolean, message: string }} WorkGap
 * @typedef {{ binding: 'none' | 'untracked' | 'tracked', reason?: string,
 *   item?: { ref: string, title: string, status: string },
 *   tasks?: { total: number, done: number, open: Array<{ id: string, title: string }> },
 *   gaps: WorkGap[] }} WorkStatus
 * @typedef {{ ok: true, data: unknown } | { ok: false, message: string }} CliResult
 */

/**
 * 读取标准输入中的事件 JSON；内容为空或不是对象时返回空对象。
 * @returns {Promise<Record<string, unknown>>}
 */
async function readEvent() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  if (!text.trim()) return {}
  const value = JSON.parse(text)
  return typeof value === 'object' && value !== null ? value : {}
}

/**
 * 解析仓库根目录；不在 Git 仓库内时返回 null，hook 直接放行。
 * @param {string} cwd
 * @returns {Promise<string | null>}
 */
async function repositoryRoot(cwd) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 3_000 })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * 列出可用的 CLI 调用方式：显式指定、仓库内构建产物、PATH 中的 devops。
 * 仓库构建优先，因为全局安装的 CLI 可能早于本仓库新增的 `work` 命令。
 * @param {string} root 仓库根目录。
 * @returns {Array<{ command: string, prefix: string[] }>}
 */
function cliCandidates(root) {
  const explicit = process.env.DEVOPS_HOOK_CLI
  if (explicit) {
    const isScript = /\.(c|m)?(j|t)s$/.test(explicit)
    return [isScript ? { command: process.execPath, prefix: [explicit] } : { command: explicit, prefix: [] }]
  }
  const candidates = []
  const built = resolve(root, 'apps/cli/dist/index.js')
  if (existsSync(built)) candidates.push({ command: process.execPath, prefix: [built] })
  candidates.push({ command: 'devops', prefix: [] })
  return candidates
}

/**
 * 以 JSON 模式运行 devops CLI。
 * @param {string} root 仓库根目录，作为 CLI 工作目录。
 * @param {string[]} args 命令参数，不含 --json。
 * @param {number} timeout 超时毫秒数。
 * @returns {Promise<CliResult>} 成功时返回信封中的 data；失败时返回可展示的原因，不包含凭据。
 */
async function runCli(root, args, timeout) {
  /** @type {string | undefined} */
  let lastFailure
  for (const candidate of cliCandidates(root)) {
    try {
      const { stdout } = await execFileAsync(candidate.command, [...candidate.prefix, ...args, '--json'], {
        cwd: root,
        timeout,
        maxBuffer: 4 * 1024 * 1024,
      })
      return { ok: true, data: JSON.parse(stdout).data }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') continue
      lastFailure = cliFailureMessage(error)
      // 旧版 CLI 没有 work 命令时以参数错误退出，继续尝试下一个候选。
      if (error && typeof error === 'object' && 'code' in error && error.code === 2) continue
      return { ok: false, message: lastFailure }
    }
  }
  return { ok: false, message: lastFailure ?? '找不到 devops CLI，请按 apps/cli/README.md 安装或构建' }
}

/**
 * 从 CLI 失败中提取错误信息；--json 模式下 stderr 是错误 JSON。
 * @param {unknown} error
 * @returns {string}
 */
function cliFailureMessage(error) {
  if (error && typeof error === 'object' && 'killed' in error && error.killed) return 'devops CLI 执行超时'
  const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''
  try {
    const payload = JSON.parse(stderr)
    if (payload && typeof payload.message === 'string') return payload.message
  } catch {
    // stderr 不是 JSON 时退回通用描述，避免把未知输出原样回显给编码助手。
  }
  return 'devops CLI 执行失败'
}

/**
 * 读取工作状态。
 * @param {string} root
 * @param {boolean} isLocal 是否只读本地绑定。
 * @returns {Promise<{ ok: true, status: WorkStatus } | { ok: false, message: string }>}
 */
async function readStatus(root, isLocal) {
  const result = await runCli(
    root,
    ['work', 'status', ...(isLocal ? ['--local'] : [])],
    isLocal ? TIMEOUTS_MS.local : TIMEOUTS_MS.status,
  )
  if (!result.ok) return result
  return { ok: true, status: /** @type {WorkStatus} */ (result.data) }
}

/** 未绑定事项时给编码助手的操作说明。 */
const START_GUIDE = [
  '本仓库的修改必须在 DevOps 事项下进行（见 AGENTS.md「DevOps 事项追踪」与 devops-workflow 技能）。',
  '修改文件前运行 `devops work start <REQ-编号|BUG-编号>` 绑定事项；没有对应事项时先按技能登记需求或 Bug。',
  '确实无需事项的改动（只读排查后的咨询、平台故障恢复、用户明确说明不登记）运行 `devops work start --untracked "<原因>"`。',
].join('\n')

/**
 * 生成事项摘要，用于会话开始时注入上下文。
 * @param {WorkStatus} status
 * @returns {string}
 */
function describeStatus(status) {
  if (status.binding === 'none') return START_GUIDE
  if (status.binding === 'untracked') return `当前工作区已声明无需 DevOps 事项：${status.reason ?? ''}`
  const lines = [
    `当前工作区绑定 DevOps 事项 ${status.item?.ref ?? ''} ${status.item?.title ?? ''}（${status.item?.status ?? ''}）。`,
  ]
  if (status.tasks) lines.push(`待办 ${status.tasks.done}/${status.tasks.total} 完成。`)
  for (const gap of status.gaps) lines.push(`${gap.blocking ? '待完成' : '提示'}：${gap.message}`)
  lines.push(
    '按 devops-workflow 技能推进：完成一个待办就提交并 `devops work task done`，结束前 `devops work deliver` 或 `devops work log`。',
  )
  return lines.join('\n')
}

/**
 * 从编辑类工具输入中取出目标文件路径；Codex apply_patch 从补丁头解析。
 * @param {unknown} toolInput
 * @returns {string[]}
 */
export function editedPaths(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return []
  const input = /** @type {Record<string, unknown>} */ (toolInput)
  const direct = ['file_path', 'notebook_path', 'path']
    .map((key) => input[key])
    .filter((value) => typeof value === 'string')
  if (direct.length > 0) return /** @type {string[]} */ (direct)
  const patch = typeof input.command === 'string' ? input.command : typeof input.input === 'string' ? input.input : ''
  return [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((match) => match[1].trim())
}

/**
 * 解析符号链接后的绝对路径；文件尚不存在时解析最近的已存在上级目录。
 * macOS 的 /var 指向 /private/var，git 返回的仓库根目录是解析后的路径，比较前必须统一。
 * @param {string} path 绝对路径。
 * @returns {string}
 */
function realPath(path) {
  try {
    return realpathSync(path)
  } catch {
    const parent = dirname(path)
    return parent === path ? path : join(realPath(parent), basename(path))
  }
}

/**
 * 判断编辑是否落在仓库内；无法确定目标时按仓库内处理。
 * @param {string[]} paths 工具给出的路径，可能是相对路径。
 * @param {string} cwd 事件的工作目录。
 * @param {string} root 仓库根目录。
 * @returns {boolean}
 */
export function touchesRepository(paths, cwd, root) {
  if (paths.length === 0) return true
  const realRoot = realPath(root)
  return paths.some((path) => {
    const fromRoot = relative(realRoot, realPath(resolve(cwd, path)))
    return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))
  })
}

/**
 * 处理会话开始：注入当前事项与缺项。
 * @param {string} root
 * @returns {Promise<object | null>}
 */
async function onSessionStart(root) {
  const result = await readStatus(root, false)
  const additionalContext = result.ok
    ? describeStatus(result.status)
    : `无法读取 DevOps 事项状态：${result.message}\n${START_GUIDE}`
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }
}

/**
 * 处理编辑前检查：未绑定事项时拒绝修改仓库文件。
 * @param {string} root
 * @param {Record<string, unknown>} event
 * @returns {Promise<object | null>}
 */
async function onPreEdit(root, event) {
  const cwd = typeof event.cwd === 'string' ? event.cwd : root
  if (!touchesRepository(editedPaths(event.tool_input), cwd, root)) return null
  const result = await readStatus(root, true)
  if (!result.ok) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: `无法检查 DevOps 事项绑定：${result.message}。请手动确认已按 AGENTS.md 登记事项。`,
      },
    }
  }
  if (result.status.binding !== 'none') return null
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: START_GUIDE,
    },
  }
}

/**
 * 处理命令执行后：推送后自动关联提交，提交后提醒勾选待办。
 * @param {string} root
 * @param {Record<string, unknown>} event
 * @returns {Promise<object | null>}
 */
async function onPostBash(root, event) {
  const input =
    event.tool_input && typeof event.tool_input === 'object'
      ? /** @type {Record<string, unknown>} */ (event.tool_input)
      : {}
  const command = typeof input.command === 'string' ? input.command : ''
  const isPush = /\bgit\b[^\n;&|]*\bpush\b/.test(command)
  const isCommit = /\bgit\b[^\n;&|]*\bcommit\b/.test(command)
  if (!isPush && !isCommit) return null
  const local = await readStatus(root, true)
  if (!local.ok || local.status.binding !== 'tracked') return null
  const ref = local.status.item?.ref ?? ''
  const notes = []
  if (isCommit) {
    notes.push(
      `已提交到 ${ref}：用 \`devops work task done <待办ID>\` 勾选这次完成的待办；还有后续工作时用 \`devops work log\` 记录进展。`,
    )
  }
  if (isPush) {
    const linked = await runCli(root, ['work', 'link'], TIMEOUTS_MS.link)
    if (linked.ok) {
      const data = /** @type {{ linked?: string[] }} */ (linked.data)
      const items = data.linked ?? []
      notes.push(items.length > 0 ? `已把 ${items.join('、')} 关联到 ${ref}。` : `${ref} 没有需要新关联的已推送提交。`)
    } else {
      notes.push(`自动关联提交失败：${linked.message}。确认推送成功后运行 \`devops work link\`。`)
    }
  }
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') } }
}

/**
 * 处理结束前检查：仍有阻塞缺项时要求编码助手补完一次。
 * @param {string} root
 * @param {Record<string, unknown>} event
 * @returns {Promise<object | null>}
 */
async function onStop(root, event) {
  // 已经因本 hook 继续过一轮时放行，避免缺项无法自动补齐（例如需要用户确认）时陷入循环。
  if (event.stop_hook_active === true) return null
  const result = await readStatus(root, false)
  if (!result.ok || result.status.binding !== 'tracked') return null
  const blocking = result.status.gaps.filter((gap) => gap.blocking)
  if (blocking.length === 0) return null
  const reason = [
    `DevOps 事项 ${result.status.item?.ref ?? ''} 还有未完成的追踪步骤：`,
    ...blocking.map((gap) => `- ${gap.message}`),
    '补完后再结束。需要用户决定的内容（例如测试负责人、是否推送）不要自行假设，回写进展后直接询问用户。',
  ].join('\n')
  return { decision: 'block', reason }
}

/** @type {Record<string, (root: string, event: Record<string, unknown>) => Promise<object | null>>} */
const HANDLERS = {
  'session-start': (root) => onSessionStart(root),
  'pre-edit': onPreEdit,
  'post-bash': onPostBash,
  stop: onStop,
}

/**
 * 入口：任何意外错误都放行并写入 stderr，hook 故障不能阻断编码助手正常工作。
 * @param {string | undefined} eventName
 */
async function main(eventName) {
  const handler = eventName ? HANDLERS[eventName] : undefined
  if (!handler) {
    process.stderr.write(`未知 hook 事件：${eventName ?? ''}，可选 ${Object.keys(HANDLERS).join('、')}\n`)
    return
  }
  if (process.env.DEVOPS_HOOKS_DISABLED === '1') return
  try {
    const event = await readEvent()
    const cwd = typeof event.cwd === 'string' && event.cwd ? event.cwd : process.cwd()
    const root = await repositoryRoot(cwd)
    if (!root) return
    const output = await handler(root, event)
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`)
  } catch (error) {
    process.stderr.write(`DevOps hook 执行失败：${error instanceof Error ? error.message : String(error)}\n`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv[2])
}
