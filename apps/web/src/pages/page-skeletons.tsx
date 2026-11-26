import { Skeleton, SkeletonRegion } from '@/shared/ui/controls/skeleton'
import {
  BarometerSkeleton,
  CardGridSkeleton,
  CompactListSkeleton,
  DetailSheetSkeleton,
  FormSectionSkeleton,
  LogLinesSkeleton,
  TableSkeleton,
} from '@/shared/ui/page-skeleton'
import { CollaborationPageSkeleton } from '@/pages/collaboration/conversation-loading'

/**
 * 认证页（登录、接受邀请、找回密码、重置密码）专属双栏骨架。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合 `.login-shell` 左右分栏的加载骨架。
 */
export function AuthPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="认证页面加载中" delay={delay} className="login-shell">
      <section className="login-stage hidden lg:flex" aria-hidden="true">
        <div className="flex items-center gap-3">
          <Skeleton width={29} height={29} borderRadius="var(--radius-md)" />
          <Skeleton width={84} height={18} />
        </div>
        <div className="space-y-4">
          <Skeleton width={260} height={32} />
          <Skeleton width={220} height={32} />
          <Skeleton width={320} height={15} />
        </div>
        <div className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton width={36} height={36} borderRadius="var(--radius-md)" />
            <div className="flex-1 space-y-1.5">
              <Skeleton width="45%" height={15} />
              <Skeleton width="30%" height={11} />
            </div>
          </div>
          <CompactListSkeleton rows={3} leading="avatar" delay={0} />
        </div>
      </section>
      <section className="flex flex-1 items-center justify-center p-6" aria-hidden="true">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 space-y-6">
          <div className="space-y-2">
            <Skeleton width={168} height={24} />
            <Skeleton width={228} height={14} />
          </div>
          <FormSectionSkeleton fields={2} delay={0} />
          <Skeleton width="100%" height={40} borderRadius="var(--radius-md)" />
          <div className="flex justify-between">
            <Skeleton width={92} height={13} />
            <Skeleton width={80} height={13} />
          </div>
        </div>
      </section>
    </SkeletonRegion>
  )
}

/**
 * 项目列表页专属骨架：页头 + 项目晴雨表 + 筛选栏 + 项目卡片网格。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合项目首页真实布局的骨架。
 */
export function ProjectListPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="页面加载中" delay={delay}>
      <header className="page-head" aria-hidden="true">
        <div className="row">
          <Skeleton width={64} height={24} />
          <span className="spacer" />
          <Skeleton width={92} height={34} borderRadius="var(--radius-md)" />
          <Skeleton width={104} height={34} borderRadius="var(--radius-md)" />
        </div>
      </header>
      <div className="catalog project-home space-y-6" aria-hidden="true">
        <BarometerSkeleton delay={0} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton width={260} height={36} borderRadius="var(--radius-md)" />
          <div className="flex items-center gap-2">
            <Skeleton width={86} height={36} borderRadius="var(--radius-md)" />
            <Skeleton width={36} height={36} borderRadius="var(--radius-md)" />
          </div>
        </div>
        <CardGridSkeleton count={6} iconShape="square" lines={2} delay={0} />
      </div>
    </SkeletonRegion>
  )
}

/**
 * 项目需求列表专属骨架：状态筛选 + 搜索 + 新建按钮 + 4 列事项表格。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合需求工作区表格的骨架。
 */
export function RequirementsPageSkeleton({ delay }: { delay?: number }) {
  return (
    <TableSkeleton
      label="需求列表加载中"
      delay={delay}
      toolbar
      rows={7}
      columns={['46%', '18%', '18%', '18%']}
      className="project-tab-panel"
    />
  )
}

/**
 * 项目 Bug 列表专属骨架：状态筛选 + 搜索 + 新建按钮 + 4 列缺陷表格。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合 Bug 工作区表格的骨架。
 */
export function BugsPageSkeleton({ delay }: { delay?: number }) {
  return (
    <TableSkeleton
      label="Bug 列表加载中"
      delay={delay}
      toolbar
      rows={7}
      columns={['46%', '18%', '18%', '18%']}
      className="project-tab-panel"
    />
  )
}

/**
 * 项目代码浏览页专属骨架：仓库分支操作条 + 左侧文件树 + 右侧代码预览区。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合代码浏览分栏结构的骨架。
 */
export function CodePageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="代码页加载中" delay={delay} className="project-tab-panel space-y-4">
      <div className="flex flex-wrap items-center gap-2.5" aria-hidden="true">
        <Skeleton width={196} height={34} borderRadius="var(--radius-md)" />
        <Skeleton width={132} height={34} borderRadius="var(--radius-md)" />
        <span className="spacer" />
        <Skeleton width={96} height={34} borderRadius="var(--radius-md)" />
        <Skeleton width={108} height={34} borderRadius="var(--radius-md)" />
      </div>
      <div className="grid gap-4 lg:grid-cols-4" aria-hidden="true">
        <div className="rounded-lg border border-border p-3 space-y-3">
          {['72%', '56%', '84%', '64%', '78%', '52%', '68%', '60%'].map((width, index) => (
            <div key={index} className={index % 3 === 1 ? 'pl-4' : undefined}>
              <Skeleton width={width} height={14} />
            </div>
          ))}
        </div>
        <div className="space-y-3 lg:col-span-3">
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5">
            <Skeleton width={180} height={14} />
            <Skeleton width={76} height={24} borderRadius="var(--radius-sm)" />
          </div>
          <LogLinesSkeleton lines={12} delay={0} />
        </div>
      </div>
    </SkeletonRegion>
  )
}

/**
 * 项目 Pull Request 页专属骨架：PR 工具栏 + 状态筛选 + PR 列表行。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合 PR 列表页结构的骨架。
 */
export function PrsPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="PR 列表加载中" delay={delay} className="project-tab-panel space-y-4">
      <div className="flex flex-wrap items-center gap-2.5" aria-hidden="true">
        <Skeleton width={240} height={36} borderRadius="var(--radius-md)" />
        <Skeleton width={148} height={36} borderRadius="var(--radius-md)" />
        <Skeleton width={116} height={36} borderRadius="var(--radius-md)" />
        <Skeleton width={116} height={36} borderRadius="var(--radius-md)" />
      </div>
      <CompactListSkeleton rows={6} leading="icon" trailing bordered delay={0} />
    </SkeletonRegion>
  )
}

/**
 * 项目流水线页专属骨架：上下文条 + 左侧工作流目录 + 右侧指标与运行流卡片。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合流水线双栏工作台结构的骨架。
 */
export function PipelinesPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="工作流加载中" delay={delay} className="project-tab-panel space-y-4">
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 p-3"
        aria-hidden="true"
      >
        <div className="flex items-center gap-2.5">
          <Skeleton width={92} height={28} borderRadius="var(--radius-md)" />
          <Skeleton width={168} height={18} />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton width={132} height={30} borderRadius="var(--radius-md)" />
          <Skeleton width={84} height={30} borderRadius="var(--radius-md)" />
          <Skeleton width={92} height={30} borderRadius="var(--radius-md)" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-12" aria-hidden="true">
        <div className="space-y-2.5 rounded-xl border border-border bg-secondary/40 p-3 lg:col-span-3">
          <Skeleton width={108} height={14} />
          <CompactListSkeleton rows={4} leading="icon" delay={0} />
        </div>
        <div className="space-y-4 lg:col-span-9">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="space-y-2 rounded-lg border border-border bg-card p-3">
                <Skeleton width={76} height={12} />
                <Skeleton width={64} height={22} />
              </div>
            ))}
          </div>
          <CompactListSkeleton rows={4} leading="icon" trailing bordered delay={0} />
        </div>
      </div>
    </SkeletonRegion>
  )
}

/**
 * 流水线运行详情页专属骨架：页头 + 紧凑元信息条 + 阶段过程流 + 左侧步骤树与日志终端。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合运行详情页结构的骨架。
 */
export function PipelineRunPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="页面加载中" delay={delay} className="project-tab-panel space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3" aria-hidden="true">
        <div className="space-y-2">
          <Skeleton width={180} height={13} />
          <div className="flex items-center gap-2.5">
            <Skeleton width={72} height={24} borderRadius="var(--radius-full)" />
            <Skeleton width={200} height={22} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton width={76} height={32} borderRadius="var(--radius-md)" />
          <Skeleton width={88} height={32} borderRadius="var(--radius-md)" />
        </div>
      </div>
      <div className="grid gap-3 rounded-lg border border-border bg-secondary/40 p-3 sm:grid-cols-5" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((cell) => (
          <div key={cell} className="space-y-1.5">
            <Skeleton width={72} height={11} />
            <Skeleton width={116} height={14} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-4" aria-hidden="true">
        {[0, 1, 2, 3].map((step) => (
          <Skeleton key={step} width={148} height={34} borderRadius="var(--radius-md)" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-12" aria-hidden="true">
        <div className="rounded-xl border border-border bg-secondary/40 p-3 lg:col-span-3">
          <CompactListSkeleton rows={5} leading="icon" delay={0} />
        </div>
        <div className="lg:col-span-9">
          <LogLinesSkeleton lines={10} delay={0} />
        </div>
      </div>
    </SkeletonRegion>
  )
}

/**
 * 项目产物与版本页专属骨架：视图页签 + 三环境运行版本卡 + 产物筛选与表格。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合产物与版本页结构的骨架。
 */
export function ArtifactsPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="产物与版本加载中" delay={delay} className="project-tab-panel space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3" aria-hidden="true">
        <div className="flex items-center gap-2">
          <Skeleton width={92} height={34} borderRadius="var(--radius-md)" />
          <Skeleton width={104} height={34} borderRadius="var(--radius-md)" />
        </div>
        <Skeleton width={108} height={34} borderRadius="var(--radius-md)" />
      </div>
      <div className="grid gap-3 md:grid-cols-3" aria-hidden="true">
        {[0, 1, 2].map((card) => (
          <div key={card} className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <Skeleton width={64} height={14} />
              <Skeleton width={56} height={22} borderRadius="var(--radius-full)" />
            </div>
            <Skeleton width={156} height={20} />
            <Skeleton width={120} height={12} />
          </div>
        ))}
      </div>
      <TableSkeleton rows={5} columns={['30%', '16%', '12%', '18%', '10%', '14%']} delay={0} />
    </SkeletonRegion>
  )
}

/**
 * 项目环境变量页专属骨架：开发/测试/生产三段切换 + 新增按钮 + 变量键值表。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合环境变量页结构的骨架。
 */
export function EnvironmentPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="环境变量加载中" delay={delay} className="project-tab-panel space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3" aria-hidden="true">
        <div className="flex items-center gap-2">
          <Skeleton width={76} height={32} borderRadius="var(--radius-md)" />
          <Skeleton width={76} height={32} borderRadius="var(--radius-md)" />
          <Skeleton width={76} height={32} borderRadius="var(--radius-md)" />
        </div>
        <Skeleton width={96} height={34} borderRadius="var(--radius-md)" />
      </div>
      <TableSkeleton rows={5} columns={['28%', '18%', '34%', '20%']} delay={0} />
    </SkeletonRegion>
  )
}

/**
 * 根据项目子路径返回对应的项目子页骨架。
 * @param pathname 当前路由路径。
 * @returns 子页专属骨架。
 */
function ProjectSubpageSkeleton({ pathname }: { pathname: string }) {
  if (/\/projects\/[^/]+\/bugs(?:\/|$)/.test(pathname)) return <BugsPageSkeleton delay={0} />
  if (/\/projects\/[^/]+\/code(?:\/|$)/.test(pathname)) return <CodePageSkeleton delay={0} />
  if (/\/projects\/[^/]+\/prs(?:\/|$)/.test(pathname)) return <PrsPageSkeleton delay={0} />
  if (/\/projects\/[^/]+\/pipelines\/[^/]+/.test(pathname)) return <PipelineRunPageSkeleton delay={0} />
  if (/\/projects\/[^/]+\/pipelines(?:\/|$)/.test(pathname)) return <PipelinesPageSkeleton delay={0} />
  if (/\/projects\/[^/]+\/artifacts(?:\/|$)/.test(pathname)) return <ArtifactsPageSkeleton delay={0} />
  if (/\/projects\/[^/]+\/environment(?:\/|$)/.test(pathname)) return <EnvironmentPageSkeleton delay={0} />
  return <RequirementsPageSkeleton delay={0} />
}

/**
 * 项目工作区布局骨架：面包屑 + 项目标题与状态 + 7 个功能页签 + 当前子页骨架。
 * @param props.pathname 当前路径，用于匹配对应的子页内容骨架。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合 `.project-header` + `.content` 的完整项目骨架。
 */
export function ProjectLayoutSkeleton({ pathname = '', delay }: { pathname?: string; delay?: number }) {
  return (
    <SkeletonRegion label="页面加载中" delay={delay}>
      <header className="project-header space-y-3" aria-hidden="true">
        <div className="flex items-center gap-2">
          <Skeleton width={40} height={14} />
          <Skeleton width={56} height={14} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Skeleton width={20} height={20} borderRadius="var(--radius-sm)" />
            <Skeleton width={148} height={22} />
            <Skeleton width={56} height={22} borderRadius="var(--radius-full)" />
          </div>
          <Skeleton width={32} height={32} borderRadius="var(--radius-md)" />
        </div>
        <div className="flex items-center gap-5 pt-1">
          {[42, 36, 42, 30, 52, 76, 64].map((width, index) => (
            <Skeleton key={index} width={width} height={15} />
          ))}
        </div>
      </header>
      <div className="content">
        <ProjectSubpageSkeleton pathname={pathname} />
      </div>
    </SkeletonRegion>
  )
}

/**
 * 智能体目录页专属骨架：下划线筛选页签 + 搜索创建栏 + 带圆形头像的智能体表格。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合智能体目录页结构的骨架。
 */
export function BotsPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="智能体列表加载中" delay={delay} className="space-y-4">
      <header className="agent-page-header" aria-hidden="true">
        <div className="agent-filters items-center">
          <div className="flex flex-1 items-center gap-6">
            <Skeleton width={76} height={16} />
            <Skeleton width={68} height={16} />
          </div>
          <Skeleton width={220} height={34} borderRadius="var(--radius-md)" />
          <Skeleton width={108} height={36} borderRadius="var(--radius-md)" />
        </div>
      </header>
      <div className="agent-catalog">
        <CompactListSkeleton rows={6} leading="avatar" trailing bordered delay={0} />
      </div>
    </SkeletonRegion>
  )
}

/**
 * 技能库页专属骨架：页头 + 分类胶囊组 + 搜索框 + 技能卡片网格。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合技能库页结构的骨架。
 */
export function SkillsPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="技能库加载中" delay={delay}>
      <header className="page-head skills-header" aria-hidden="true">
        <Skeleton width={72} height={24} />
        <Skeleton width={104} height={34} borderRadius="var(--radius-md)" />
      </header>
      <div className="catalog skills-catalog space-y-5" aria-hidden="true">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {[54, 68, 72, 64, 68].map((width, index) => (
              <Skeleton key={index} width={width} height={30} borderRadius="var(--radius-full)" />
            ))}
          </div>
          <Skeleton width={220} height={34} borderRadius="var(--radius-md)" />
        </div>
        <CardGridSkeleton count={6} iconShape="square" lines={2} delay={0} />
      </div>
    </SkeletonRegion>
  )
}

/**
 * Bot 记忆管理页专属骨架：顶部筛选与操作工具栏 + 纵向记忆卡片流。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合记忆管理页结构的骨架。
 */
export function BotMemoryPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="记忆加载中" delay={delay} className="work-padding space-y-4">
      <div className="flex flex-wrap items-center gap-2.5" aria-hidden="true">
        <Skeleton width={168} height={36} borderRadius="var(--radius-md)" />
        <Skeleton width={120} height={36} borderRadius="var(--radius-md)" />
        <Skeleton width={210} height={36} borderRadius="var(--radius-md)" />
        <span className="spacer" />
        <Skeleton width={96} height={36} borderRadius="var(--radius-md)" />
      </div>
      <div className="space-y-3" aria-hidden="true">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="memory-card space-y-3">
            <div className="flex items-center gap-2.5">
              <Skeleton circle width={24} height={24} />
              <Skeleton width={84} height={14} />
              <Skeleton width={56} height={20} borderRadius="var(--radius-full)" />
              <Skeleton width={44} height={20} borderRadius="var(--radius-full)" />
            </div>
            <Skeleton width="92%" height={13} />
            <Skeleton width="68%" height={13} />
            <Skeleton width={140} height={11} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  )
}

/**
 * 提示模板页专属骨架：标题 + 搜索与新建工具栏 + 模板行卡片。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合提示模板页结构的骨架。
 */
export function PromptTemplatesPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="提示模板加载中" delay={delay} className="work-padding space-y-4">
      <header className="work-header" aria-hidden="true">
        <Skeleton width={96} height={24} />
      </header>
      <div className="work-toolbar flex-wrap" aria-hidden="true">
        <Skeleton width={220} height={36} borderRadius="var(--radius-md)" />
        <span className="spacer" />
        <Skeleton width={96} height={36} borderRadius="var(--radius-md)" />
      </div>
      <CompactListSkeleton rows={5} trailing bordered delay={0} />
    </SkeletonRegion>
  )
}

/**
 * 能力中心布局骨架：顶部 4 项导航 + 对应子页骨架。
 * @param props.pathname 当前路径。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合能力中心结构的骨架。
 */
export function CapabilitiesLayoutSkeleton({ pathname = '', delay }: { pathname?: string; delay?: number }) {
  const renderChild = () => {
    if (pathname.startsWith('/capabilities/skills')) return <SkillsPageSkeleton delay={0} />
    if (pathname.startsWith('/capabilities/memory')) return <BotMemoryPageSkeleton delay={0} />
    if (pathname.startsWith('/capabilities/prompt-templates')) return <PromptTemplatesPageSkeleton delay={0} />
    return <BotsPageSkeleton delay={0} />
  }
  return (
    <SkeletonRegion label="页面加载中" delay={delay} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <nav className="capability-nav" aria-hidden="true">
        {[56, 48, 40, 68].map((width, index) => (
          <div key={index} className="capability-tab">
            <Skeleton width={width} height={14} />
          </div>
        ))}
      </nav>
      {renderChild()}
    </SkeletonRegion>
  )
}

/**
 * 凭据库页专属骨架：钥匙串左右分栏（左侧分类与凭据列表 + 右侧凭据详情与版本）。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合凭据库左右分栏结构的骨架。
 */
export function VaultPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="凭据库加载中" delay={delay} className="catalog grid gap-6 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-4" aria-hidden="true">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <Skeleton width="100%" height={36} borderRadius="var(--radius-md)" />
          </div>
          <Skeleton width={36} height={36} borderRadius="var(--radius-md)" />
        </div>
        <div className="flex flex-wrap gap-2">
          {[48, 64, 56, 72].map((width, index) => (
            <Skeleton key={index} width={width} height={28} borderRadius="var(--radius-full)" />
          ))}
        </div>
        <CompactListSkeleton rows={6} leading="icon" bordered delay={0} />
      </div>
      <div className="rounded-xl border border-border bg-card lg:col-span-8" aria-hidden="true">
        <DetailSheetSkeleton propertyRows={4} delay={0} />
      </div>
    </SkeletonRegion>
  )
}

/**
 * 个人设置页专属骨架：标题 + 2 个页签 + 头像资料 + 配色模式三卡片 + 安全项。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合个人页面结构的骨架。
 */
export function ProfilePageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="个人页面加载中" delay={delay} className="catalog settings-page space-y-6">
      <header className="page-head border-b-0 p-0" aria-hidden="true">
        <Skeleton width={96} height={24} />
      </header>
      <div className="flex items-center gap-2" aria-hidden="true">
        <Skeleton width={88} height={34} borderRadius="var(--radius-md)" />
        <Skeleton width={96} height={34} borderRadius="var(--radius-md)" />
      </div>
      <div className="settings-form-width space-y-6" aria-hidden="true">
        <div className="flex items-center gap-3">
          <Skeleton circle width={44} height={44} />
          <div className="space-y-1.5">
            <Skeleton width={116} height={16} />
            <Skeleton width={172} height={12} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((card) => (
            <Skeleton key={card} width="100%" height={104} borderRadius="var(--radius-lg)" />
          ))}
        </div>
        <FormSectionSkeleton fields={2} delay={0} />
      </div>
    </SkeletonRegion>
  )
}

/**
 * 团队设置页专属骨架：团队身份头 + 4 个分组页签 + 成员权限表格。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合团队设置页结构的骨架。
 */
export function TeamSettingsPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="团队管理加载中" delay={delay} className="catalog settings-page team-admin space-y-6">
      <header className="team-page-head" aria-hidden="true">
        <div className="team-identity">
          <Skeleton width={40} height={40} borderRadius="var(--radius-md)" />
          <div className="space-y-1.5">
            <Skeleton width={132} height={20} />
            <Skeleton width={216} height={12} />
          </div>
        </div>
        <Skeleton width={84} height={34} borderRadius="var(--radius-md)" />
      </header>
      <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
        {[92, 92, 84, 92].map((width, index) => (
          <Skeleton key={index} width={width} height={34} borderRadius="var(--radius-md)" />
        ))}
      </div>
      <TableSkeleton rows={5} columns={['32%', '26%', '22%', '20%']} delay={0} />
    </SkeletonRegion>
  )
}

/**
 * 执行节点管理页专属骨架：标题说明与新建按钮 + 节点状态表格。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合执行节点管理页结构的骨架。
 */
export function PipelineNodesPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="执行节点加载中" delay={delay} className="catalog space-y-8">
      <header className="row spread flex-wrap gap-3" aria-hidden="true">
        <div className="space-y-2">
          <Skeleton width={96} height={24} />
          <Skeleton width={320} height={13} />
        </div>
        <Skeleton width={116} height={36} borderRadius="var(--radius-md)" />
      </header>
      <TableSkeleton rows={5} columns={['26%', '18%', '24%', '16%', '16%']} delay={0} />
    </SkeletonRegion>
  )
}

/**
 * 平台管理页专属骨架：平台管理页头 + 储存桶配置表格。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合平台管理页结构的骨架。
 */
export function PlatformManagementPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="平台管理加载中" delay={delay} className="content space-y-5 pb-6">
      <header className="page-head px-0" aria-hidden="true">
        <Skeleton width={96} height={24} />
      </header>
      <TableSkeleton toolbar rows={4} columns={['28%', '18%', '24%', '15%', '15%']} delay={0} />
    </SkeletonRegion>
  )
}

/**
 * 系统状态页专属骨架：联通概览卡 + 检查指标项列表。
 * @param props.delay 延迟时长（毫秒）。
 * @returns 贴合系统状态页结构的骨架。
 */
export function SystemStatusPageSkeleton({ delay }: { delay?: number }) {
  return (
    <SkeletonRegion label="系统状态加载中" delay={delay} className="catalog space-y-5">
      <div className="rounded-xl border border-border bg-card p-6 space-y-4" aria-hidden="true">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Skeleton circle width={36} height={36} />
            <div className="space-y-1.5">
              <Skeleton width={180} height={18} />
              <Skeleton width={260} height={13} />
            </div>
          </div>
          <Skeleton width={88} height={34} borderRadius="var(--radius-md)" />
        </div>
        <div className="grid gap-3 pt-2 sm:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-lg border border-border p-3.5 space-y-2">
              <Skeleton width={84} height={12} />
              <Skeleton width={112} height={16} />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  )
}

/**
 * 按当前路由路径渲染对应的页面专属骨架，避免所有路由共享同一种占位样式。
 * @param props.pathname 当前浏览器路由路径。
 * @param props.delay 延迟时长（毫秒）；外层已包 DelayedLoading 时传 0。
 * @returns 与目标路由布局一一对应的页面骨架。
 */
export function RoutePageSkeleton({ pathname, delay }: { pathname: string; delay?: number }) {
  if (pathname === '/' || pathname === '/collaboration' || pathname.startsWith('/collaboration/')) {
    return <CollaborationPageSkeleton delay={delay} />
  }
  if (/^\/projects\/[^/]+/.test(pathname)) return <ProjectLayoutSkeleton pathname={pathname} delay={delay} />
  if (pathname === '/projects') return <ProjectListPageSkeleton delay={delay} />
  if (pathname === '/capabilities' || pathname.startsWith('/capabilities/')) {
    return <CapabilitiesLayoutSkeleton pathname={pathname} delay={delay} />
  }
  if (pathname === '/vault') return <VaultPageSkeleton delay={delay} />
  if (pathname === '/settings/profile') return <ProfilePageSkeleton delay={delay} />
  if (pathname === '/settings/team') return <TeamSettingsPageSkeleton delay={delay} />
  if (pathname === '/settings/pipeline-nodes') return <PipelineNodesPageSkeleton delay={delay} />
  if (pathname === '/platform') return <PlatformManagementPageSkeleton delay={delay} />
  if (pathname === '/system/status') return <SystemStatusPageSkeleton delay={delay} />
  return <ProjectListPageSkeleton delay={delay} />
}
