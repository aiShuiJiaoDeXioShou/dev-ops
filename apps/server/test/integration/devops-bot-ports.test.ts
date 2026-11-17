import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { testCredentialStore, testMemoryStore, testRunSink } from '@dev-ops/devops-bot/testing'
import type { RunEvent } from '@dev-ops/devops-bot'
import { and, eq, isNotNull } from 'drizzle-orm'
import { Type } from 'typebox'
import { Check } from 'typebox/value'
import { claimBotRun, enqueueBotRun } from '../../src/modules/bots/bots.run-queue.repository.ts'
import { botModelConnection } from '../../src/modules/bots/bots.tables.ts'
import { createPgCredentialStore } from '../../src/modules/bots/runtime/credential-store.ts'
import { createPgMemoryStore } from '../../src/modules/bots/runtime/memory-store.ts'
import { createPgRunSink } from '../../src/modules/bots/runtime/run-sink.ts'
import { botEvent } from '../../src/modules/collaboration/bot-conversations.tables.ts'
import { createSecretCipher } from '../../src/modules/configuration/configuration.crypto.ts'
import { createBotTestDatabase } from '../support/bot-database.ts'

test('PostgreSQL Bot 端口通过共享接口一致性检查', async (t) => {
  const { db } = await createBotTestDatabase(t)
  await testCredentialStore(t, async () => {
    const teamId = randomUUID()
    const providerId = 'fixture'
    const cipher = createSecretCipher(Buffer.alloc(32, 31).toString('base64'))
    const [connection] = await db
      .insert(botModelConnection)
      .values({
        team_id: teamId,
        name: '测试订阅',
        provider_id: providerId,
        auth_type: 'oauth',
        login_user_id: randomUUID(),
        status: 'active',
      })
      .returning({ id: botModelConnection.id })
    assert.ok(connection)
    return { providerId, store: createPgCredentialStore({ db, cipher, teamId, connectionId: connection.id }) }
  })

  await testRunSink(t, async () => {
    const run = await db.transaction((tx) =>
      enqueueBotRun(tx, {
        team_id: randomUUID(),
        conversation_id: randomUUID(),
        bot_id: randomUUID(),
        trigger_user_id: randomUUID(),
        input_version: 0,
      }),
    )
    const claimed = await claimBotRun(db, 'sink-fixture', { global: 1, perTeam: 1, ttlSeconds: 30 })
    assert.ok(claimed?.lease_owner)
    assert.equal(claimed.id, run.id)
    const sink = createPgRunSink(
      db,
      claimed,
      {
        id: claimed.id,
        epoch: claimed.lease_epoch,
        owner: claimed.lease_owner,
      },
      () => assert.fail('夹具刷新失败'),
    )
    const payloadSchema = Type.Object({ text: Type.String() })
    return {
      sink,
      async readEvents(): Promise<RunEvent[]> {
        const rows = await db
          .select({ seq: botEvent.run_sequence, payload: botEvent.payload })
          .from(botEvent)
          .where(and(eq(botEvent.run_id, run.id), eq(botEvent.kind, 'output_delta'), isNotNull(botEvent.run_sequence)))
          .orderBy(botEvent.sequence)
        return rows.map(({ seq, payload }) => {
          assert.ok(seq && Check(payloadSchema, payload))
          return { seq, type: 'output_delta', payload }
        })
      },
    }
  })
})

test('PostgreSQL 记忆端口通过共享接口一致性检查', async (t) => {
  const { db } = await createBotTestDatabase(t)
  const botId = randomUUID()
  const teamId = randomUUID()
  await testMemoryStore(t, async () => {
    async function makeStore() {
      const queued = await db.transaction((tx) =>
        enqueueBotRun(tx, {
          team_id: teamId,
          bot_id: botId,
          conversation_id: randomUUID(),
          trigger_user_id: randomUUID(),
          input_version: 0,
        }),
      )
      const run = await claimBotRun(db, 'memory-contract', { global: 4, perTeam: 4, ttlSeconds: 30 })
      assert.ok(run)
      assert.equal(run.id, queued.id)
      return createPgMemoryStore(db, run, { id: run.id, owner: 'memory-contract', epoch: run.lease_epoch })
    }
    return { store: await makeStore(), otherScope: await makeStore() }
  })
})
