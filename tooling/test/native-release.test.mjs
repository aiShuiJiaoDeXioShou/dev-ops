import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const script = fileURLToPath(new URL('../../.devops/scripts/release-main.sh', import.meta.url))

test('原生发布在构建失败时清理临时目录，在登录页异常时回滚，并始终保留共享邮件配置', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'devops-native-release-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'repo')
  const deployRoot = join(directory, 'deployment')
  const executables = join(directory, 'bin')
  const previous = join(deployRoot, 'releases', 'previous')
  const current = join(deployRoot, 'current')
  const shared = join(deployRoot, 'shared')
  await Promise.all(
    [join(source, 'apps/server/dist/entrypoints'), executables, previous, shared].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  )
  const appEnv = 'APP_ORIGIN=http://127.0.0.1:8080\nMAIL_FROM=noreply@example.com\n'
  await writeFile(join(shared, 'app.env'), appEnv)
  await writeFile(join(shared, 'migration.env'), 'NODE_ENV=test\n')
  await writeFile(join(source, 'apps/server/dist/entrypoints/migrate.js'), "console.log('迁移已完成')\n")
  await symlink(previous, current)

  function git(...args) {
    return execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }
  git('init', '-b', 'main')
  git('add', '.')
  git('-c', 'user.name=DevOps', '-c', 'user.email=test@example.com', 'commit', '-m', '测试发布')
  const commit = git('rev-parse', 'HEAD')
  const remoteUrl = pathToFileURL(source).href
  git('remote', 'add', 'origin', remoteUrl)

  function stub(name, commands) {
    return writeFile(join(executables, name), `#!/bin/bash\nset -eu\n${commands}\n`, { mode: 0o700 })
  }
  await Promise.all([
    stub('corepack', '[[ "$2" != build || "$RELEASE_MODE" != fail-build ]]'),
    stub(
      'launchctl',
      `if [[ "$1" == print ]]; then
  [[ "$2" == */"$RELEASE_SERVICE_PREFIX".http ]] || exit 1
  printf '%s\\n' "$DEVOPS_DEPLOY_ROOT/shared/app.env" "$DEVOPS_DEPLOY_ROOT/current/apps/server/dist/entrypoints/http.js"
else
  [[ "$1" == kickstart && "$2" == -k && "$3" == */"$RELEASE_SERVICE_PREFIX".* ]]
  printf '%s\\n' "$3" >> "$RESTART_LOG"
fi`,
    ),
    stub(
      'curl',
      `case "\${!#}" in
  "$RELEASE_ORIGIN/api/v1/ready") printf '%s' '{"success":true}' ;;
  "$RELEASE_ORIGIN/login")
    if [[ "$RELEASE_MODE" == fail-login && "$(readlink "$DEVOPS_DEPLOY_ROOT/current")" != "$PREVIOUS_RELEASE" ]]; then
      printf '%s' '页面加载失败'
    else
      printf '%s' '<div id="root"></div>'
    fi ;;
  *) exit 2 ;;
esac`,
    ),
  ])
  if (process.platform !== 'darwin') {
    // GNU mv 使用 -T 来替换目标软链接，发布脚本在 macOS 使用 BSD mv 的 -h。
    await stub('mv', 'if [[ "$1" == -fh ]]; then shift; set -- -fT "$@"; fi\nexec /bin/mv "$@"')
  }

  const restartLog = join(directory, 'restart.log')
  const testEnv = { ...process.env }
  delete testEnv.APP_ORIGIN
  delete testEnv.DEVOPS_DEPLOY_GIT_TOKEN
  function publish(mode, { servicePrefix = 'com.devops', origin = 'http://127.0.0.1:8080' } = {}) {
    const result = spawnSync('/bin/bash', [script, commit], {
      cwd: source,
      encoding: 'utf8',
      timeout: 15_000,
      env: {
        ...testEnv,
        PATH: [executables, dirname(process.execPath), process.env.PATH].join(delimiter),
        DEVOPS_DEPLOY_ROOT: deployRoot,
        DEVOPS_DEPLOY_REPOSITORY: remoteUrl,
        PREVIOUS_RELEASE: previous,
        RELEASE_MODE: mode,
        RELEASE_ORIGIN: origin,
        RELEASE_SERVICE_PREFIX: servicePrefix,
        RESTART_LOG: restartLog,
      },
    })
    assert.ifError(result.error)
    return result
  }

  assert.equal(publish('fail-build').status, 1)
  assert.deepEqual(await readdir(join(deployRoot, 'releases')), ['previous'])
  assert.equal(await readlink(current), previous)

  const rollback = publish('fail-login')
  assert.equal(rollback.status, 1, rollback.stderr)
  assert.match(rollback.stderr, /恢复上一版本/)
  assert.equal(await readlink(current), previous)

  const success = publish('success')
  assert.equal(success.status, 0, success.stderr)
  assert.match(success.stdout, /迁移已完成\n已发布 /)
  assert.equal(await readlink(current), join(deployRoot, 'releases', commit))

  const repeated = publish('success', {
    servicePrefix: 'com.apple-macmini.devops',
    origin: 'http://127.0.0.1:18080',
  })
  assert.equal(repeated.status, 0, repeated.stderr)
  assert.match(repeated.stdout, /当前已运行 /)
  assert.equal(await readFile(join(shared, 'app.env'), 'utf8'), appEnv)
  assert.deepEqual((await readdir(shared)).sort(), ['app.env', 'migration.env'])
  assert.equal((await readFile(restartLog, 'utf8')).trim().split('\n').length, 9)
})
