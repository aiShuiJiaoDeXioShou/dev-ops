import type { Command } from 'commander'
import { createIdempotencyKey } from '@dev-ops/api-client'
import type { ApiBody, ApiCallOptions, ApiQuery } from '@dev-ops/api-client'

import {
  businessContext,
  globalsOf,
  printBusinessResult,
  readContent,
  type BusinessCommandContext,
} from '../lib/command.ts'
import { resolvePagination, type GlobalOptions } from '../lib/config.ts'
import type { CliContext } from '../lib/context.ts'
import { confirmDangerous } from '../lib/confirm.ts'
import { CliError } from '../lib/errors.ts'
import { normalizeList } from '../lib/output.ts'

/** 需求业务状态；与后端 OpenAPI 契约保持一致。 */
const REQUIREMENT_STATUSES = ['pending', 'in_development', 'submitted', 'in_testing', 'passed', 'cancelled'] as const
type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number]

/** 自测结论取值；非通过结论在后端要求填写自测说明。 */
const SELF_TEST_RESULTS = ['passed', 'has_failures', 'not_run', 'not_applicable'] as const
type SelfTestResult = (typeof SELF_TEST_RESULTS)[number]

/** 需求内容方式：内置 Markdown 正文或外部文档链接。 */
const CONTENT_MODES = ['markdown', 'external_link'] as const
type ContentMode = (typeof CONTENT_MODES)[number]

/** `--all` 逐页读取时的安全上限，超过后失败关闭而不是静默截断。 */
const ALL_PAGES_LIMIT = 1000

/** 项目需求列表的筛选与分页参数；`ownerUnavailable` 为平台 owner 可用性筛选。 */
type RequirementListFilters = NonNullable<ApiQuery<'/api/v1/projects/{projectId}/requirements', 'get'>>
type RequirementListQuery = RequirementListFilters & { ownerUnavailable?: boolean }

/** 需求正文相关字段；创建与编辑共用，标题与版本等其余字段由调用处补充。 */
type RequirementContentInput = Pick<
  ApiBody<'/api/v1/projects/{projectId}/requirements', 'post'>,
  'contentMode' | 'contentMarkdown' | 'externalUrl' | 'externalSummary'
>

interface PageData {
  items: unknown[]
  page: number
  pageSize: number
  total: number
}

/** 已经解析出的动作前置信息：客户端、全局选项与并发版本。 */
interface PreparedAction {
  business: BusinessCommandContext
  globals: GlobalOptions
  version: number
}

interface RequirementListOptions {
  project?: string
  search?: string
  status?: string
  owner?: string
  ownerUnavailable?: boolean
}

interface ContentOptions {
  contentFile?: string
  contentMode?: string
  externalUrl?: string
  externalSummary?: string
}

interface CreateRequirementOptions extends ContentOptions {
  project?: string
  title?: string
  acceptance?: string
  devOwner?: string
  testOwner?: string
  collaborator?: string[]
}

interface UpdateRequirementOptions extends ContentOptions {
  expectedVersion?: string
  title?: string
  acceptance?: string
  devOwner?: string
  testOwner?: string
  collaborator?: string[]
}

interface CommentOptions {
  contentFile?: string
}

interface VersionOption {
  expectedVersion?: string
}

interface ReasonOptions extends VersionOption {
  reason?: string
}

interface ReturnToDevelopmentOptions extends ReasonOptions {
  linkBug?: string[]
}

interface SubmitTestOptions extends VersionOption {
  testOwner?: string
  scopeNote?: string
  selfTestResult?: string
  selfTestNote?: string
  testEntry?: string
  versionNote?: string
}

interface PassTestOptions extends VersionOption {
  conclusion?: string
}

/** 一次性收集可重复选项的取值，例如多个 `--link-bug`。 */
function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value]
}

/** 读取必填文本参数；缺省或全空白按参数错误退出 2。 */
function requireText(value: string | undefined, message: string): string {
  const text = value?.trim()
  if (text === undefined || text.length === 0) throw new CliError(message, 2, { code: 'INVALID_ARGUMENTS' })
  return text
}

/** 校验内容非空，避免把空正文发送到服务端。 */
function requireContentText(value: string, name: string): string {
  if (value.trim().length === 0) throw new CliError(`${name}不能为空`, 2, { code: 'EMPTY_CONTENT' })
  return value
}

/** 解析需求状态参数；非法值在请求前以退出码 2 拒绝。 */
function parseStatus(value: string | undefined): RequirementStatus | undefined {
  if (value === undefined) return undefined
  const status = REQUIREMENT_STATUSES.find((candidate) => candidate === value)
  if (status === undefined) {
    throw new CliError(`需求状态不合法，可选值：${REQUIREMENT_STATUSES.join('、')}`, 2, { code: 'INVALID_STATUS' })
  }
  return status
}

/** 解析自测结论参数；必填且只能是平台枚举值。 */
function parseSelfTestResult(value: string | undefined): SelfTestResult {
  const text = requireText(value, '缺少 --self-test-result 参数')
  const result = SELF_TEST_RESULTS.find((candidate) => candidate === text)
  if (result === undefined) {
    throw new CliError(`自测结论不合法，可选值：${SELF_TEST_RESULTS.join('、')}`, 2, {
      code: 'INVALID_SELF_TEST_RESULT',
    })
  }
  return result
}

/** 解析内容方式参数；非法值在请求前以退出码 2 拒绝。 */
function parseContentMode(value: string | undefined): ContentMode | undefined {
  if (value === undefined) return undefined
  const mode = CONTENT_MODES.find((candidate) => candidate === value)
  if (mode === undefined) {
    throw new CliError(`需求内容方式不合法，可选值：${CONTENT_MODES.join('、')}`, 2, { code: 'INVALID_CONTENT_MODE' })
  }
  return mode
}

/** 解析 `--expected-version`；省略时返回 undefined，表示需要读取当前版本。 */
function parseExpectedVersion(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const version = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(version) || version < 1) {
    throw new CliError('--expected-version 必须是正整数', 2, { code: 'INVALID_VERSION' })
  }
  return version
}

/** 读取动作提交所需版本：显式版本优先，否则先查询需求详情。 */
async function resolveVersion(
  business: BusinessCommandContext,
  requirementId: string,
  expectedVersion: string | undefined,
): Promise<number> {
  const explicitVersion = parseExpectedVersion(expectedVersion)
  if (explicitVersion !== undefined) return explicitVersion
  const result = await business.client.getRequirement(requirementId)
  return result.data.version
}

/** 构造写请求选项；默认生成幂等键，允许 `--idempotency-key` 覆盖以安全重试。 */
function writeCallOptions(globals: GlobalOptions): ApiCallOptions {
  return { idempotencyKey: globals.idempotencyKey ?? createIdempotencyKey() }
}

/** 解析动作命令的共享依赖与当前版本，减少各动作重复代码。 */
async function prepareAction(
  context: CliContext,
  command: Command,
  requirementId: string,
  expectedVersion: string | undefined,
): Promise<PreparedAction> {
  const business = await businessContext(command, context)
  const globals = globalsOf(command)
  const version = await resolveVersion(business, requirementId, expectedVersion)
  return { business, globals, version }
}

/**
 * 逐页读取全部列表；`--all` 使用，不静默截断。
 * @param pageSize 每页数量。
 * @param fetchPage 按页码取一页。
 * @returns 归一化后的完整列表与最后一次请求标识。
 * @throws 页数超过安全上限或服务端总数与实际返回不一致时抛出运行错误。
 */
async function readAllPages(
  pageSize: number,
  fetchPage: (page: number, pageSize: number) => Promise<{ data: unknown; requestId: string }>,
): Promise<{ data: PageData; requestId: string }> {
  const items: unknown[] = []
  let requestId = ''
  let declaredTotal = 0
  let page = 1
  for (;;) {
    const result = await fetchPage(page, pageSize)
    const normalized = normalizeList<unknown>(result.data)
    items.push(...normalized.items)
    requestId = result.requestId
    declaredTotal = normalized.total
    if (normalized.items.length < pageSize || items.length >= declaredTotal) break
    page += 1
    if (page > ALL_PAGES_LIMIT) {
      throw new CliError(`列表超过 ${ALL_PAGES_LIMIT} 页，已停止读取；请缩小筛选范围`, 1, { code: 'LIST_PAGE_LIMIT' })
    }
  }
  if (items.length < declaredTotal) {
    throw new CliError(`列表读取不完整：已读取 ${items.length} 条，服务端声明 ${declaredTotal} 条，请重试`, 1, {
      code: 'LIST_INCOMPLETE',
    })
  }
  return { data: { items, page: 1, pageSize: items.length, total: items.length }, requestId }
}

/** 根据内容参数推断并校验内容方式。 */
function resolveContentMode(options: ContentOptions): ContentMode {
  const explicitMode = parseContentMode(options.contentMode)
  const hasContentFile = options.contentFile !== undefined
  const hasExternalUrl = options.externalUrl !== undefined && options.externalUrl.trim().length > 0
  if (hasContentFile && hasExternalUrl) {
    throw new CliError('--content-file 与 --external-url 不能同时使用', 2, { code: 'INVALID_ARGUMENTS' })
  }
  const mode = explicitMode ?? (hasContentFile ? 'markdown' : hasExternalUrl ? 'external_link' : undefined)
  if (mode === undefined) {
    throw new CliError('请通过 --content-file（使用 - 读取标准输入）或 --external-url 指定需求内容', 2, {
      code: 'INVALID_ARGUMENTS',
    })
  }
  if (mode === 'markdown' && hasExternalUrl) {
    throw new CliError('--content-mode markdown 时不能使用 --external-url', 2, { code: 'INVALID_ARGUMENTS' })
  }
  if (mode === 'external_link' && hasContentFile) {
    throw new CliError('--content-mode external_link 时不能使用 --content-file', 2, { code: 'INVALID_ARGUMENTS' })
  }
  if (mode === 'external_link' && options.externalUrl === undefined) {
    throw new CliError('外链需求必须提供 --external-url', 2, { code: 'INVALID_ARGUMENTS' })
  }
  if (mode === 'markdown' && options.externalSummary !== undefined) {
    throw new CliError('内置正文需求不能使用 --external-summary', 2, { code: 'INVALID_ARGUMENTS' })
  }
  return mode
}

/** 读取并校验创建需求的内容字段。 */
async function resolveCreateContent(options: ContentOptions, context: CliContext): Promise<RequirementContentInput> {
  const mode = resolveContentMode(options)
  if (mode === 'markdown') {
    if (options.contentFile === undefined) {
      throw new CliError('内置正文需求必须通过 --content-file 提供正文（- 表示标准输入）', 2, {
        code: 'INVALID_ARGUMENTS',
      })
    }
    const contentMarkdown = requireContentText(await readContent(options.contentFile, context), '需求正文')
    return { contentMode: 'markdown', contentMarkdown }
  }
  const externalUrl = requireText(options.externalUrl, '外链需求必须提供 --external-url')
  const content: RequirementContentInput = { contentMode: 'external_link', externalUrl }
  if (options.externalSummary !== undefined) content.externalSummary = options.externalSummary
  return content
}

/** 读取并校验更新需求时提供的内容字段；未提供内容字段时返回 undefined。 */
async function resolveUpdateContent(
  options: UpdateRequirementOptions,
  context: CliContext,
): Promise<RequirementContentInput | undefined> {
  const hasContentInput =
    options.contentFile !== undefined ||
    options.contentMode !== undefined ||
    options.externalUrl !== undefined ||
    options.externalSummary !== undefined
  if (!hasContentInput) return undefined
  const mode = resolveContentMode(options)
  if (mode === 'markdown') {
    if (options.contentFile === undefined) {
      throw new CliError('修改内置正文时必须提供 --content-file', 2, { code: 'INVALID_ARGUMENTS' })
    }
    const contentMarkdown = requireContentText(await readContent(options.contentFile, context), '需求正文')
    return { contentMode: 'markdown', contentMarkdown }
  }
  const content: RequirementContentInput = { contentMode: 'external_link' }
  if (options.externalUrl !== undefined) content.externalUrl = options.externalUrl
  if (options.externalSummary !== undefined) content.externalSummary = options.externalSummary
  return content
}

/** 注册需求列表、详情、评论/活动/提测历史与测试通过条件等只读命令。 */
function registerRequirementReadCommands(requirement: Command, context: CliContext): void {
  requirement
    .command('list')
    .description('按项目查询需求列表，支持搜索、状态、负责人与分页筛选')
    .option('--project <projectId>', '所属项目标识（必填）')
    .option('--search <text>', '按标题或需求编号搜索')
    .option('--status <status>', `需求状态：${REQUIREMENT_STATUSES.join('、')}`)
    .option('--owner <userId>', '按研发负责人用户标识筛选')
    .option('--owner-unavailable', '只返回负责人不可用的需求')
    .action(async (options: RequirementListOptions, command: Command) => {
      const projectId = requireText(options.project, '缺少 --project 参数')
      const status = parseStatus(options.status)
      const globals = globalsOf(command)
      const pagination = resolvePagination(globals)
      const query: RequirementListQuery = {}
      if (options.search !== undefined) query.search = options.search
      if (status !== undefined) query.status = status
      if (options.owner !== undefined) query.ownerId = options.owner
      if (options.ownerUnavailable === true) query.ownerUnavailable = true
      const business = await businessContext(command, context)
      const fetchPage = (page: number, pageSize: number) => {
        const pageQuery: RequirementListQuery = { ...query, page, pageSize }
        return business.client.listRequirements(projectId, pageQuery)
      }
      const result = pagination.all
        ? await readAllPages(pagination.pageSize, fetchPage)
        : await business.client.listRequirements(projectId, {
            ...query,
            page: pagination.page,
            pageSize: pagination.pageSize,
          })
      printBusinessResult(context, globals, result, true)
    })

  requirement
    .command('get')
    .description('读取需求详情，含正文、验收标准、负责人、提测与关联事项')
    .argument('<requirementId>', '需求标识')
    .action(async (requirementId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const result = await business.client.getRequirement(requirementId)
      printBusinessResult(context, globalsOf(command), result)
    })

  registerPagedListCommand(
    requirement,
    context,
    'comments',
    '读取需求评论（分页）',
    (business, requirementId, page, pageSize) =>
      business.client.listRequirementComments(requirementId, { page, pageSize }),
  )
  registerPagedListCommand(
    requirement,
    context,
    'activities',
    '读取需求活动（分页）',
    (business, requirementId, page, pageSize) =>
      business.client.listRequirementActivities(requirementId, { page, pageSize }),
  )
  registerPagedListCommand(
    requirement,
    context,
    'test-submissions',
    '读取需求提测历史（分页）',
    (business, requirementId, page, pageSize) =>
      business.client.listRequirementTestSubmissions(requirementId, { page, pageSize }),
  )

  requirement
    .command('eligibility')
    .description('查询需求是否满足测试通过条件，列出阻碍的关联 Bug')
    .argument('<requirementId>', '需求标识')
    .action(async (requirementId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const result = await business.client.getRequirementTestPassEligibility(requirementId)
      printBusinessResult(context, globalsOf(command), result)
    })
}

/** 注册按需求分页读取的只读命令，统一处理 `--page/--page-size/--all`。 */
function registerPagedListCommand(
  requirement: Command,
  context: CliContext,
  name: string,
  description: string,
  fetchPage: (
    business: BusinessCommandContext,
    requirementId: string,
    page: number,
    pageSize: number,
  ) => Promise<{ data: unknown; requestId: string }>,
): void {
  requirement
    .command(name)
    .description(description)
    .argument('<requirementId>', '需求标识')
    .action(async (requirementId: string, _options: unknown, command: Command) => {
      const business = await businessContext(command, context)
      const globals = globalsOf(command)
      const pagination = resolvePagination(globals)
      const result = pagination.all
        ? await readAllPages(pagination.pageSize, (page, pageSize) =>
            fetchPage(business, requirementId, page, pageSize),
          )
        : await fetchPage(business, requirementId, pagination.page, pagination.pageSize)
      printBusinessResult(context, globals, result, true)
    })
}

/** 注册需求创建、编辑与评论命令。 */
function registerRequirementWriteCommands(requirement: Command, context: CliContext): void {
  requirement
    .command('create')
    .description('创建需求，正文从文件或标准输入读取，或提供外部文档链接')
    .option('--project <projectId>', '所属项目标识（必填）')
    .option('--title <title>', '需求标题（必填）')
    .option('--content-file <path>', '内置正文 Markdown 文件；使用 - 从标准输入读取')
    .option('--content-mode <mode>', `内容方式：${CONTENT_MODES.join('、')}`)
    .option('--external-url <url>', '外部文档链接；与 --content-file 二选一')
    .option('--external-summary <text>', '外部文档摘要')
    .option('--acceptance <text>', '验收标准')
    .option('--dev-owner <userId>', '研发负责人用户标识')
    .option('--test-owner <userId>', '测试负责人用户标识')
    .option('--collaborator <userId>', '协作人员用户标识，可重复指定', collectValues, [])
    .action(async (options: CreateRequirementOptions, command: Command) => {
      const projectId = requireText(options.project, '缺少 --project 参数')
      const title = requireText(options.title, '缺少 --title 参数')
      const content = await resolveCreateContent(options, context)
      const body: ApiBody<'/api/v1/projects/{projectId}/requirements', 'post'> = { title, ...content }
      if (options.acceptance !== undefined) body.acceptanceCriteria = options.acceptance
      if (options.devOwner !== undefined) body.devOwnerUserId = options.devOwner
      if (options.testOwner !== undefined) body.testOwnerUserId = options.testOwner
      if (options.collaborator !== undefined && options.collaborator.length > 0) {
        body.collaboratorUserIds = options.collaborator
      }
      const business = await businessContext(command, context)
      const globals = globalsOf(command)
      const result = await business.client.createRequirement(projectId, body, writeCallOptions(globals))
      printBusinessResult(context, globals, result)
    })

  requirement
    .command('update')
    .description('编辑需求允许修改的字段；使用 --expected-version 防止覆盖他人更新')
    .argument('<requirementId>', '需求标识')
    .option('--expected-version <version>', '期望的当前版本；省略时先读取最新版本')
    .option('--title <title>', '需求标题')
    .option('--content-file <path>', '内置正文 Markdown 文件；使用 - 从标准输入读取')
    .option('--content-mode <mode>', `内容方式：${CONTENT_MODES.join('、')}`)
    .option('--external-url <url>', '外部文档链接')
    .option('--external-summary <text>', '外部文档摘要')
    .option('--acceptance <text>', '验收标准')
    .option('--dev-owner <userId>', '研发负责人用户标识')
    .option('--test-owner <userId>', '测试负责人用户标识')
    .option('--collaborator <userId>', '协作人员用户标识，可重复指定', collectValues, [])
    .action(async (requirementId: string, options: UpdateRequirementOptions, command: Command) => {
      const title = options.title === undefined ? undefined : requireText(options.title, '--title 不能为空')
      const content = await resolveUpdateContent(options, context)
      const collaborators = options.collaborator === undefined ? [] : options.collaborator
      const hasChange =
        title !== undefined ||
        content !== undefined ||
        options.acceptance !== undefined ||
        options.devOwner !== undefined ||
        options.testOwner !== undefined ||
        collaborators.length > 0
      if (!hasChange) throw new CliError('请至少提供一个需要修改的字段', 2, { code: 'INVALID_ARGUMENTS' })
      const business = await businessContext(command, context)
      const globals = globalsOf(command)
      const version = await resolveVersion(business, requirementId, options.expectedVersion)
      const body: ApiBody<'/api/v1/requirements/{requirementId}/update', 'post'> = {
        version,
        ...(content ?? {}),
        ...(title === undefined ? {} : { title }),
        ...(options.acceptance === undefined ? {} : { acceptanceCriteria: options.acceptance }),
        ...(options.devOwner === undefined ? {} : { devOwnerUserId: options.devOwner }),
        ...(options.testOwner === undefined ? {} : { testOwnerUserId: options.testOwner }),
        ...(collaborators.length === 0 ? {} : { collaboratorUserIds: collaborators }),
      }
      const result = await business.client.updateRequirement(requirementId, body, writeCallOptions(globals))
      printBusinessResult(context, globals, result)
    })

  requirement
    .command('comment')
    .description('追加需求评论，Markdown 正文从文件或标准输入读取')
    .argument('<requirementId>', '需求标识')
    .option('--content-file <path>', '评论 Markdown 文件；使用 - 从标准输入读取')
    .action(async (requirementId: string, options: CommentOptions, command: Command) => {
      const bodyMarkdown = requireContentText(await readContent(options.contentFile, context), '评论内容')
      const business = await businessContext(command, context)
      const globals = globalsOf(command)
      const result = await business.client.addRequirementComment(
        requirementId,
        { bodyMarkdown },
        writeCallOptions(globals),
      )
      printBusinessResult(context, globals, result)
    })
}

/** 注册需求状态流转命令，动作前统一读取或校验版本。 */
function registerRequirementActionCommands(requirement: Command, context: CliContext): void {
  requirement
    .command('start-development')
    .description('需求开始开发；仅待处理状态可用')
    .argument('<requirementId>', '需求标识')
    .option('--expected-version <version>', '期望的当前版本；省略时先读取最新版本')
    .action(async (requirementId: string, options: VersionOption, command: Command) => {
      const action = await prepareAction(context, command, requirementId, options.expectedVersion)
      const result = await action.business.client.startRequirementDevelopment(
        requirementId,
        { version: action.version },
        writeCallOptions(action.globals),
      )
      printBusinessResult(context, action.globals, result)
    })

  requirement
    .command('submit-test')
    .description('需求提测；需要测试负责人、测试范围与自测结论')
    .argument('<requirementId>', '需求标识')
    .option('--expected-version <version>', '期望的当前版本；省略时先读取最新版本')
    .option('--test-owner <userId>', '测试负责人用户标识（必填）')
    .option('--scope-note <text>', '测试范围说明（必填）')
    .option('--self-test-result <result>', `自测结论：${SELF_TEST_RESULTS.join('、')}（必填）`)
    .option('--self-test-note <text>', '自测说明；非通过结论时必填')
    .option('--test-entry <text>', '测试入口说明')
    .option('--version-note <text>', '版本说明')
    .action(async (requirementId: string, options: SubmitTestOptions, command: Command) => {
      const testOwnerUserId = requireText(options.testOwner, '缺少 --test-owner 参数')
      const scopeNote = requireText(options.scopeNote, '缺少 --scope-note 参数')
      const selfTestResult = parseSelfTestResult(options.selfTestResult)
      if (selfTestResult !== 'passed' && !options.selfTestNote?.trim()) {
        throw new CliError('自测结论非 passed 时必须提供 --self-test-note 说明', 2, {
          code: 'MISSING_SELF_TEST_NOTE',
        })
      }
      const action = await prepareAction(context, command, requirementId, options.expectedVersion)
      const result = await action.business.client.submitRequirementTest(
        requirementId,
        {
          version: action.version,
          testOwnerUserId,
          scopeNote,
          selfTestResult,
          ...(options.selfTestNote === undefined ? {} : { selfTestNote: options.selfTestNote }),
          ...(options.testEntry === undefined ? {} : { testEntry: options.testEntry }),
          ...(options.versionNote === undefined ? {} : { versionNote: options.versionNote }),
        },
        writeCallOptions(action.globals),
      )
      printBusinessResult(context, action.globals, result)
    })

  requirement
    .command('start-test')
    .description('需求开始测试；仅待测试状态可用')
    .argument('<requirementId>', '需求标识')
    .option('--expected-version <version>', '期望的当前版本；省略时先读取最新版本')
    .action(async (requirementId: string, options: VersionOption, command: Command) => {
      const action = await prepareAction(context, command, requirementId, options.expectedVersion)
      const result = await action.business.client.startRequirementTest(
        requirementId,
        { version: action.version },
        writeCallOptions(action.globals),
      )
      printBusinessResult(context, action.globals, result)
    })

  requirement
    .command('withdraw-test')
    .description('撤回提测，需求回到开发中；必须填写原因')
    .argument('<requirementId>', '需求标识')
    .option('--expected-version <version>', '期望的当前版本；省略时先读取最新版本')
    .option('--reason <text>', '撤回原因（必填）')
    .action(async (requirementId: string, options: ReasonOptions, command: Command) => {
      const reason = requireText(options.reason, '缺少 --reason 参数')
      const action = await prepareAction(context, command, requirementId, options.expectedVersion)
      const result = await action.business.client.withdrawRequirementTest(
        requirementId,
        { version: action.version, reason },
        writeCallOptions(action.globals),
      )
      printBusinessResult(context, action.globals, result)
    })

  requirement
    .command('return-to-development')
    .description('测试退回开发；必须填写原因，可关联多个 Bug')
    .argument('<requirementId>', '需求标识')
    .option('--expected-version <version>', '期望的当前版本；省略时先读取最新版本')
    .option('--reason <text>', '退回原因（必填）')
    .option('--link-bug <bugId>', '关联的 Bug 标识，可重复指定', collectValues, [])
    .action(async (requirementId: string, options: ReturnToDevelopmentOptions, command: Command) => {
      const reason = requireText(options.reason, '缺少 --reason 参数')
      const linkedBugIds = options.linkBug === undefined ? [] : options.linkBug
      const action = await prepareAction(context, command, requirementId, options.expectedVersion)
      const result = await action.business.client.returnRequirementToDevelopment(
        requirementId,
        {
          version: action.version,
          reason,
          ...(linkedBugIds.length === 0 ? {} : { linkedBugIds }),
        },
        writeCallOptions(action.globals),
      )
      printBusinessResult(context, action.globals, result)
    })

  requirement
    .command('pass-test')
    .description('测试通过；先检查关联 Bug 是否全部解决，不满足时列出阻碍项')
    .argument('<requirementId>', '需求标识')
    .option('--expected-version <version>', '期望的当前版本；省略时先读取最新版本')
    .option('--conclusion <text>', '测试结论（必填）')
    .action(async (requirementId: string, options: PassTestOptions, command: Command) => {
      const conclusion = requireText(options.conclusion, '缺少 --conclusion 参数')
      const action = await prepareAction(context, command, requirementId, options.expectedVersion)
      const eligibility = await action.business.client.getRequirementTestPassEligibility(requirementId)
      if (!eligibility.data.eligible) {
        const blockers = eligibility.data.blockers.map((bug) => `#${bug.number} ${bug.title}（${bug.status}）`)
        const detail =
          blockers.length === 0 ? '需求当前状态不满足测试通过条件' : `存在未解决的关联 Bug：${blockers.join('、')}`
        throw new CliError(`不能通过测试：${detail}`, 1, {
          code: 'PRECONDITION_FAILED',
          requestId: eligibility.requestId,
        })
      }
      const result = await action.business.client.passRequirementTest(
        requirementId,
        { version: action.version, conclusion },
        writeCallOptions(action.globals),
      )
      printBusinessResult(context, action.globals, result)
    })

  requirement
    .command('reopen-development')
    .description('已通过需求重新开发；必须填写原因')
    .argument('<requirementId>', '需求标识')
    .option('--expected-version <version>', '期望的当前版本；省略时先读取最新版本')
    .option('--reason <text>', '重新开发原因（必填）')
    .action(async (requirementId: string, options: ReasonOptions, command: Command) => {
      const reason = requireText(options.reason, '缺少 --reason 参数')
      const action = await prepareAction(context, command, requirementId, options.expectedVersion)
      const result = await action.business.client.reopenRequirementDevelopment(
        requirementId,
        { version: action.version, reason },
        writeCallOptions(action.globals),
      )
      printBusinessResult(context, action.globals, result)
    })

  requirement
    .command('cancel')
    .description('取消需求；不可逆操作，必须同时提供原因与 --yes')
    .argument('<requirementId>', '需求标识')
    .option('--expected-version <version>', '期望的当前版本；省略时先读取最新版本')
    .option('--reason <text>', '取消原因（必填）')
    .action(async (requirementId: string, options: ReasonOptions, command: Command) => {
      const globals = globalsOf(command)
      await confirmDangerous({
        yes: globals.yes === true,
        json: globals.json === true,
        message: '取消需求不可撤销，确认继续？',
      })
      const reason = requireText(options.reason, '缺少 --reason 参数')
      const action = await prepareAction(context, command, requirementId, options.expectedVersion)
      const result = await action.business.client.cancelRequirement(
        requirementId,
        { version: action.version, reason },
        writeCallOptions(action.globals),
      )
      printBusinessResult(context, action.globals, result)
    })

  requirement
    .command('restore')
    .description('恢复已取消需求；必须填写原因')
    .argument('<requirementId>', '需求标识')
    .option('--expected-version <version>', '期望的当前版本；省略时先读取最新版本')
    .option('--reason <text>', '恢复原因（必填）')
    .action(async (requirementId: string, options: ReasonOptions, command: Command) => {
      const reason = requireText(options.reason, '缺少 --reason 参数')
      const action = await prepareAction(context, command, requirementId, options.expectedVersion)
      const result = await action.business.client.restoreRequirement(
        requirementId,
        { version: action.version, reason },
        writeCallOptions(action.globals),
      )
      printBusinessResult(context, action.globals, result)
    })
}

/**
 * 注册需求域命令：列表/详情、创建/编辑、评论、提测历史、测试条件与状态流转。
 * @param program CLI 根命令；子命令按 `requirement` 资源分组注册。
 * @param context 输出通道、环境变量与标准输入读取函数。
 * @returns 无返回值；命令由入口统一解析并决定退出码。
 * @remarks 命令错误向上抛出，由 runCli 统一输出并映射退出码；所有数据经由平台 API 读写。
 */
export function registerRequirementCommands(program: Command, context: CliContext): void {
  const requirement = program.command('requirement').description('需求查询、创建、评论与状态流转')
  registerRequirementReadCommands(requirement, context)
  registerRequirementWriteCommands(requirement, context)
  registerRequirementActionCommands(requirement, context)
}
