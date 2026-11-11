import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createAgentLogger } from '../src/logger.ts'
import { createSecretMasker } from '../src/masking.ts'
import { createRunWorkspace } from '../src/workspace.ts'
import { createTestGitRepo } from './helpers/git-repo.ts'

const execFileAsync = promisify(execFile)

test('T039 Agent 代码修改：应用补丁、提交、收集差异并推送工作分支', async (t) => {
  const repo = await createTestGitRepo()
  const workDir = await mkdtemp(join(tmpdir(), 'devops-agent-code-change-'))
  t.after(async () => {
    await rm(workDir, { recursive: true, force: true })
    await repo.cleanup()
  })
  const masker = createSecretMasker()
  const workspace = await createRunWorkspace({
    workDir,
    runId: 'code-change-test',
    logger: createAgentLogger({ masker, write: () => undefined }),
    masker,
  })
  const git = {
    remoteUrl: repo.remoteUrl,
    username: 'x-access-token',
    password: 'test-password',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    commitSha: repo.commitSha,
  }
  await workspace.ensureCheckout(git)

  const patch = '--- a/app.txt\n+++ b/app.txt\n@@ -1 +1 @@\n-first-commit-content\n+patched-content\n'
  const patchSha256 = createHash('sha256').update(patch, 'utf8').digest('hex')
  await workspace.applyPatch(patch, patchSha256, 1_048_576)
  await workspace.commitChanges({
    message: '受控代码修改',
    authorName: '开发者',
    authorEmail: 'dev@example.test',
  })
  const diff = await workspace.collectDiff(repo.commitSha)
  assert.match(diff.patch, /patched-content/)
  assert.equal(diff.sha256, createHash('sha256').update(diff.patch, 'utf8').digest('hex'))

  await workspace.pushBranch(git, 'feature/agent-demo')
  const { stdout } = await execFileAsync('git', ['rev-parse', 'refs/heads/feature/agent-demo'], { cwd: repo.dir })
  assert.ok(stdout.trim().length >= 7)
  // 相同内容再次推送应按幂等返回，不报冲突。
  await workspace.pushBranch(git, 'feature/agent-demo')
})
