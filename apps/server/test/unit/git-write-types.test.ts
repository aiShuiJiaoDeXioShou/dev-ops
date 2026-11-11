import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GitAdapter } from '../../src/adapters/git/git.types.ts'

test('T022 Git 适配器写端口可按需实现且保持只读实现兼容', () => {
  const readOnly: GitAdapter = {
    async checkConnection() {
      return { identity: 'read-only' }
    },
    async listRepositories() {
      return []
    },
    async getObject() {
      return { objectType: 'issue', remoteId: '1', title: 't', state: 'open', url: null }
    },
  }
  assert.equal(readOnly.createPullRequest, undefined)

  const writable: GitAdapter = {
    ...readOnly,
    async createPullRequest() {
      return { number: 1, url: null, sourceBranch: 'feature', targetBranch: 'main' }
    },
    async createIssue() {
      return { number: 1, url: null }
    },
    async addComment() {
      return { id: '1', url: null }
    },
  }
  assert.equal(typeof writable.createPullRequest, 'function')
})
