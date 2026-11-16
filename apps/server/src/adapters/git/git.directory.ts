import { GitAdapterError, type GitTreeEntry } from './git.types.ts'

type ReadTree = (ref: string) => Promise<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 将来源的单层目录响应转换成仓库相对路径。
 * @param value GitHub 或 Gitea 返回的目录条目。
 * @param path 当前目录，空字符串表示根目录。
 * @returns 目录下的直接子项。
 * @throws 响应不是目录，或条目超出所请求的目录范围时拒绝读取。
 */
export function parseGitDirectory(value: unknown, path: string): GitTreeEntry[] {
  if (!Array.isArray(value)) throw new GitAdapterError('not_found', '远端目录不存在')
  const prefix = path ? `${path}/` : ''
  return value.map((item: unknown) => {
    if (!isRecord(item) || typeof item.path !== 'string' || !item.path.startsWith(prefix)) {
      throw new GitAdapterError('invalid_response', 'Git 目录条目不合法')
    }
    const name = item.path.slice(prefix.length)
    if (!name || name === '.' || name === '..' || name.includes('/')) {
      throw new GitAdapterError('invalid_response', 'Git 来源返回了非本层目录的条目')
    }
    return {
      path: item.path,
      type: item.type === 'dir' ? 'directory' : 'file',
      size: typeof item.size === 'number' ? item.size : null,
    }
  })
}

/**
 * 读取 GitHub 单层目录，超过 Contents API 上限时逐层定位子树。
 * @param input 分支、仓库相对路径以及同一仓库内的 Contents 和非递归 Tree 读取方法。
 * @returns 所请求目录的直接子项；子树标识仅来自该分支的逐层响应。
 * @throws 目录不存在、来源失败、树响应被截断或超过回退时间预算时拒绝读取。
 */
export async function readGitHubDirectory(input: {
  ref: string
  path: string
  readContents: () => Promise<unknown>
  readTree: ReadTree
}): Promise<GitTreeEntry[]> {
  const { ref, path, readContents, readTree } = input
  if (path) {
    const contents = await readContents()
    // GitHub Contents API 单目录最多返回 1000 条，达到该数量需使用 Git Trees 核对完整列表。
    if (!Array.isArray(contents) || contents.length < 1000) return parseGitDirectory(contents, path)
  }
  const deadline = Date.now() + 15_000
  async function readEntries(treeRef: string): Promise<unknown[]> {
    if (Date.now() >= deadline) throw new GitAdapterError('timeout', 'GitHub 目录读取超时')
    const response = await readTree(treeRef)
    if (!isRecord(response) || !Array.isArray(response.tree) || response.truncated === true) {
      throw new GitAdapterError('invalid_response', 'GitHub 未返回完整的目录')
    }
    return response.tree
  }
  let entries = await readEntries(ref)
  if (path) {
    for (const segment of path.split('/')) {
      const directory = entries.find((entry) => isRecord(entry) && entry.path === segment && entry.type === 'tree')
      if (!isRecord(directory) || typeof directory.sha !== 'string' || !/^[a-f0-9]{40,64}$/i.test(directory.sha)) {
        throw new GitAdapterError('not_found', 'GitHub 目录不存在')
      }
      entries = await readEntries(directory.sha)
    }
  }
  return parseGitDirectory(
    entries.flatMap((entry) => {
      if (!isRecord(entry) || (entry.type !== 'blob' && entry.type !== 'tree')) return []
      return [
        {
          path: typeof entry.path === 'string' && path ? `${path}/${entry.path}` : entry.path,
          type: entry.type === 'tree' ? 'dir' : 'file',
          size: entry.size,
        },
      ]
    }),
    path,
  )
}
