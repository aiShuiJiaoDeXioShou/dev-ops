import { randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { platformBotSkills } from '../bots/bots.platform-skills/index.ts'
import { appendActivity, listActivities } from '../collaboration/collaboration.service.ts'
import { isActiveTeamMember } from '../identity/identity.repository.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import {
  countEnabledSkills,
  findAssignableSkills,
  findSkillById,
  findSkillByIdentifier,
  findSkillDetail,
  findSkillVersionByContentVersion,
  findSkillVersionById,
  findSkillVersions,
  findSkillVersionsByIds,
  findSkills,
  findSkillsByIds,
  insertSkill,
  insertSkillVersion,
  lockSkill,
  setSkillEnabled,
  updateSkill as updateSkillRow,
} from './knowledge.repository.ts'
import {
  escapeLikeTerm,
  requiredText,
  validateSkillCategory,
  validateSkillContent,
  validateSkillContentVersion,
  validateSkillFiles,
  validateSkillIdentifier,
} from './knowledge.rules.ts'
import type {
  AssignableSkillRef,
  MissingSkillRef,
  ResolveSkillsForRunResult,
  ResolvedSkillRef,
} from './knowledge.types.ts'
import { toSkillDetail, toSkillListItem, toSkillVersionDetail, toSkillVersionItem } from './knowledge.view.ts'

/** knowledge 模块可替换依赖；测试与生产都通过参数注入数据库连接。 */
export interface KnowledgeServiceDeps {
  db: Database
}

/**
 * 读取技能并校验当前用户为团队成员；跨团队按不可见处理。
 * @param actor 当前会话用户。
 * @param skillId 技能标识。
 * @returns 技能行。
 * @throws 技能不存在或不属于可访问团队时抛出 NOT_FOUND。
 */
async function requireSkillRead(db: Database, actor: SessionUser, skillId: string) {
  const row = await findSkillById(db, skillId)
  if (!row || !(await isActiveTeamMember(db, row.teamId, actor.id))) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, '技能不存在')
  }
  return row
}

/** 校验当前用户为团队管理员或开发者。 */
async function requireWriteRole(db: Database, actor: SessionUser, teamId: string) {
  await requireTeamMember(db, actor.id, teamId, ['admin', 'developer'])
}

/**
 * 创建 knowledge 服务。
 * @param deps 数据库连接。
 * @returns 技能管理与运行时解析用例。
 */
export function createKnowledgeService(deps: KnowledgeServiceDeps) {
  const { db } = deps

  /**
   * 读取团队技能分页。
   * @param actor 当前用户。
   * @param teamId 团队标识。
   * @param query 关键词、分类、来源、启停状态与分页参数。
   * @returns 技能分页视图。
   */
  async function listSkills(
    actor: SessionUser,
    teamId: string,
    query: {
      search?: string
      category?: string
      source?: 'team' | 'platform'
      enabled?: boolean
      page?: number
      pageSize?: number
    },
  ) {
    await requireTeamMember(db, actor.id, teamId)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    validatePage(page, pageSize)
    const category = query.category === undefined ? undefined : validateSkillCategory(query.category)
    const search = query.search?.trim()
    const term = search?.toLowerCase()
    const includePlatform = query.source !== 'team' && query.enabled !== false
    const builtins = includePlatform
      ? platformBotSkills.filter(
          (item) =>
            (!category || item.category === category) &&
            (!term || [item.name, item.identifier, item.summary].some((value) => value.toLowerCase().includes(term))),
        )
      : []
    const offset = (page - 1) * pageSize
    const listed = builtins.slice(offset, offset + pageSize).map((item) => ({
      ...item,
      source: 'platform' as const,
      fileCount: 0,
      enabled: true,
      version: 1,
      contentVersion: '1.0.0',
      updatedAt: new Date(0).toISOString(),
    }))
    const result =
      query.source === 'platform'
        ? { items: [], total: 0 }
        : await findSkills(db, teamId, {
            search: search ? escapeLikeTerm(search) : undefined,
            category,
            enabled: query.enabled,
            offset: Math.max(0, offset - builtins.length),
            limit: pageSize - listed.length,
          })
    const configured = result.items.map((row) => ({
      ...toSkillListItem(row),
      conflictsWithPlatform: platformBotSkills.some(({ identifier }) => identifier === row.identifier),
    }))
    return { items: [...listed, ...configured], page, pageSize, total: builtins.length + result.total }
  }

  /**
   * 读取技能详情。
   * @param actor 当前用户。
   * @param skillId 技能标识。
   * @returns 技能详情视图。
   */
  async function getSkill(actor: SessionUser, skillId: string) {
    await requireSkillRead(db, actor, skillId)
    const detail = await findSkillDetail(db, skillId)
    if (!detail) throw new Error('数据库技能当前版本缺失')
    return toSkillDetail(detail)
  }

  /**
   * 发布团队技能。
   * @param actor 当前用户，必须为团队管理员或开发者。
   * @param teamId 团队标识。
   * @param input 技能字段与首个内容版本。
   * @returns 新建技能详情。
   */
  async function createSkill(
    actor: SessionUser,
    teamId: string,
    input: {
      name: string
      identifier: string
      category: string
      contentVersion: string
      summary: string
      content: string
      files?: { path: string; content: string; encoding: string }[]
    },
  ) {
    await requireWriteRole(db, actor, teamId)
    const name = requiredText(input.name, '名称', 30)
    const identifier = validateSkillIdentifier(input.identifier)
    const category = validateSkillCategory(input.category)
    const contentVersion = validateSkillContentVersion(input.contentVersion)
    const summary = requiredText(input.summary, '简述', 100)
    const content = validateSkillContent(input.content)
    const files = validateSkillFiles(input.files ?? [])
    if (await findSkillByIdentifier(db, teamId, identifier)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '调用标识已存在，请换一个')
    }
    const skillId = randomUUID()
    const versionId = randomUUID()
    await db.transaction(async (tx) => {
      await insertSkillVersion(tx, {
        id: versionId,
        teamId,
        skillId,
        contentVersion,
        content,
        files,
        createdByUserId: actor.id,
      })
      await insertSkill(tx, {
        id: skillId,
        teamId,
        name,
        identifier,
        category,
        summary,
        currentVersionId: versionId,
        createdByUserId: actor.id,
      })
      await appendActivity(tx, {
        teamId,
        entityType: 'skill',
        entityId: skillId,
        action: 'skill_created',
        actorUserId: actor.id,
        changes: { contentVersion },
      })
    })
    return getSkill(actor, skillId)
  }

  /**
   * 编辑技能；内容变化必须使用新内容版本，历史版本保留。
   * @param actor 当前用户，必须为团队管理员或开发者。
   * @param skillId 技能标识。
   * @param input 乐观锁版本与完整字段。
   * @returns 更新后的技能详情。
   */
  async function updateSkill(
    actor: SessionUser,
    skillId: string,
    input: {
      version: number
      name: string
      category: string
      contentVersion: string
      summary: string
      content: string
      files?: { path: string; content: string; encoding: string }[]
    },
  ) {
    const current = await requireSkillRead(db, actor, skillId)
    await requireWriteRole(db, actor, current.teamId)
    const name = requiredText(input.name, '名称', 30)
    const category = validateSkillCategory(input.category)
    const contentVersion = validateSkillContentVersion(input.contentVersion)
    const summary = requiredText(input.summary, '简述', 100)
    const content = validateSkillContent(input.content)
    const files = validateSkillFiles(input.files ?? [])
    await db.transaction(async (tx) => {
      const locked = await lockSkill(tx, skillId)
      if (!locked) throw new ApiError(ERROR_CODES.NOT_FOUND, '技能不存在')
      if (locked.version !== input.version) {
        throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '技能已被其他人更新，请刷新后重试')
      }
      const currentVersion = await findSkillVersionById(tx, locked.currentVersionId)
      if (!currentVersion) throw new Error('数据库技能当前版本缺失')
      const contentChanged = content !== currentVersion.content
      const filesChanged = JSON.stringify(files) !== JSON.stringify(currentVersion.files)
      let nextVersionId = locked.currentVersionId
      if ((contentChanged || filesChanged) && contentVersion === currentVersion.contentVersion) {
        throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '指令或资源文件变化时必须使用新的版本号')
      }
      if (contentVersion !== currentVersion.contentVersion) {
        if (await findSkillVersionByContentVersion(tx, skillId, contentVersion)) {
          throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '该内容版本已存在，请换一个版本号')
        }
        nextVersionId = randomUUID()
        await insertSkillVersion(tx, {
          id: nextVersionId,
          teamId: locked.teamId,
          skillId,
          contentVersion,
          content,
          files,
          createdByUserId: actor.id,
        })
      }
      const updated = await updateSkillRow(tx, skillId, input.version, {
        name,
        category,
        summary,
        currentVersionId: nextVersionId,
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '技能已被其他人更新，请刷新后重试')
      await appendActivity(tx, {
        teamId: locked.teamId,
        entityType: 'skill',
        entityId: skillId,
        action: 'skill_updated',
        actorUserId: actor.id,
        changes: {
          contentVersion,
          previousContentVersion: currentVersion.contentVersion,
          fileCount: files.length,
        },
      })
    })
    return getSkill(actor, skillId)
  }

  /**
   * 启用或停用技能；重复状态按幂等成功返回。
   * @param actor 当前用户。
   * @param skillId 技能标识。
   * @param version 乐观锁版本。
   * @param enabled 目标状态。
   * @returns 更新后的技能详情。
   */
  async function setSkillState(actor: SessionUser, skillId: string, version: number, enabled: boolean) {
    const current = await requireSkillRead(db, actor, skillId)
    await requireWriteRole(db, actor, current.teamId)
    await db.transaction(async (tx) => {
      const locked = await lockSkill(tx, skillId)
      if (!locked) throw new ApiError(ERROR_CODES.NOT_FOUND, '技能不存在')
      if (locked.version !== version) {
        throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '技能已被其他人更新，请刷新后重试')
      }
      if (locked.enabled === enabled) return
      const updated = await setSkillEnabled(tx, skillId, version, enabled)
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '技能已被其他人更新，请刷新后重试')
      await appendActivity(tx, {
        teamId: locked.teamId,
        entityType: 'skill',
        entityId: skillId,
        action: enabled ? 'skill_enabled' : 'skill_disabled',
        actorUserId: actor.id,
      })
    })
    return getSkill(actor, skillId)
  }

  /**
   * 读取技能版本历史。
   * @param actor 当前用户。
   * @param skillId 技能标识。
   * @param page 页码。
   * @param pageSize 每页数量。
   * @returns 版本分页视图。
   */
  async function listSkillVersions(actor: SessionUser, skillId: string, page: number, pageSize: number) {
    await requireSkillRead(db, actor, skillId)
    validatePage(page, pageSize)
    const result = await findSkillVersions(db, skillId, page, pageSize)
    return { items: result.items.map(toSkillVersionItem), page, pageSize, total: result.total }
  }

  /**
   * 读取技能历史版本正文。
   * @param actor 当前用户。
   * @param skillId 技能标识。
   * @param versionId 版本标识。
   * @returns 历史版本详情。
   */
  async function getSkillVersion(actor: SessionUser, skillId: string, versionId: string) {
    await requireSkillRead(db, actor, skillId)
    const version = await findSkillVersionById(db, versionId)
    if (!version || version.skillId !== skillId) throw new ApiError(ERROR_CODES.NOT_FOUND, '技能版本不存在')
    return toSkillVersionDetail(version)
  }

  /** 读取技能活动分页。 */
  async function listSkillActivities(actor: SessionUser, skillId: string, page: number, pageSize: number) {
    await requireSkillRead(db, actor, skillId)
    return listActivities(db, 'skill', skillId, page, pageSize)
  }

  /**
   * 阶段 B：解析一次运行可用的技能引用与缺失原因。
   * @param input 团队标识与 Bot 配置的技能标识集合。
   * @returns 可用引用与缺失项；不抛可预期业务错误。
   */
  async function resolveSkillsForRun(input: {
    teamId: string
    skillIds: string[]
  }): Promise<ResolveSkillsForRunResult> {
    const uniqueSkillIds = [...new Set(input.skillIds)]
    if (uniqueSkillIds.length === 0) return { skills: [], missing: [] }
    const rows = await findSkillsByIds(db, uniqueSkillIds)
    const rowById = new Map(rows.map((row) => [row.id, row]))
    const versionIds = rows.map((row) => row.currentVersionId)
    const versions = await findSkillVersionsByIds(db, versionIds)
    const versionById = new Map(versions.map((version) => [version.id, version]))
    const skills: ResolvedSkillRef[] = []
    const missing: MissingSkillRef[] = []
    for (const skillId of uniqueSkillIds) {
      const row = rowById.get(skillId)
      if (!row) {
        missing.push({ skillId, reason: 'not_found' })
        continue
      }
      if (row.teamId !== input.teamId) {
        missing.push({ skillId, reason: 'other_team' })
        continue
      }
      if (!row.enabled) {
        missing.push({ skillId, reason: 'disabled' })
        continue
      }
      const version = versionById.get(row.currentVersionId)
      if (!version) {
        missing.push({ skillId, reason: 'no_version' })
        continue
      }
      skills.push({
        skillId: row.id,
        name: row.name,
        identifier: row.identifier,
        contentVersion: version.contentVersion,
        skillVersionId: version.id,
      })
    }
    return { skills, missing }
  }

  /**
   * 阶段 B：读取可配置给 Bot 的已启用技能候选。
   * @param teamId 团队标识。
   * @returns 技能候选；一次返回团队百级规模数据。
   */
  async function listAssignableSkillsForBotConfig(teamId: string): Promise<AssignableSkillRef[]> {
    const rows = await findAssignableSkills(db, teamId)
    return rows.map((row) => ({
      skillId: row.skillId,
      name: row.name,
      identifier: row.identifier,
      category: validateSkillCategory(row.category),
      contentVersion: row.contentVersion,
    }))
  }

  return {
    listSkills,
    getSkill,
    createSkill,
    updateSkill,
    enableSkill: (actor: SessionUser, skillId: string, version: number) => setSkillState(actor, skillId, version, true),
    disableSkill: (actor: SessionUser, skillId: string, version: number) =>
      setSkillState(actor, skillId, version, false),
    listSkillVersions,
    getSkillVersion,
    listSkillActivities,
    resolveSkillsForRun,
    listAssignableSkillsForBotConfig,
    countEnabledSkills: (teamId: string) => countEnabledSkills(db, teamId),
  }
}

/** knowledge 服务类型，供 bootstrap 与调用方推导。 */
export type KnowledgeService = ReturnType<typeof createKnowledgeService>
