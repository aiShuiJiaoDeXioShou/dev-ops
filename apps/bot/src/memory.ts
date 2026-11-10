import { randomUUID } from 'node:crypto'
import { BotError } from './errors.ts'

export const MAX_MEMORIES = 200
export const MAX_MEMORY_LENGTH = 2000
export const ESSENTIAL_BUDGET_BYTES = 4096

export interface Memory {
  id: string
  content: string
  essential: boolean
  sourceSessionId: string | null
  createdAt: string
  updatedAt: string
}

/**
 * 规范化记忆以识别完全重复内容，不合并事实含义不同的条目。
 * @param content 用户或模型提供的正文。
 * @returns Unicode、大小写与空白规范化后的比较值。
 */
export function normalizeMemory(content: string): string {
  return content.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

/** 当前轮次的记忆工作副本，只有运行成功且版本一致时才提交数据库。 */
export class MemoryWorkspace {
  private readonly records: Map<string, Memory>

  /**
   * 从已经校验的记忆快照创建独立副本。
   * @param memories 当前 Bot 的记忆条目。
   * @returns 工作副本，不修改输入数组或数据库。
   */
  constructor(memories: Memory[]) {
    this.records = new Map(memories.map((memory) => [memory.id, { ...memory }]))
  }

  /**
   * 读取记忆副本，按更新时间和标识稳定排序。
   * @returns 可安全传给存储层的副本，最多包含规定数量的条目。
   */
  list(): Memory[] {
    return [...this.records.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .map((memory) => ({ ...memory }))
  }

  /**
   * 对小规模本地记忆做关键词包含检索。
   * @param query 搜索文字，空值读取最近条目。
   * @returns 最多十条匹配记录，不代表语义相似度搜索。
   */
  search(query = ''): Memory[] {
    const normalized = normalizeMemory(query)
    return this.list()
      .filter((memory) => normalizeMemory(memory.content).includes(normalized))
      .slice(0, 10)
  }

  /**
   * 新建或更新一条记忆，完全重复时复用已有条目。
   * @param content 稳定事实或偏好正文，不能包含凭据。
   * @param essential 是否每轮注入上下文。
   * @param sourceSessionId 来源会话，手工记忆为 null。
   * @param id 可选的待更新条目标识。
   * @returns 暂存条目；校验、数量或常驻预算不满足时抛出业务错误。
   */
  remember(content: string, essential: boolean, sourceSessionId: string | null, id?: string): Memory {
    const trimmed = content.trim()
    if (!trimmed || trimmed.length > MAX_MEMORY_LENGTH) {
      throw new BotError('MEMORY_INVALID', `记忆正文须为 1-${MAX_MEMORY_LENGTH} 个字符`)
    }
    if (/sk-[\w-]{16,}|-----BEGIN|\bBearer\s+\S+/iu.test(trimmed)) {
      throw new BotError('MEMORY_SECRET', '不能将密钥或访问凭据保存为长期记忆')
    }
    const previous = id ? this.records.get(id) : undefined
    if (id && !previous) throw new BotError('MEMORY_NOT_FOUND', '记忆不存在')
    const duplicate = this.list().find((memory) => normalizeMemory(memory.content) === normalizeMemory(trimmed))
    if (duplicate && duplicate.id !== id) {
      if (id) this.records.delete(id)
      return duplicate
    }
    if (!previous && this.records.size >= MAX_MEMORIES) throw new BotError('MEMORY_LIMIT', '长期记忆数量已达上限')
    const now = new Date().toISOString()
    const record: Memory = {
      id: previous?.id ?? randomUUID(),
      content: trimmed,
      essential,
      sourceSessionId,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    const essentials = this.list().filter((memory) => memory.essential && memory.id !== record.id)
    if (essential) essentials.push(record)
    if (Buffer.byteLength(JSON.stringify(essentials), 'utf8') > ESSENTIAL_BUDGET_BYTES) {
      throw new BotError('MEMORY_BUDGET', '常驻记忆已超出上下文预算，请改为按需检索或先整理记忆')
    }
    this.records.set(record.id, record)
    return { ...record }
  }

  /**
   * 从当前工作副本遗忘记忆。
   * @param id 条目标识。
   * @returns 删除后结束；条目不存在时抛出业务错误，不修改数据库。
   */
  forget(id: string): void {
    if (!this.records.delete(id)) throw new BotError('MEMORY_NOT_FOUND', '记忆不存在')
  }
}
