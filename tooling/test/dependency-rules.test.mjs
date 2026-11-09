import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const executable = fileURLToPath(new URL('../../node_modules/.bin/depcruise', import.meta.url))
const configuration = fileURLToPath(new URL('../dependency-rules.mjs', import.meta.url))

test('真实依赖扫描允许公开接口并拒绝越界导入和循环依赖', async () => {
  const cases = [
    [
      '公开接口',
      null,
      {
        'apps/web/src/pages/detail.ts': "import { value } from '@/features/project/public'; export { value }",
        'apps/web/src/features/project/public.ts': 'export const value = 1',
        'apps/server/src/modules/requirement/service.ts': "export { value } from '../project/public.js'",
        'apps/server/src/modules/project/public.ts': 'export const value = 1',
      },
    ],
    [
      '功能引用页面',
      'web-features-independent-of-pages',
      {
        'apps/web/src/features/project/public.ts': "export { value } from '@/pages/detail'",
        'apps/web/src/pages/detail.ts': 'export const value = 1',
      },
    ],
    [
      '页面动态导入内部实现',
      'web-feature-public-entry',
      {
        'apps/web/src/pages/detail.ts': "export const load = () => import('@/features/project/internal')",
        'apps/web/src/features/project/internal.ts': 'export const value = 1',
      },
    ],
    [
      '跨模块读取仓储',
      'server-module-public-entry',
      {
        'apps/server/src/modules/requirement/service.ts': "export { value } from '../project/repository.js'",
        'apps/server/src/modules/project/repository.ts': 'export const value = 1',
      },
    ],
    [
      '基础设施依赖业务',
      'server-platform-is-foundation',
      {
        'apps/server/src/platform/database/client.ts': "export { value } from '../../modules/project/public.js'",
        'apps/server/src/modules/project/public.ts': 'export const value = 1',
      },
    ],
    [
      '共享包依赖应用',
      'packages-independent-of-apps',
      {
        'packages/api-client/src/index.ts':
          "export { value } from '../../../apps/server/src/modules/project/public.js'",
        'apps/server/src/modules/project/public.ts': 'export const value = 1',
      },
    ],
    [
      '循环依赖',
      'no-circular',
      {
        'apps/web/src/shared/first.ts': "export { second } from './second'; export const first = 1",
        'apps/web/src/shared/second.ts': "export { first } from './first'; export const second = 1",
      },
    ],
  ]
  for (const [label, expected, files] of cases) {
    const cwd = await mkdtemp(join(tmpdir(), 'dev-ops-boundaries-'))
    try {
      const fixture = {
        'apps/web/tsconfig.app.json': JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
        'apps/web/src/shared/fixture.ts': 'export const fixture = 1',
        'packages/placeholder.ts': 'export const value = 1',
        ...files,
      }
      for (const [path, source] of Object.entries(fixture)) {
        const destination = join(cwd, path)
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, source)
      }
      const result = spawnSync(executable, ['--config', configuration, '--output-type', 'json', 'apps', 'packages'], {
        cwd,
        encoding: 'utf8',
        timeout: 15_000,
      })
      assert.ifError(result.error)
      assert.ok(result.stdout.trim(), `${label}: ${result.stderr}`)
      const report = JSON.parse(result.stdout)
      const rules = report.summary.violations.map((violation) => violation.rule.name)
      if (expected) {
        assert.notEqual(report.summary.advisedExitCode, 0, label)
        assert.ok(rules.includes(expected), `${label}: ${rules.join(', ')}`)
        const gate = spawnSync(executable, ['--config', configuration, 'apps', 'packages'], {
          cwd,
          encoding: 'utf8',
          timeout: 15_000,
        })
        assert.ifError(gate.error)
        assert.notEqual(gate.status, 0, `${label} 未阻止检查通过`)
      } else {
        assert.equal(result.status, 0, `${label}: ${result.stdout}\n${result.stderr}`)
      }
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  }
})
