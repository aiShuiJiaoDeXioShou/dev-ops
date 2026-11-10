/** @type {import('dependency-cruiser').IConfiguration} */
const configuration = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolved', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'apps-communicate-through-api',
      severity: 'error',
      from: { path: '^apps/([^/]+)/src/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'packages-independent-of-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'web-shared-is-foundation',
      severity: 'error',
      from: { path: '^apps/web/src/shared/' },
      to: { path: '^apps/web/src/(app|pages|features)/' },
    },
    {
      name: 'web-features-independent-of-pages',
      severity: 'error',
      from: { path: '^apps/web/src/features/' },
      to: { path: '^apps/web/src/(app|pages)/' },
    },
    {
      name: 'web-pages-independent-of-app',
      severity: 'error',
      from: { path: '^apps/web/src/pages/' },
      to: { path: '^apps/web/src/app/' },
    },
    {
      name: 'web-feature-public-entry',
      severity: 'error',
      from: { path: '^apps/web/src/(?!features/|test/)' },
      to: { path: '^apps/web/src/features/[^/]+/', pathNot: '/public\\.ts$' },
    },
    {
      name: 'web-cross-feature-public-entry',
      severity: 'error',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: { path: '^apps/web/src/features/', pathNot: ['^apps/web/src/features/$1/', '/public\\.ts$'] },
    },
    {
      name: 'server-composition-owns-wiring',
      severity: 'error',
      from: { path: '^apps/server/src/(?!bootstrap/|modules/)' },
      to: { path: '^apps/server/src/modules/' },
    },
    {
      name: 'server-modules-independent-of-wiring',
      severity: 'error',
      from: { path: '^apps/server/src/modules/' },
      to: { path: '^apps/server/src/(bootstrap|entrypoints|workflows|adapters)/' },
    },
    {
      name: 'server-platform-is-foundation',
      severity: 'error',
      from: { path: '^apps/server/src/platform/' },
      to: { path: '^apps/server/src/(bootstrap|entrypoints|workflows|adapters|modules)/' },
    },
    {
      name: 'server-does-not-consume-client',
      severity: 'error',
      from: { path: '^apps/server/src/' },
      to: { path: '^(packages/api-client/|@dev-ops/api-client)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules|/generated/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'apps/web/tsconfig.app.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
      conditionNames: ['import', 'node', 'default'],
    },
  },
}

export default configuration
