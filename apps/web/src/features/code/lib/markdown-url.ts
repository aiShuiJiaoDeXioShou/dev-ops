/**
 * 将 Markdown 相对资源定位到当前仓库分支，保留外链与文档内锚点。
 * @param url Markdown 中的原始地址（应先经过协议过滤）。
 * @param kind 图片使用 raw 地址，链接使用来源文件页面。
 * @param repository 仓库提供方、网页地址、分支和当前文档路径。
 * @returns 编码后的来源地址；越过仓库根目录或非法编码返回空字符串。
 */
export function repositoryMarkdownUrl(
  url: string,
  kind: 'image' | 'link',
  repository: { providerKey: string; webUrl: string; branch: string; path: string },
): string {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return url
  const suffixIndex = url.search(/[?#]/)
  const pathname = suffixIndex < 0 ? url : url.slice(0, suffixIndex)
  const suffix = suffixIndex < 0 ? '' : url.slice(suffixIndex)
  const segments = url.startsWith('/') ? [] : repository.path.split('/').slice(0, -1)
  try {
    for (const segment of pathname.split('/')) {
      const decoded = decodeURIComponent(segment)
      if (!decoded || decoded === '.') continue
      if (decoded === '..') {
        if (!segments.length) return ''
        segments.pop()
      } else {
        if (/[\\/]/.test(decoded)) return ''
        segments.push(decoded)
      }
    }
  } catch {
    return ''
  }
  const path = segments.map(encodeURIComponent).join('/')
  const base = repository.webUrl.replace(/\/$/, '')
  const branch = encodeURIComponent(repository.branch)
  if (kind === 'image' && repository.providerKey === 'github' && new URL(base).hostname === 'github.com') {
    return `https://raw.githubusercontent.com${new URL(base).pathname}/${branch}/${path}${suffix}`
  }
  const route =
    repository.providerKey === 'gitea'
      ? kind === 'image'
        ? 'raw/branch'
        : 'src/branch'
      : kind === 'image'
        ? 'raw'
        : 'blob'
  return `${base}/${route}/${branch}/${path}${suffix}`
}
