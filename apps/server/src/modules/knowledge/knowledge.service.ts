import { randomBytes, randomUUID } from 'node:crypto'
import type { Database } from '../../platform/database/client.ts'
import { ERROR_CODES } from '../../platform/http/error-codes.ts'
import { ApiError } from '../../platform/http/errors.ts'
import { validatePage } from '../../platform/http/pagination.ts'
import { appendActivity, listActivities } from '../collaboration/collaboration.service.ts'
import { isActiveTeamMember } from '../identity/identity.repository.ts'
import { requireTeamMember, type SessionUser } from '../identity/identity.session.ts'
import { getProjectContext } from '../projects/projects.access.ts'
import {
  countEnabledSkills,
  deleteProjectTemplateSelection,
  findAssignableSkills,
  findProjectTemplateForRun,
  findProjectTemplateSelection,
  findSelectionDetail,
  findSkillById,
  findSkillByIdentifier,
  findSkillDetail,
  findSkillVersionByContentVersion,
  findSkillVersionById,
  findSkillVersions,
  findSkillVersionsByIds,
  findSkills,
  findSkillsByIds,
  findTemplateById,
  findTemplateByNormalizedName,
  findTemplateDetail,
  findTemplateSnapshotLinkByToken,
  findTemplateVersionById,
  findTemplateVersions,
  countTemplateSelections,
  findTemplates,
  insertProjectTemplateSelection,
  insertSkill,
  insertSkillVersion,
  insertTemplate,
  insertTemplateSnapshotLink,
  insertTemplateVersion,
  lockProjectTemplateSelection,
  lockSkill,
  lockTemplate,
  setSkillEnabled,
  updateProjectTemplateSelection,
  updateSkill as updateSkillRow,
  updateTemplate as updateTemplateRow,
} from './knowledge.repository.ts'
import {
  escapeLikeTerm,
  optionalText,
  requiredText,
  templateNameKey,
  validateSkillCategory,
  validateSkillContent,
  validateSkillContentVersion,
  validateSkillFiles,
  validateSkillIdentifier,
  validateTemplateContent,
} from './knowledge.rules.ts'
import type {
  AssignableSkillRef,
  MissingSkillRef,
  ResolveProjectTemplateForRunResult,
  ResolveSkillsForRunResult,
  ResolvedSkillRef,
} from './knowledge.types.ts'
import {
  toProjectTemplateSelection,
  toSkillDetail,
  toSkillListItem,
  toSkillVersionDetail,
  toSkillVersionItem,
  toSnapshotLinkCreated,
  toTemplateDetail,
  toTemplateListItem,
  toTemplateSnapshot,
  toTemplateVersionDetail,
  toTemplateVersionItem,
} from './knowledge.view.ts'

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

/** 读取模板并校验当前用户为团队成员；跨团队按不可见处理。 */
async function requireTemplateRead(db: Database, actor: SessionUser, templateId: string) {
  const row = await findTemplateById(db, templateId)
  if (!row || !(await isActiveTeamMember(db, row.teamId, actor.id))) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, '模板不存在')
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
 * @returns 技能、模板、项目选用、快照与阶段 B 解析用例。
 */
export function createKnowledgeService(deps: KnowledgeServiceDeps) {
  const { db } = deps

  /**
   * 读取团队技能分页。
   * @param actor 当前用户。
   * @param teamId 团队标识。
   * @param query 关键词、分类与分页参数。
   * @returns 技能分页视图。
   */
  async function listSkills(
    actor: SessionUser,
    teamId: string,
    query: { search?: string; category?: string; page?: number; pageSize?: number },
  ) {
    await requireTeamMember(db, actor.id, teamId)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    validatePage(page, pageSize)
    const category = query.category === undefined ? undefined : validateSkillCategory(query.category)
    const search = query.search?.trim()
    const result = await findSkills(db, teamId, {
      search: search ? escapeLikeTerm(search) : undefined,
      category,
      page,
      pageSize,
    })
    return { items: result.items.map(toSkillListItem), page, pageSize, total: result.total }
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

  /** 读取团队模板分页。 */
  async function listTemplates(
    actor: SessionUser,
    teamId: string,
    query: { search?: string; tag?: string; page?: number; pageSize?: number },
  ) {
    await requireTeamMember(db, actor.id, teamId)
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    validatePage(page, pageSize)
    const search = query.search?.trim()
    const tag = query.tag?.trim()
    const result = await findTemplates(db, teamId, {
      search: search ? escapeLikeTerm(search) : undefined,
      tag: tag && tag.length > 0 ? tag : undefined,
      page,
      pageSize,
    })
    const selectionCounts = await countTemplateSelections(
      db,
      result.items.map((item) => item.id),
    )
    return {
      items: result.items.map((item) => toTemplateListItem(item, selectionCounts.get(item.id) ?? 0)),
      page,
      pageSize,
      total: result.total,
    }
  }

  /** 读取模板详情。 */
  async function getTemplate(actor: SessionUser, templateId: string) {
    await requireTemplateRead(db, actor, templateId)
    const detail = await findTemplateDetail(db, templateId)
    if (!detail) throw new Error('数据库模板当前版本缺失')
    const counts = await countTemplateSelections(db, [templateId])
    return toTemplateDetail(detail, counts.get(templateId) ?? 0)
  }

  /**
   * 新建模板；保存为内容版本 v1。
   * @param actor 当前用户。
   * @param teamId 团队标识。
   * @param input 模板字段与正文。
   * @returns 新建模板详情。
   */
  async function createTemplate(
    actor: SessionUser,
    teamId: string,
    input: { name: string; tag: string; description?: string | null; content: string },
  ) {
    await requireWriteRole(db, actor, teamId)
    const name = requiredText(input.name, '名称', 40)
    const nameNormalized = templateNameKey(name)
    const tag = requiredText(input.tag, '分类', 30)
    const description = optionalText(input.description, '说明', 200)
    const content = validateTemplateContent(input.content)
    if (await findTemplateByNormalizedName(db, teamId, nameNormalized)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '模板名称已存在，请换一个名称')
    }
    const templateId = randomUUID()
    const versionId = randomUUID()
    await db.transaction(async (tx) => {
      await insertTemplateVersion(tx, {
        id: versionId,
        teamId,
        templateId,
        version: 1,
        content,
        createdByUserId: actor.id,
      })
      await insertTemplate(tx, {
        id: templateId,
        teamId,
        name,
        nameNormalized,
        tag,
        description,
        currentVersionId: versionId,
        createdByUserId: actor.id,
      })
      await appendActivity(tx, {
        teamId,
        entityType: 'agent_template',
        entityId: templateId,
        action: 'agent_template_created',
        actorUserId: actor.id,
        changes: { contentVersion: 1 },
      })
    })
    return getTemplate(actor, templateId)
  }

  /** 编辑模板；每次保存递增内容版本并保留历史。 */
  async function updateTemplate(
    actor: SessionUser,
    templateId: string,
    input: { version: number; name: string; tag: string; description?: string | null; content: string },
  ) {
    const current = await requireTemplateRead(db, actor, templateId)
    await requireWriteRole(db, actor, current.teamId)
    const name = requiredText(input.name, '名称', 40)
    const nameNormalized = templateNameKey(name)
    const tag = requiredText(input.tag, '分类', 30)
    const description = optionalText(input.description, '说明', 200)
    const content = validateTemplateContent(input.content)
    if (await findTemplateByNormalizedName(db, current.teamId, nameNormalized, templateId)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '模板名称已存在，请换一个名称')
    }
    await db.transaction(async (tx) => {
      const locked = await lockTemplate(tx, templateId)
      if (!locked) throw new ApiError(ERROR_CODES.NOT_FOUND, '模板不存在')
      if (locked.version !== input.version) {
        throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '模板已被其他人更新，请刷新后重试')
      }
      const currentVersion = await findTemplateVersionById(tx, locked.currentVersionId)
      if (!currentVersion) throw new Error('数据库模板当前版本缺失')
      const nextVersion = currentVersion.version + 1
      const versionId = randomUUID()
      await insertTemplateVersion(tx, {
        id: versionId,
        teamId: locked.teamId,
        templateId,
        version: nextVersion,
        content,
        createdByUserId: actor.id,
      })
      const updated = await updateTemplateRow(tx, templateId, input.version, {
        name,
        nameNormalized,
        tag,
        description,
        currentVersionId: versionId,
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '模板已被其他人更新，请刷新后重试')
      await appendActivity(tx, {
        teamId: locked.teamId,
        entityType: 'agent_template',
        entityId: templateId,
        action: 'agent_template_updated',
        actorUserId: actor.id,
        changes: { contentVersion: nextVersion, previousContentVersion: currentVersion.version },
      })
    })
    return getTemplate(actor, templateId)
  }

  /** 基于当前正文创建独立模板副本。 */
  async function duplicateTemplate(actor: SessionUser, templateId: string, nameInput: string) {
    const current = await requireTemplateRead(db, actor, templateId)
    await requireWriteRole(db, actor, current.teamId)
    const name = requiredText(nameInput, '名称', 40)
    const nameNormalized = templateNameKey(name)
    const detail = await findTemplateDetail(db, templateId)
    if (!detail) throw new Error('数据库模板当前版本缺失')
    if (await findTemplateByNormalizedName(db, current.teamId, nameNormalized)) {
      throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '模板名称已存在，请换一个名称')
    }
    const newTemplateId = randomUUID()
    const versionId = randomUUID()
    await db.transaction(async (tx) => {
      await insertTemplateVersion(tx, {
        id: versionId,
        teamId: current.teamId,
        templateId: newTemplateId,
        version: 1,
        content: detail.content,
        createdByUserId: actor.id,
      })
      await insertTemplate(tx, {
        id: newTemplateId,
        teamId: current.teamId,
        name,
        nameNormalized,
        tag: detail.tag,
        description: detail.description,
        currentVersionId: versionId,
        createdByUserId: actor.id,
      })
      await appendActivity(tx, {
        teamId: current.teamId,
        entityType: 'agent_template',
        entityId: newTemplateId,
        action: 'agent_template_duplicated',
        actorUserId: actor.id,
        changes: { sourceTemplateId: templateId },
      })
    })
    return getTemplate(actor, newTemplateId)
  }

  /** 读取模板版本历史。 */
  async function listTemplateVersions(actor: SessionUser, templateId: string, page: number, pageSize: number) {
    await requireTemplateRead(db, actor, templateId)
    validatePage(page, pageSize)
    const result = await findTemplateVersions(db, templateId, page, pageSize)
    return { items: result.items.map(toTemplateVersionItem), page, pageSize, total: result.total }
  }

  /** 读取模板历史版本正文。 */
  async function getTemplateVersion(actor: SessionUser, templateId: string, versionId: string) {
    await requireTemplateRead(db, actor, templateId)
    const version = await findTemplateVersionById(db, versionId)
    if (!version || version.templateId !== templateId) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, '模板版本不存在')
    }
    return toTemplateVersionDetail(version)
  }

  /** 读取模板活动分页。 */
  async function listTemplateActivities(actor: SessionUser, templateId: string, page: number, pageSize: number) {
    await requireTemplateRead(db, actor, templateId)
    return listActivities(db, 'agent_template', templateId, page, pageSize)
  }

  /** 读取项目并校验当前用户可见；写操作再校验角色。 */
  async function requireProject(actor: SessionUser, projectId: string, write: boolean) {
    const project = await getProjectContext(db, projectId)
    if (!project || !(await isActiveTeamMember(db, project.teamId, actor.id))) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, '项目不存在')
    }
    if (write) await requireWriteRole(db, actor, project.teamId)
    return project
  }

  /** 读取项目当前选用模板。 */
  async function getProjectTemplate(actor: SessionUser, projectId: string) {
    await requireProject(actor, projectId, false)
    const detail = await findSelectionDetail(db, projectId)
    return toProjectTemplateSelection(detail)
  }

  /** 选用或切换项目模板；重复选用幂等。 */
  async function applyProjectTemplate(
    actor: SessionUser,
    projectId: string,
    input: { templateId: string; version: number },
  ) {
    const project = await requireProject(actor, projectId, true)
    const template = await findTemplateById(db, input.templateId)
    if (!template) throw new ApiError(ERROR_CODES.NOT_FOUND, '模板不存在')
    if (template.teamId !== project.teamId) {
      throw new ApiError(ERROR_CODES.PRECONDITION_FAILED, '模板与项目不属于同一团队')
    }
    const templateVersion = await findTemplateVersionById(db, template.currentVersionId)
    if (!templateVersion) throw new Error('数据库模板当前版本缺失')
    await db.transaction(async (tx) => {
      const locked = await lockProjectTemplateSelection(tx, projectId)
      if (!locked) {
        if (input.version !== 0) {
          throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '项目模板选用已变化，请刷新后重试')
        }
        await insertProjectTemplateSelection(tx, {
          id: randomUUID(),
          teamId: project.teamId,
          projectId,
          templateId: template.id,
          selectedByUserId: actor.id,
        })
        await appendActivity(tx, {
          teamId: project.teamId,
          projectId,
          entityType: 'project',
          entityId: projectId,
          action: 'agent_template_applied',
          actorUserId: actor.id,
          changes: { templateId: template.id, templateName: template.name, contentVersion: templateVersion.version },
        })
        return
      }
      if (locked.version !== input.version) {
        throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '项目模板选用已变化，请刷新后重试')
      }
      if (locked.templateId === template.id) return
      const updated = await updateProjectTemplateSelection(tx, locked.id, input.version, {
        templateId: template.id,
        selectedByUserId: actor.id,
      })
      if (!updated) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '项目模板选用已变化，请刷新后重试')
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId,
        entityType: 'project',
        entityId: projectId,
        action: 'agent_template_applied',
        actorUserId: actor.id,
        changes: {
          templateId: template.id,
          templateName: template.name,
          contentVersion: templateVersion.version,
          previousTemplateId: locked.templateId,
        },
      })
    })
    return getProjectTemplate(actor, projectId)
  }

  /** 取消项目模板选用；未选用按幂等成功返回。 */
  async function clearProjectTemplate(actor: SessionUser, projectId: string, version: number) {
    const project = await requireProject(actor, projectId, true)
    await db.transaction(async (tx) => {
      const locked = await lockProjectTemplateSelection(tx, projectId)
      if (!locked) return
      if (locked.version !== version) {
        throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '项目模板选用已变化，请刷新后重试')
      }
      const deleted = await deleteProjectTemplateSelection(tx, locked.id, version)
      if (!deleted) throw new ApiError(ERROR_CODES.VERSION_CONFLICT, '项目模板选用已变化，请刷新后重试')
      await appendActivity(tx, {
        teamId: project.teamId,
        projectId,
        entityType: 'project',
        entityId: projectId,
        action: 'agent_template_selection_cleared',
        actorUserId: actor.id,
      })
    })
    return getProjectTemplate(actor, projectId)
  }

  /**
   * 生成模板快照预览链接；令牌是定位符而非凭证，不写入活动。
   * @param actor 当前用户。
   * @param templateId 模板标识。
   * @returns 令牌与版本信息。
   */
  async function createTemplateSnapshotLink(actor: SessionUser, templateId: string) {
    const current = await requireTemplateRead(db, actor, templateId)
    await requireWriteRole(db, actor, current.teamId)
    const token = randomBytes(32).toString('base64url')
    const link = await db.transaction(async (tx) => {
      const locked = await lockTemplate(tx, templateId)
      if (!locked) throw new ApiError(ERROR_CODES.NOT_FOUND, '模板不存在')
      const version = await findTemplateVersionById(tx, locked.currentVersionId)
      if (!version) throw new Error('数据库模板当前版本缺失')
      const inserted = await insertTemplateSnapshotLink(tx, {
        id: randomUUID(),
        teamId: locked.teamId,
        templateId,
        templateVersionId: version.id,
        token,
        createdByUserId: actor.id,
      })
      await appendActivity(tx, {
        teamId: locked.teamId,
        entityType: 'agent_template',
        entityId: templateId,
        action: 'agent_template_snapshot_created',
        actorUserId: actor.id,
        changes: { contentVersion: version.version },
      })
      return { link: inserted, version }
    })
    return toSnapshotLinkCreated(link.link, link.version.version)
  }

  /**
   * 打开模板快照链接；需登录且为模板团队正常成员。
   * @param actor 当前用户。
   * @param token 快照令牌。
   * @returns 快照内容与版本。
   */
  async function getTemplateSnapshot(actor: SessionUser, token: string) {
    const link = await findTemplateSnapshotLinkByToken(db, token)
    if (!link) throw new ApiError(ERROR_CODES.NOT_FOUND, '快照链接不存在或已失效')
    const template = await findTemplateById(db, link.templateId)
    const version = await findTemplateVersionById(db, link.templateVersionId)
    if (!template || !version || !(await isActiveTeamMember(db, template.teamId, actor.id))) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, '快照链接不存在或已失效')
    }
    return toTemplateSnapshot(link, template, version)
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

  /**
   * 阶段 B：解析项目当前选用的模板版本。
   * @param input 团队标识与项目标识。
   * @returns selected/not_selected/unavailable 三态结果。
   */
  async function resolveProjectTemplateForRun(input: {
    teamId: string
    projectId: string
  }): Promise<ResolveProjectTemplateForRunResult> {
    const project = await getProjectContext(db, input.projectId)
    if (!project) return { status: 'unavailable', reason: 'project_not_found' }
    if (project.teamId !== input.teamId) return { status: 'unavailable', reason: 'project_other_team' }
    const row = await findProjectTemplateForRun(db, input.projectId)
    if (!row) return { status: 'not_selected' }
    if (row.templateTeamId !== input.teamId) return { status: 'unavailable', reason: 'template_unavailable' }
    return {
      status: 'selected',
      template: {
        templateId: row.selection.templateId,
        templateName: row.templateName,
        templateVersionId: row.templateVersionId,
        contentVersion: row.contentVersion,
        content: row.content,
      },
    }
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
    listTemplates,
    getTemplate,
    createTemplate,
    updateTemplate,
    duplicateTemplate,
    listTemplateVersions,
    getTemplateVersion,
    listTemplateActivities,
    getProjectTemplate,
    applyProjectTemplate,
    clearProjectTemplate,
    createTemplateSnapshotLink,
    getTemplateSnapshot,
    resolveSkillsForRun,
    listAssignableSkillsForBotConfig,
    resolveProjectTemplateForRun,
    countEnabledSkills: (teamId: string) => countEnabledSkills(db, teamId),
    findProjectTemplateSelection: (projectId: string) => findProjectTemplateSelection(db, projectId),
  }
}

/** knowledge 服务类型，供 bootstrap 与调用方推导。 */
export type KnowledgeService = ReturnType<typeof createKnowledgeService>
