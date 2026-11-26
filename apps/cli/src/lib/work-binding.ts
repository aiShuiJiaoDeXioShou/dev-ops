import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { z } from 'zod'

import { CliError } from './errors.ts'
import { gitPrivatePath } from './git.ts'

/** 绑定文件位于当前 worktree 的私有 git 目录，不进入版本库，也不会被其他 worktree 读到。 */
const BINDING_PATH = 'devops/active.json'

const checkpointSchema = z.object({ head: z.string(), at: z.string() }).strict()

const trackedSchema = z
  .object({
    mode: z.literal('tracked'),
    projectId: z.string(),
    repositoryId: z.string(),
    kind: z.enum(['requirement', 'bug']),
    itemId: z.string(),
    number: z.number().int().positive(),
    title: z.string(),
    baseSha: z.string(),
    startedAt: z.string(),
    /** 最近一次 `work log` 或 `work deliver` 时的 HEAD；之后的新提交视为尚未回写进展。 */
    reported: checkpointSchema.nullable(),
    /** 最近一次 `work deliver` 时的 HEAD。 */
    delivered: checkpointSchema.nullable(),
  })
  .strict()

const untrackedSchema = z
  .object({
    mode: z.literal('untracked'),
    reason: z.string().min(1),
    startedAt: z.string(),
  })
  .strict()

const bindingSchema = z.discriminatedUnion('mode', [trackedSchema, untrackedSchema])

/** 当前工作区绑定的事项。 */
export type TrackedBinding = z.infer<typeof trackedSchema>
/** 明确声明无需事项的改动，例如咨询、平台故障恢复或用户说明不登记的琐碎修改。 */
export type UntrackedBinding = z.infer<typeof untrackedSchema>
export type WorkBinding = z.infer<typeof bindingSchema>
export type WorkItemKind = TrackedBinding['kind']

/**
 * 格式化事项编号，例如 `REQ-11`、`BUG-3`。
 * @param kind 事项类型。
 * @param number 项目内编号。
 * @returns 供命令和提示使用的短编号。
 */
export function formatWorkItemRef(kind: WorkItemKind, number: number): string {
  return `${kind === 'requirement' ? 'REQ' : 'BUG'}-${number}`
}

/**
 * 读取当前 worktree 的事项绑定。
 * @param cwd 工作目录。
 * @returns 绑定内容；未绑定时返回 null。
 * @throws 文件内容损坏时抛出退出码 2 的 CliError，提示运行 `devops work stop` 后重新绑定。
 */
export async function readWorkBinding(cwd: string): Promise<WorkBinding | null> {
  const path = await gitPrivatePath(cwd, BINDING_PATH)
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw new CliError('无法读取事项绑定文件', 1, { code: 'WORK_BINDING_UNREADABLE' })
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return bindingSchema.parse(parsed)
  } catch {
    throw new CliError('事项绑定文件已损坏，请运行 devops work stop 后重新绑定', 2, { code: 'WORK_BINDING_INVALID' })
  }
}

/**
 * 原子写入当前 worktree 的事项绑定。
 * @param cwd 工作目录。
 * @param binding 新的绑定内容。
 */
export async function writeWorkBinding(cwd: string, binding: WorkBinding): Promise<void> {
  const path = await gitPrivatePath(cwd, BINDING_PATH)
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, `${JSON.stringify(bindingSchema.parse(binding), null, 2)}\n`, { mode: 0o600 })
}

/**
 * 删除当前 worktree 的事项绑定；本来未绑定时不报错。
 * @param cwd 工作目录。
 */
export async function clearWorkBinding(cwd: string): Promise<void> {
  await rm(await gitPrivatePath(cwd, BINDING_PATH), { force: true })
}

/**
 * 读取并要求当前 worktree 已绑定事项。
 * @param cwd 工作目录。
 * @returns 已绑定事项。
 * @throws 未绑定或声明为无需事项时抛出退出码 2 的 CliError。
 */
export async function requireTrackedBinding(cwd: string): Promise<TrackedBinding> {
  const binding = await readWorkBinding(cwd)
  if (binding?.mode === 'tracked') return binding
  throw new CliError('当前工作区未绑定事项，请先运行 devops work start <REQ-编号|BUG-编号>', 2, {
    code: 'WORK_NOT_STARTED',
  })
}
