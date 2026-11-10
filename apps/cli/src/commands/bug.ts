import { createIdempotencyKey, type ApiBody, type ApiCallOptions, type ApiQuery } from '@dev-ops/api-client'
import type { Command } from 'commander'
import { businessContext, printBusinessResult, readContent, type BusinessCommandContext } from '../lib/command.ts'
import { resolvePagination, type GlobalOptions } from '../lib/config.ts'
import type { CliContext } from '../lib/context.ts'
import { confirmDangerous } from '../lib/confirm.ts'
import { CliError } from '../lib/errors.ts'

/** 服务端 Bug 状态取值。 */
const BUG_STATUSES = ['pending', 'in_fix', 'in_regression', 'resolved', 'closed'] as const
type BugStatus = (typeof BUG_STATUSES)[number]

/** 服务端 Bug 关闭分类。 */
const CLOSE_CATEGORIES = ['duplicate', 'not_bug', 'wont_fix'] as const
type CloseCategory = (typeof CLOSE_CATEGORIES)[number]

/** 回归验证结论。 */
const REGRESSION_RESULTS = ['passed', 'failed'] as const
type RegressionResult = (typeof REGRESSION_RESULTS)[number]

/** `--all` 逐页读取时的单页上限，与服务端分页上限一致。 */
const MAX_PAGE_SIZE = 100

/** 已认证业务客户端类型，避免在命令实现中重复推导。 */
type BugClient = BusinessCommandContext['client']

/** Bug 列表查询；ownerUnavailable 由服务端负责人可用性能力提供。 */
type BugListQuery = NonNullable<ApiQuery<'/api/v1/projects/{projectId}/bugs', 'get'>> & {
  ownerUnavailable?: boolean
}

type CreateBugBody = ApiBody<'/api/v1/projects/{projectId}/bugs', 'post'>
type UpdateBugBody = ApiBody<'/api/v1/bugs/{bugId}/update', 'post'>
type UpdateBugChanges = Omit<UpdateBugBody, 'version'>

/** 复现信息字段；未知复现时为 null 且明确标记 unknown。 */
interface ReproductionFields {
  reproduction: string | null
  reproductionUnknown: boolean
}

/** 分页结果的最小形状；`--all` 时用于汇总多页。 */
interface PageResult<T> {
  data: { items: T[]; page: number; pageSize: number; total: number }
  requestId: string
}

interface ListBugOptions {
  project: string
  search?: string
  status?: string
  ownerUnavailable?: boolean
}

interface CreateBugOptions {
  project: string
  title: string
  phenomenon: string
  expected: string
  reproduction?: string
  reproductionUnknown?: boolean
  evidence?: string
  fixOwner?: string
  requirement?: string
}

interface UpdateBugOptions {
  expectedVersion?: string
  title?: string
  phenomenon?: string
  expected?: string
  reproduction?: string
  reproductionUnknown?: boolean
  evidence?: string
  fixOwner?: string
}

interface CommentOptions {
  contentFile: string
}

interface VersionedOptions {
  expectedVersion?: string
}

interface SubmitRegressionOptions extends VersionedOptions {
  fixSummary: string
  verifier?: string
}

interface WithdrawRegressionOptions extends VersionedOptions {
  reason: string
}

interface RecordRegressionOptions extends VersionedOptions {
  result: string
  note: string
}

interface CloseBugOptions extends VersionedOptions {
  category: string
  note: string
  duplicateOf?: string
}

interface ReopenBugOptions extends VersionedOptions {
  reason: string
}

interface LinkRequirementOptions extends VersionedOptions {
  bug: string
  requirement: string
}

interface UnlinkRequirementOptions extends LinkRequirementOptions {
  reason: string
}

/** 判断字符串是否属于给定枚举取值。 */
function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return allowed.some((item) => item === value)
}

/** 校验并收窄 Bug 状态。 */
function validateBugStatus(value: string): BugStatus {
  if (!isOneOf(value, BUG_STATUSES)) {
    throw new CliError(`--status 必须是 ${BUG_STATUSES.join('、')} 之一`, 2, { code: 'INVALID_STATUS' })
  }
  return value
}

/** 校验并收窄关闭分类。 */
function validateCloseCategory(value: string): CloseCategory {
  if (!isOneOf(value, CLOSE_CATEGORIES)) {
    throw new CliError(`--category 必须是 ${CLOSE_CATEGORIES.join('、')} 之一`, 2, { code: 'INVALID_CATEGORY' })
  }
  return value
}

/** 校验并收窄回归结论。 */
function validateRegressionResult(value: string): RegressionResult {
  if (!isOneOf(value, REGRESSION_RESULTS)) {
    throw new CliError(`--result 必须是 ${REGRESSION_RESULTS.join('、')} 之一`, 2, { code: 'INVALID_RESULT' })
  }
  return value
}

/** 读取必填文本选项；空白值按缺少参数处理，避免把空字符串提交给服务端。 */
function requireOptionText(value: string | undefined, name: string): string {
  const text = value?.trim() ?? ''
  if (text.length === 0) throw new CliError(`缺少必填参数 ${name} 或值为空`, 2, { code: 'MISSING_ARGUMENT' })
  return text
}

/** 读取可选文本选项；未提供或只含空白时返回 undefined。 */
function optionalOptionText(value: string | undefined): string | undefined {
  const text = value?.trim()
  return text === undefined || text.length === 0 ? undefined : text
}

/** 解析 `--expected-version`；非正整数按参数错误处理。 */
function parseExpectedVersion(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const version = Number(value)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(version) || version < 1) {
    throw new CliError('--expected-version 必须是正整数', 2, { code: 'INVALID_VERSION' })
  }
  return version
}

/** 写请求选项：默认生成幂等键，`--idempotency-key` 用于安全重试。 */
function writeOptions(globals: GlobalOptions): ApiCallOptions {
  return { idempotencyKey: globals.idempotencyKey ?? createIdempotencyKey() }
}

/**
 * 解析动作使用的版本号：显式参数优先，否则读取当前 Bug 详情的最新版本。
 * @param client 已认证业务客户端。
 * @param bugId Bug ID。
 * @param expectedVersion 命令行提供的期望版本。
 * @returns 用于乐观锁的版本号。
 * @throws 版本参数非法时抛出参数错误；读取详情失败时向上抛出请求错误。
 */
async function resolveVersion(client: BugClient, bugId: string, expectedVersion: string | undefined): Promise<number> {
  const explicit = parseExpectedVersion(expectedVersion)
  if (explicit !== undefined) return explicit
  const detail = await client.getBug(bugId)
  return detail.data.version
}

/** 汇总全部页，直到空页或已达到服务端返回的总数；不静默截断。 */
async function collectAllPages<T>(
  fetchPage: (page: number, pageSize: number) => Promise<PageResult<T>>,
): Promise<PageResult<T>> {
  const items: T[] = []
  let requestId = ''
  let page = 1
  let total = 0
  for (;;) {
    const result = await fetchPage(page, MAX_PAGE_SIZE)
    requestId = result.requestId
    total = result.data.total
    items.push(...result.data.items)
    if (result.data.items.length === 0 || items.length >= total) break
    page += 1
  }
  return { data: { items, page: 1, pageSize: items.length, total }, requestId }
}

/** 输出分页列表：`--all` 逐页汇总，否则按全局分页参数读取单页；JSON 模式统一归一化。 */
async function printPagedList(
  context: CliContext,
  command: Command,
  fetchPage: (client: BugClient, page: number, pageSize: number) => Promise<PageResult<unknown>>,
): Promise<void> {
  const globals = command.optsWithGlobals<GlobalOptions>()
  const pagination = resolvePagination(globals)
  const business = await businessContext(command, context)
  if (pagination.all) {
    const result = await collectAllPages((page, pageSize) => fetchPage(business.client, page, pageSize))
    printBusinessResult(context, globals, result, true)
    return
  }
  const result = await fetchPage(business.client, pagination.page, pagination.pageSize)
  printBusinessResult(context, globals, result, true)
}

/** 组装列表查询参数；状态与分页在本地校验，ownerUnavailable 直接透传服务端筛选。 */
function buildBugListQuery(options: ListBugOptions): BugListQuery {
  const query: BugListQuery = {}
  const search = optionalOptionText(options.search)
  if (search !== undefined) query.search = search
  if (options.status !== undefined) query.status = validateBugStatus(options.status)
  if (options.ownerUnavailable === true) query.ownerUnavailable = true
  return query
}

/** 组装复现信息；显式复现与“无法稳定复现”互斥。 */
function buildReproduction(
  reproduction: string | undefined,
  unknown: boolean | undefined,
): ReproductionFields | undefined {
  const text = optionalOptionText(reproduction)
  if (unknown === true) {
    if (text !== undefined) {
      throw new CliError('--reproduction 与 --reproduction-unknown 不能同时使用', 2, { code: 'INVALID_REPRODUCTION' })
    }
    return { reproduction: null, reproductionUnknown: true }
  }
  if (text === undefined) return undefined
  return { reproduction: text, reproductionUnknown: false }
}

/** 组装创建请求体；可选字段只在显式提供时发送。 */
function buildCreateBugBody(options: CreateBugOptions): CreateBugBody {
  const reproduction = buildReproduction(options.reproduction, options.reproductionUnknown)
  if (reproduction === undefined) {
    throw new CliError('缺少 --reproduction，或使用 --reproduction-unknown 标注无法稳定复现', 2, {
      code: 'MISSING_REPRODUCTION',
    })
  }
  const body: CreateBugBody = {
    title: requireOptionText(options.title, '--title'),
    phenomenon: requireOptionText(options.phenomenon, '--phenomenon'),
    expectedBehavior: requireOptionText(options.expected, '--expected'),
    ...reproduction,
  }
  const evidence = optionalOptionText(options.evidence)
  if (evidence !== undefined) body.evidenceText = evidence
  const fixOwnerUserId = optionalOptionText(options.fixOwner)
  if (fixOwnerUserId !== undefined) body.fixOwnerUserId = fixOwnerUserId
  const requirementId = optionalOptionText(options.requirement)
  if (requirementId !== undefined) body.requirementIds = [requirementId]
  return body
}

/** 组装更新请求体变化项；没有任何可更新字段时拒绝请求，避免空更新。 */
function buildUpdateBugChanges(options: UpdateBugOptions): UpdateBugChanges {
  const changes: UpdateBugChanges = {}
  const title = optionalOptionText(options.title)
  if (title !== undefined) changes.title = title
  const phenomenon = optionalOptionText(options.phenomenon)
  if (phenomenon !== undefined) changes.phenomenon = phenomenon
  const expectedBehavior = optionalOptionText(options.expected)
  if (expectedBehavior !== undefined) changes.expectedBehavior = expectedBehavior
  const reproduction = buildReproduction(options.reproduction, options.reproductionUnknown)
  if (reproduction !== undefined) {
    changes.reproduction = reproduction.reproduction
    changes.reproductionUnknown = reproduction.reproductionUnknown
  }
  const evidence = optionalOptionText(options.evidence)
  if (evidence !== undefined) changes.evidenceText = evidence
  const fixOwnerUserId = optionalOptionText(options.fixOwner)
  if (fixOwnerUserId !== undefined) changes.fixOwnerUserId = fixOwnerUserId
  if (Object.keys(changes).length === 0) {
    throw new CliError('至少提供一个待更新字段', 2, { code: 'NOTHING_TO_UPDATE' })
  }
  return changes
}

/** 危险操作确认：委托给 CLI 统一确认函数。 */
async function requireDangerousConfirmation(globals: GlobalOptions): Promise<void> {
  await confirmDangerous({
    yes: globals.yes === true,
    json: globals.json === true,
    message: '确认关闭该 Bug？关闭后可再次重开。',
  })
}

async function runBugList(context: CliContext, command: Command): Promise<void> {
  const options = command.opts<ListBugOptions>()
  const query = buildBugListQuery(options)
  await printPagedList(context, command, (client, page, pageSize) =>
    client.listBugs(options.project, { ...query, page, pageSize }),
  )
}

async function runBugGet(context: CliContext, bugId: string, command: Command): Promise<void> {
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const result = await business.client.getBug(bugId)
  printBusinessResult(context, globals, result)
}

async function runBugCreate(context: CliContext, command: Command): Promise<void> {
  const options = command.opts<CreateBugOptions>()
  const body = buildCreateBugBody(options)
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const result = await business.client.createBug(options.project, body, writeOptions(globals))
  printBusinessResult(context, globals, result)
}

async function runBugUpdate(context: CliContext, bugId: string, command: Command): Promise<void> {
  const options = command.opts<UpdateBugOptions>()
  const changes = buildUpdateBugChanges(options)
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const version = await resolveVersion(business.client, bugId, options.expectedVersion)
  const result = await business.client.updateBug(bugId, { version, ...changes }, writeOptions(globals))
  printBusinessResult(context, globals, result)
}

async function runBugComments(context: CliContext, bugId: string, command: Command): Promise<void> {
  await printPagedList(context, command, (client, page, pageSize) => client.listBugComments(bugId, { page, pageSize }))
}

async function runBugActivities(context: CliContext, bugId: string, command: Command): Promise<void> {
  await printPagedList(context, command, (client, page, pageSize) =>
    client.listBugActivities(bugId, { page, pageSize }),
  )
}

async function runBugComment(context: CliContext, bugId: string, command: Command): Promise<void> {
  const options = command.opts<CommentOptions>()
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const content = await readContent(options.contentFile, context)
  if (content.trim().length === 0) throw new CliError('评论内容不能为空', 2, { code: 'EMPTY_CONTENT' })
  const result = await business.client.addBugComment(bugId, { bodyMarkdown: content }, writeOptions(globals))
  printBusinessResult(context, globals, result)
}

async function runStartFix(context: CliContext, bugId: string, command: Command): Promise<void> {
  const options = command.opts<VersionedOptions>()
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const version = await resolveVersion(business.client, bugId, options.expectedVersion)
  const result = await business.client.startBugFix(bugId, { version }, writeOptions(globals))
  printBusinessResult(context, globals, result)
}

async function runSubmitRegression(context: CliContext, bugId: string, command: Command): Promise<void> {
  const options = command.opts<SubmitRegressionOptions>()
  const fixSummary = requireOptionText(options.fixSummary, '--fix-summary')
  const verifierUserId = optionalOptionText(options.verifier)
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const version = await resolveVersion(business.client, bugId, options.expectedVersion)
  const result = await business.client.submitBugRegression(
    bugId,
    { version, fixSummary, ...(verifierUserId === undefined ? {} : { verifierUserId }) },
    writeOptions(globals),
  )
  printBusinessResult(context, globals, result)
}

async function runWithdrawRegression(context: CliContext, bugId: string, command: Command): Promise<void> {
  const options = command.opts<WithdrawRegressionOptions>()
  const reason = requireOptionText(options.reason, '--reason')
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const version = await resolveVersion(business.client, bugId, options.expectedVersion)
  const result = await business.client.withdrawBugRegression(bugId, { version, reason }, writeOptions(globals))
  printBusinessResult(context, globals, result)
}

async function runRecordRegression(context: CliContext, bugId: string, command: Command): Promise<void> {
  const options = command.opts<RecordRegressionOptions>()
  const result = validateRegressionResult(options.result)
  const note = requireOptionText(options.note, '--note')
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const version = await resolveVersion(business.client, bugId, options.expectedVersion)
  const response = await business.client.recordBugRegression(bugId, { version, result, note }, writeOptions(globals))
  printBusinessResult(context, globals, response)
}

async function runCloseBug(context: CliContext, bugId: string, command: Command): Promise<void> {
  const options = command.opts<CloseBugOptions>()
  const category = validateCloseCategory(options.category)
  const note = requireOptionText(options.note, '--note')
  const duplicateOfBugId = optionalOptionText(options.duplicateOf)
  if (category === 'duplicate' && duplicateOfBugId === undefined) {
    throw new CliError('--category duplicate 必须使用 --duplicate-of 指定原 Bug', 2, {
      code: 'MISSING_DUPLICATE_OF',
    })
  }
  if (category !== 'duplicate' && duplicateOfBugId !== undefined) {
    throw new CliError('--duplicate-of 只能与 --category duplicate 一起使用', 2, {
      code: 'UNEXPECTED_DUPLICATE_OF',
    })
  }
  const globals = command.optsWithGlobals<GlobalOptions>()
  await requireDangerousConfirmation(globals)
  const business = await businessContext(command, context)
  const version = await resolveVersion(business.client, bugId, options.expectedVersion)
  const result = await business.client.closeBug(
    bugId,
    { version, category, note, ...(duplicateOfBugId === undefined ? {} : { duplicateOfBugId }) },
    writeOptions(globals),
  )
  printBusinessResult(context, globals, result)
}

async function runReopenBug(context: CliContext, bugId: string, command: Command): Promise<void> {
  const options = command.opts<ReopenBugOptions>()
  const reason = requireOptionText(options.reason, '--reason')
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const version = await resolveVersion(business.client, bugId, options.expectedVersion)
  const result = await business.client.reopenBug(bugId, { version, reason }, writeOptions(globals))
  printBusinessResult(context, globals, result)
}

async function runLinkRequirement(context: CliContext, command: Command): Promise<void> {
  const options = command.opts<LinkRequirementOptions>()
  const bugId = requireOptionText(options.bug, '--bug')
  const requirementId = requireOptionText(options.requirement, '--requirement')
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const version = await resolveVersion(business.client, bugId, options.expectedVersion)
  const result = await business.client.linkBugRequirement(bugId, { version, requirementId }, writeOptions(globals))
  printBusinessResult(context, globals, result)
}

async function runUnlinkRequirement(context: CliContext, command: Command): Promise<void> {
  const options = command.opts<UnlinkRequirementOptions>()
  const bugId = requireOptionText(options.bug, '--bug')
  const requirementId = requireOptionText(options.requirement, '--requirement')
  const reason = requireOptionText(options.reason, '--reason')
  const globals = command.optsWithGlobals<GlobalOptions>()
  const business = await businessContext(command, context)
  const version = await resolveVersion(business.client, bugId, options.expectedVersion)
  const result = await business.client.unlinkBugRequirement(
    bugId,
    requirementId,
    { version, reason },
    writeOptions(globals),
  )
  printBusinessResult(context, globals, result)
}

function registerBugQueries(bug: Command, context: CliContext): void {
  bug
    .command('list')
    .description('列出项目 Bug，支持搜索、状态、负责人不可用筛选与分页')
    .requiredOption('--project <projectId>', '项目 ID')
    .option('--search <text>', '按标题关键词搜索')
    .option('--status <status>', '状态：pending、in_fix、in_regression、resolved、closed')
    .option('--owner-unavailable', '只列出负责人不可用的 Bug')
    .action(async (_options: unknown, command: Command) => {
      await runBugList(context, command)
    })

  bug
    .command('get')
    .description('读取 Bug 详情，包含回归历史、关联需求与代码关联')
    .argument('<bugId>', 'Bug ID')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runBugGet(context, bugId, command)
    })

  bug
    .command('comments')
    .description('读取 Bug 评论列表')
    .argument('<bugId>', 'Bug ID')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runBugComments(context, bugId, command)
    })

  bug
    .command('activities')
    .description('读取 Bug 活动列表')
    .argument('<bugId>', 'Bug ID')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runBugActivities(context, bugId, command)
    })

  bug
    .command('comment')
    .description('追加 Bug 评论；长文本从文件读取，路径为 - 时读取标准输入')
    .argument('<bugId>', 'Bug ID')
    .requiredOption('--content-file <path>', '评论 Markdown 文件路径；- 表示标准输入')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runBugComment(context, bugId, command)
    })
}

function registerBugEditing(bug: Command, context: CliContext): void {
  bug
    .command('create')
    .description('创建 Bug，支持关联需求、指定修复负责人')
    .requiredOption('--project <projectId>', '项目 ID')
    .requiredOption('--title <title>', 'Bug 标题')
    .requiredOption('--phenomenon <text>', '现象描述')
    .requiredOption('--expected <text>', '预期行为')
    .option('--reproduction <text>', '复现步骤')
    .option('--reproduction-unknown', '无法稳定复现时标注，与 --reproduction 互斥')
    .option('--evidence <text>', '证据文本')
    .option('--fix-owner <userId>', '修复负责人用户 ID')
    .option('--requirement <requirementId>', '创建时关联的需求 ID')
    .action(async (_options: unknown, command: Command) => {
      await runBugCreate(context, command)
    })

  bug
    .command('update')
    .description('编辑 Bug 允许修改的字段')
    .argument('<bugId>', 'Bug ID')
    .option('--expected-version <version>', '期望的当前版本号；省略时先读取最新版本')
    .option('--title <title>', 'Bug 标题')
    .option('--phenomenon <text>', '现象描述')
    .option('--expected <text>', '预期行为')
    .option('--reproduction <text>', '复现步骤')
    .option('--reproduction-unknown', '无法稳定复现时标注，与 --reproduction 互斥')
    .option('--evidence <text>', '证据文本')
    .option('--fix-owner <userId>', '修复负责人用户 ID')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runBugUpdate(context, bugId, command)
    })
}

function registerBugFlowCommands(bug: Command, context: CliContext): void {
  bug
    .command('start-fix')
    .description('开始修复待处理 Bug')
    .argument('<bugId>', 'Bug ID')
    .option('--expected-version <version>', '期望的当前版本号；省略时先读取最新版本')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runStartFix(context, bugId, command)
    })

  bug
    .command('submit-regression')
    .description('提交回归验证，记录修复说明与回归负责人')
    .argument('<bugId>', 'Bug ID')
    .requiredOption('--fix-summary <text>', '修复说明')
    .option('--verifier <userId>', '回归负责人用户 ID；省略时由平台按规则选择')
    .option('--expected-version <version>', '期望的当前版本号；省略时先读取最新版本')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runSubmitRegression(context, bugId, command)
    })

  bug
    .command('withdraw-regression')
    .description('撤回已提交的回归验证，需要填写原因')
    .argument('<bugId>', 'Bug ID')
    .requiredOption('--reason <text>', '撤回原因')
    .option('--expected-version <version>', '期望的当前版本号；省略时先读取最新版本')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runWithdrawRegression(context, bugId, command)
    })

  bug
    .command('record-regression')
    .description('记录回归验证结论：通过或失败')
    .argument('<bugId>', 'Bug ID')
    .requiredOption('--result <result>', '回归结论：passed 或 failed')
    .requiredOption('--note <text>', '回归结论说明')
    .option('--expected-version <version>', '期望的当前版本号；省略时先读取最新版本')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runRecordRegression(context, bugId, command)
    })

  bug
    .command('close')
    .description('关闭 Bug，需要分类与说明；危险操作非交互环境须使用 --yes')
    .argument('<bugId>', 'Bug ID')
    .requiredOption('--category <category>', '关闭分类：duplicate、not_bug 或 wont_fix')
    .requiredOption('--note <text>', '关闭说明')
    .option('--duplicate-of <bugId>', '重复 Bug 的原 Bug ID，仅用于 --category duplicate')
    .option('--expected-version <version>', '期望的当前版本号；省略时先读取最新版本')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runCloseBug(context, bugId, command)
    })

  bug
    .command('reopen')
    .description('重开已解决或已关闭的 Bug，需要填写原因')
    .argument('<bugId>', 'Bug ID')
    .requiredOption('--reason <text>', '重开原因')
    .option('--expected-version <version>', '期望的当前版本号；省略时先读取最新版本')
    .action(async (bugId: string, _options: unknown, command: Command) => {
      await runReopenBug(context, bugId, command)
    })
}

function registerBugRelationCommands(bug: Command, context: CliContext): void {
  bug
    .command('link-requirement')
    .description('关联 Bug 与需求')
    .requiredOption('--bug <bugId>', 'Bug ID')
    .requiredOption('--requirement <requirementId>', '需求 ID')
    .option('--expected-version <version>', '期望的当前版本号；省略时先读取最新版本')
    .action(async (_options: unknown, command: Command) => {
      await runLinkRequirement(context, command)
    })

  bug
    .command('unlink-requirement')
    .description('解除 Bug 与需求的关联，需要填写原因')
    .requiredOption('--bug <bugId>', 'Bug ID')
    .requiredOption('--requirement <requirementId>', '需求 ID')
    .requiredOption('--reason <text>', '解除原因')
    .option('--expected-version <version>', '期望的当前版本号；省略时先读取最新版本')
    .action(async (_options: unknown, command: Command) => {
      await runUnlinkRequirement(context, command)
    })
}

/**
 * 注册 `devops bug` 命令组，覆盖 Bug 查询、创建编辑、状态流转与需求关联。
 * @param program 已定义全局选项的 CLI 根命令。
 * @param context CLI 上下文，提供环境变量、标准输入与输出通道。
 * @returns 无返回值；命令内错误由统一入口转换为退出码。
 * @remarks 所有操作通过后端 API 完成；动作按 `--expected-version` 或详情版本做乐观锁，
 * 写请求默认携带幂等键；关闭 Bug 需要 `--yes` 或交互确认。
 */
export function registerBugCommands(program: Command, context: CliContext): void {
  const bug = program.command('bug').description('Bug 查询、创建编辑、状态流转与需求关联')
  registerBugQueries(bug, context)
  registerBugEditing(bug, context)
  registerBugFlowCommands(bug, context)
  registerBugRelationCommands(bug, context)
}
