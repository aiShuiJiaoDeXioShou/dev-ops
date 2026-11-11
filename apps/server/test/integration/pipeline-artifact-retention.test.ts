import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import { pipelineArtifact } from '../../src/modules/pipeline/pipeline.tables.ts'
import { createPipelineStorage } from '../../src/modules/pipeline/pipeline.storage.ts'
import { cleanupExpiredPipelineArtifacts } from '../../src/modules/pipeline/pipeline.retention.ts'
import { setupPipelineContext } from '../helpers/operations.ts'

test('T093 产物保留期清理：删除文件并标记 missing', { timeout: 60_000 }, async (t) => {
  const context = await setupPipelineContext(t)
  const storage = createPipelineStorage({
    rootDir: context.storageDir,
    maxLogChunkBytes: 1024,
    maxArtifactBytes: 1024 * 1024,
  })
  const runId = randomUUID()
  const artifactId = randomUUID()
  const storageKey = `runs/${runId}/old.txt`
  await mkdir(join(context.storageDir, 'runs', runId), { recursive: true })
  await writeFile(join(context.storageDir, storageKey), 'old artifact')
  await context.app.db.insert(pipelineArtifact).values({
    id: artifactId,
    team_id: context.teamId,
    project_id: context.projectId,
    run_id: runId,
    step_index: 0,
    name: 'old-artifact',
    storage_key: storageKey,
    size_bytes: 11,
    sha256: 'a'.repeat(64),
    status: 'available',
    created_at: new Date(Date.now() - 40 * 86_400_000),
  })

  const result = await cleanupExpiredPipelineArtifacts({
    db: context.app.db,
    storage,
    retentionDays: 30,
    log: () => undefined,
  })
  assert.deepEqual(result, { removed: 1, failed: 0 })
  const [row] = await context.app.db.select().from(pipelineArtifact).where(eq(pipelineArtifact.id, artifactId))
  assert.equal(row?.status, 'missing')
  await assert.rejects(() => stat(join(context.storageDir, storageKey)))
  // 已标记缺失的产物不会在下一轮重复清理。
  assert.deepEqual(
    await cleanupExpiredPipelineArtifacts({ db: context.app.db, storage, retentionDays: 30, log: () => undefined }),
    { removed: 0, failed: 0 },
  )
})
