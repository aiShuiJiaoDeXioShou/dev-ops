import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const tokensPath = join(root, 'design/tokens.json')
const cssPath = join(root, 'apps/web/src/shared/styles/index.css')
const mainPath = join(root, 'apps/web/src/main.tsx')
const layeredPath = join(root, 'apps/web/src/prototype/styles/layered.css')
const baselinePath = join(root, 'tooling/design/ui-baseline.json')
const scanRoots = [
  join(root, 'apps/web/src/app'),
  join(root, 'apps/web/src/pages'),
  join(root, 'apps/web/src/features'),
]
const updateBaseline = process.argv.includes('--update-baseline')
const errors = []

/**
 * 把 CSS 值标准化后用于 token 对照。
 * @param value CSS 值。
 * @returns 去掉空白并统一为小写的值；颜色/var() 比较时不受格式影响。
 */
function normalizeValue(value) {
  return String(value).trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 把 camelCase token 名转换为 CSS 变量使用的 kebab-case。
 * @param value token 名。
 * @returns CSS 自定义属性名。
 */
function toCssName(value) {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}

/**
 * 读取指定选择器的第一段 CSS 声明块。
 * @param css CSS 文本。
 * @param selector 选择器。
 * @returns 声明块文本；找不到时为 undefined。
 */
function findBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`).exec(css)?.[1]
}

/**
 * 把 CSS 声明块解析成自定义属性表。
 * @param block CSS 声明块。
 * @returns 自定义属性名到值的映射。
 */
function parseDeclarations(block) {
  const declarations = new Map()
  if (!block) return declarations
  for (const match of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim())
  }
  return declarations
}

/**
 * 递归查找指定目录下需要检查的 TSX 页面文件。
 * @param path 目录。
 * @returns 文件绝对路径列表；跳过测试文件。
 */
async function listPageFiles(path) {
  const entries = await readdir(path, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const target = join(path, entry.name)
    if (entry.isDirectory()) files.push(...(await listPageFiles(target)))
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) files.push(target)
  }
  return files
}

/**
 * 统计页面/feature 中的 UI 违规数量。
 * @returns 以项目相对路径和规则名为键的计数。
 */
async function collectViolations() {
  const current = {}
  for (const rootPath of scanRoots) {
    for (const file of await listPageFiles(rootPath)) {
      const content = await readFile(file, 'utf8')
      const filePath = relative(root, file).split('\\').join('/')
      const counts = {}
      const rawControls = content.match(/<(button|input|select|textarea|table)(?=[\s>])/g) ?? []
      if (rawControls.length > 0) counts['raw-control'] = rawControls.length
      const classNames = [...content.matchAll(/className=(?:"([^"]*)"|'([^']*)')/g)].map(
        (match) => match[1] ?? match[2] ?? '',
      )
      const arbitraryValues = classNames.reduce(
        (total, value) => total + (value.match(/\b[a-zA-Z-]+-\[[^\]]+\]/g)?.length ?? 0),
        0,
      )
      if (arbitraryValues > 0) counts['arbitrary-value'] = arbitraryValues
      const hardcodedColors = content.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []
      if (hardcodedColors.length > 0) counts['hardcoded-color'] = hardcodedColors.length
      const prototypeImports = content.match(/from ['"]@\/prototype\//g) ?? []
      if (prototypeImports.length > 0) counts['prototype-import'] = prototypeImports.length
      const inlineStyles = content.match(/style=\{\{/g) ?? []
      if (inlineStyles.length > 0) counts['inline-style'] = inlineStyles.length
      if (Object.keys(counts).length > 0) current[filePath] = counts
    }
  }
  return current
}

/**
 * 校验 token 源和 CSS 映射是否一致。
 * @returns 是否通过。
 */
async function checkTokens() {
  let tokens
  try {
    tokens = JSON.parse(await readFile(tokensPath, 'utf8'))
  } catch (error) {
    errors.push(`无法读取 design/tokens.json：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
  const requiredGroups = ['color', 'status', 'radius', 'typography', 'spacing', 'layout', 'motion']
  for (const group of requiredGroups) {
    if (!tokens[group] || typeof tokens[group] !== 'object') errors.push(`design/tokens.json 缺少 ${group} 分组`)
  }
  if (!tokens.color?.light || !tokens.color?.dark) {
    errors.push('design/tokens.json 必须同时包含 color.light 和 color.dark')
    return false
  }
  const css = (await readFile(cssPath, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
  const lightDeclarations = parseDeclarations(findBlock(css, ':root'))
  const darkDeclarations = parseDeclarations(findBlock(css, '.dark'))
  const allDeclarations = parseDeclarations(css)
  for (const [theme, declarations] of [
    ['light', lightDeclarations],
    ['dark', darkDeclarations],
  ]) {
    for (const [name, value] of Object.entries(tokens.color[theme])) {
      const cssName = `--${toCssName(name)}`
      const actual = declarations.get(cssName.slice(2))
      if (!actual) {
        errors.push(`token ${theme}.${name} 未在 CSS 中定义 ${cssName}`)
      } else if (normalizeValue(actual) !== normalizeValue(value)) {
        errors.push(`token ${theme}.${name} 期望 ${value}，CSS 实际为 ${actual}`)
      }
    }
  }
  const statusMap = {
    success: ['--color-success', allDeclarations],
    warning: ['--color-warning', allDeclarations],
    danger: ['--destructive', lightDeclarations],
    info: ['--primary', lightDeclarations],
  }
  for (const [name, [cssName, declarations]] of Object.entries(statusMap)) {
    const actual = declarations.get(cssName.slice(2))
    if (!actual) errors.push(`状态 token ${name} 缺少 CSS 变量 ${cssName}`)
    else if (normalizeValue(actual) !== normalizeValue(tokens.status[name])) {
      errors.push(`状态 token ${name} 期望 ${tokens.status[name]}，CSS 实际为 ${actual}`)
    }
  }
  const radiusActual = lightDeclarations.get('radius')
  if (!radiusActual) errors.push('CSS 缺少 --radius')
  else if (normalizeValue(radiusActual) !== normalizeValue(tokens.radius.base)) {
    errors.push(`radius.base 期望 ${tokens.radius.base}，CSS 实际为 ${radiusActual}`)
  }
  const fontActual = allDeclarations.get('font-sans')
  if (fontActual && normalizeValue(fontActual) !== normalizeValue(tokens.typography.fontSans)) {
    errors.push(`typography.fontSans 期望 ${tokens.typography.fontSans}，CSS 实际为 ${fontActual}`)
  }
  return errors.length === 0
}

/**
 * 校验基础视觉层的导入顺序和层声明。
 * @returns 是否通过。
 */
async function checkLayering() {
  const main = await readFile(mainPath, 'utf8')
  const layered = main.indexOf('@/prototype/styles/layered.css')
  const shared = main.indexOf('./shared/styles/index.css')
  if (layered < 0 || shared < 0 || layered > shared) {
    errors.push('main.tsx 必须先导入 @/prototype/styles/layered.css，再导入 ./shared/styles/index.css')
  }
  const layerCss = await readFile(layeredPath, 'utf8')
  if (!layerCss.includes('@layer theme, base, prototype, components, utilities;')) {
    errors.push('layered.css 必须声明 theme, base, prototype, components, utilities 的固定顺序')
  }
  for (const file of ['styles.css', 'workspace.css', 'product.css', 'markdown.css', 'v01.css']) {
    if (!layerCss.includes(`layer(prototype)`)) errors.push(`layered.css 的 ${file} 导入必须使用 layer(prototype)`)
  }
  return true
}

/**
 * 对比当前违规与已登记 baseline。
 * @param violations 当前违规计数。
 * @returns 新增违规数量。
 */
async function checkViolations(violations) {
  const current = Object.entries(violations).reduce(
    (total, [, counts]) => total + Object.values(counts).reduce((sum, count) => sum + count, 0),
    0,
  )
  if (updateBaseline) {
    await mkdir(dirname(baselinePath), { recursive: true })
    await writeFile(
      baselinePath,
      `${JSON.stringify({ version: 1, description: '存量 UI 违规；只能减少，不能通过更新 baseline 放行新违规。', violations }, null, 2)}\n`,
    )
    console.log(`已更新 UI baseline：${Object.keys(violations).length} 个文件，${current} 处存量。`)
    return 0
  }
  let baseline
  try {
    baseline = JSON.parse(await readFile(baselinePath, 'utf8'))
  } catch {
    errors.push('缺少 tooling/design/ui-baseline.json；首次建立请运行 pnpm ui:baseline 并提交 baseline。')
    return 0
  }
  let newViolations = 0
  for (const [file, counts] of Object.entries(violations)) {
    for (const [rule, count] of Object.entries(counts)) {
      const allowed = baseline.violations?.[file]?.[rule] ?? 0
      if (count > allowed) {
        errors.push(`新增 UI 违规：${file} ${rule} ${count} 处（baseline ${allowed}）`)
        newViolations += count - allowed
      }
    }
  }
  const existing = Object.entries(baseline.violations ?? {}).reduce(
    (total, [, counts]) => total + Object.values(counts).reduce((sum, count) => sum + count, 0),
    0,
  )
  console.log(`UI baseline：${existing} 处存量，${newViolations} 处新增。`)
  return newViolations
}

await checkTokens()
await checkLayering()
const violations = await collectViolations()
await checkViolations(violations)

if (errors.length > 0) {
  console.error('\nUI 规范检查失败：')
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else if (!updateBaseline) {
  console.log('UI 规范检查通过：token、分层顺序和存量 baseline 均正常。')
}
