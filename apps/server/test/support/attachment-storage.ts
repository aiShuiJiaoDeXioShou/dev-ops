import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 临时本地桶目录句柄。 */
export interface AttachmentStorageFixture {
  rootDir: string
  cleanup: () => Promise<void>
}

/**
 * 为集成测试创建独立的本地桶目录。
 * @returns 根目录与清理函数；用例结束后必须调用 cleanup，避免测试间串数据。
 */
export async function createAttachmentStorageFixture(): Promise<AttachmentStorageFixture> {
  const rootDir = await mkdtemp(join(tmpdir(), 'dev-ops-attachments-'))
  return {
    rootDir,
    cleanup: () => rm(rootDir, { recursive: true, force: true }),
  }
}
