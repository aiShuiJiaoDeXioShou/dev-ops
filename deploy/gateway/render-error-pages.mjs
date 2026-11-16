import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import designTokens from '../../design/tokens.json' with { type: 'json' }
import { GATEWAY_FAILURES } from '../../apps/web/src/shared/ui/gateway-failures.ts'

const outputDirectory = process.argv[2]
if (!outputDirectory) throw new Error('请提供错误页输出目录')

const template = await readFile(new URL('./error-page.html', import.meta.url), 'utf8')
const colorNames = ['background', 'foreground', 'mutedForeground', 'border', 'primary', 'primaryForeground']
const renderTheme = (theme) => colorNames.map((name) => `--${name}: ${theme[name]};`).join('\n')
const escapeText = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

await mkdir(outputDirectory, { recursive: true })
for (const [status, { title, description, mascot }] of Object.entries(GATEWAY_FAILURES)) {
  const image = await readFile(new URL(`../../apps/web/public/prototype/bots/bot-${mascot}.svg`, import.meta.url))
  const values = {
    title: escapeText(title),
    description: escapeText(description),
    light: `${renderTheme(designTokens.color.light)}\n--radius: ${designTokens.radius.base};`,
    dark: renderTheme(designTokens.color.dark),
    image: `data:image/svg+xml;base64,${image.toString('base64')}`,
  }
  const html = template.replace(/(?:\/\* )?\{\{(\w+)\}\}(?: \*\/)?/g, (_, key) => values[key])
  await writeFile(resolve(outputDirectory, `${status}.html`), html)
}
