/**
 * 选择代码页默认预览文件：仅根目录 README.md 自动打开。
 * 根目录没有 README 时返回空字符串，让页面显示“选择文件”的空状态，不猜测其他文件。
 * @param files 仓库根目录的文件路径列表。
 * @returns 默认预览路径；没有 README.md 时为空字符串。
 */
export function pickDefaultPreviewPath(files: readonly string[]): string {
  return files.find((path) => path.toLowerCase() === 'readme.md') ?? ''
}
