# DevOps 项目模块与功能图

本文用三张图整理整个项目的模块职责、功能入口和逻辑区域，供需求确认与开发拆分使用。范围覆盖完整 MVP；版本分配按 2026-11-10 调整后的顺序：V0.4b 前置，Bots 后移 V0.5，运维后移 V0.6。图中的功能不代表已经实现，状态以[需求版本规划](release-plan.md)为准。

业务规则以[产品需求](mvp.md)为准，模块编号和版本范围以[需求版本规划](release-plan.md)为准，首版细节见 [V0.1 需求细化](v0.1.md)。图内 Mermaid 文本可直接编辑，在支持 Mermaid 的阅读器中预览。

## 1. 模块全景图

全项目分为 15 个业务模块。连线表示分类归属，不表示调用关系或开发顺序。各节点标出的版本是 2026-11-10 调整后的首次交付版本；“已交付”表示对应版本已完成，未标注的后续节点尚未实现。

```mermaid
flowchart LR
    platform["DevOps 平台"]
    platform --- organization["组织与权限"]
    platform --- research["项目研发"]
    platform --- collaboration["协作与任务"]
    platform --- capability["能力管理"]
    platform --- credential["凭据配置"]
    platform --- operation["运维治理"]

    organization --- m01["M01 身份、团队与权限 · V0.1 已交付"]
    research --- m02["M02 项目、服务与环境目录 · V0.1／V0.2 已交付"]
    research --- m03["M03 需求管理 · V0.1 已交付"]
    research --- m04["M04 Bug 与回归 · V0.1 内部流程／V0.4b 远端关联"]
    research --- m05["M05 Git 与代码关联 · V0.1／V0.2 已交付／V0.4b 写入"]
    research --- m06["M06 交付、流水线与版本 · V0.2／V0.4a 已交付／V0.4b 部署"]
    collaboration --- m08["M08 会话、群组与工作标签 · V0.5"]
    collaboration --- m09["M09 任务、运行与结果验收 · V0.5"]
    collaboration --- m15["M15 通知与待处理汇总 · V0.5 站内／V0.6 外部"]
    capability --- m07["M07 Bot 定义与配置 · V0.5"]
    capability --- m10["M10 Skills、模板与记忆 · V0.3 阶段 A 已交付／V0.5"]
    capability --- m12["M12 连接、执行节点与项目工具 · V0.1 Git／V0.4b 写操作"]
    credential --- m11["M11 凭据与环境配置 · V0.1 Git 凭据保护／V0.5 配置请求"]
    operation --- m13["M13 变更与发布 · V0.4b"]
    operation --- m14["M14 运行事件与值守 · V0.6"]

    classDef root fill:#15324F,color:#FFFFFF,stroke:#15324F
    classDef domain fill:#F1F5F9,color:#0F172A,stroke:#94A3B8
    classDef first fill:#DBEAFE,color:#172554,stroke:#3B82F6
    classDef later fill:#FFFFFF,color:#334155,stroke:#94A3B8
    class platform root
    class organization,research,collaboration,capability,credential,operation domain
    class m01,m02,m03,m04,m05,m06,m10,m11,m12 first
    class m07,m08,m09,m13,m14,m15 later
```

V0.1 已完成团队、项目、需求、内部 Bug、真实 Git 关联及人工提测回归。服务与环境、完整代码浏览和交付在 V0.2 补齐；内置流水线在 V0.4a 交付。2026-11-10 调整后，V0.4b 先完成流水线部署与产品发布，Bot 协作后移 V0.5，事件值守与外部协作后移 V0.6，V1.0 核对完整 MVP。凭据保护和权限校验随首次接入交付，不等待完整管理页面。

2026-11-10 顺序调整：V0.4b 的发布主链路包含 M13 的变更计划、人工放行、执行与版本验证；运行事件与值守（M14）、外部通知与客户反馈后移 V0.6；Bot 相关模块（M07、M08、M09、M10 阶段 B、M15 站内）后移 V0.5。MVP 范围不变，只是交付顺序调整。

## 2. 功能分解图

按用户使用入口展开功能。连线表示“包含”，不表示功能自动触发后续动作。一级导航为项目、协作、运维、能力、凭据库；团队与账号位于全局管理入口。功能分组用于阅读，不新增或重排现有页面页签。

```mermaid
flowchart LR
    app["DevOps 功能入口"]
    app --- projects["项目"]
    app --- chats["协作"]
    app --- operations["运维"]
    app --- capabilities["能力"]
    app --- vault["凭据库"]
    app --- accounts["团队与账号"]

    projects --- projectInfo["项目目录：资料、多仓库、服务与环境"]
    projects --- requirements["需求：正文或文档、负责人、进度与提测"]
    projects --- bugs["Bug：复现证据、修复回归、客户反馈"]
    projects --- code["代码与 PR：浏览、关联、授权读写"]
    projects --- delivery["交付：流水线结果、运行版本、外部审核记录"]
    projects --- artifacts["产物：测试包、二维码、Web/API 测试地址"]
    projects --- projectChats["项目协作：按标签归集原会话，只读查看"]
    projects --- variables["环境变量：按环境配置、引用团队凭据"]

    chats --- conversations["会话：私聊、群组、Leader、工作标签"]
    chats --- tasks["任务：显式创建、执行者、交接、运行与验收"]
    chats --- inbox["待处理：待验收、等待配置、阻塞与通知"]

    operations --- events["服务与事件：运行情况、异常聚合、关联 Bug"]
    operations --- duty["值守：巡检规则、定时触发、自动建单与任务"]
    operations --- changes["变更：具体计划、人工放行、执行与验证"]

    capabilities --- bots["Bot：职责、负责人、模型、环境与项目授权"]
    capabilities --- knowledge["知识：Skills、AGENTS.md 模板、记忆与交接摘要"]
    capabilities --- connectors["接入：连接、执行节点、项目工具与调用结果"]

    vault --- secrets["凭据：API 密钥、账号密码、SSH 密钥"]
    vault --- grants["授权：项目与 Bot 范围、期限、运行时使用"]
    vault --- configuration["管理：配置请求、轮换、撤销、使用记录"]

    accounts --- invitations["邀请：root 邀请管理员，管理员邀请成员"]
    accounts --- login["开通：邮件 token、设置密码和资料；邮箱密码登录"]
    accounts --- members["团队：角色、成员停用、团队切换与隔离"]

    classDef root fill:#15324F,color:#FFFFFF,stroke:#15324F
    classDef research fill:#DBEAFE,color:#172554,stroke:#3B82F6
    classDef collaboration fill:#EDE9FE,color:#4C1D95,stroke:#8B5CF6
    classDef operation fill:#FFEDD5,color:#7C2D12,stroke:#F97316
    classDef foundation fill:#CCFBF1,color:#134E4A,stroke:#14B8A6
    class app root
    class projects,projectInfo,requirements,bugs,code,delivery,artifacts,projectChats,variables research
    class chats,conversations,tasks,inbox collaboration
    class operations,events,duty,changes operation
    class capabilities,bots,knowledge,connectors,vault,secrets,grants,configuration,accounts,invitations,login,members foundation
```

项目内页签继续使用“需求、协作、代码、Bug、PR、流水线、产物与版本、环境变量”。项目协作复用原会话；项目环境变量复用凭据引用；通知返回原任务或业务记录。相同业务对象跨入口展示，不建立第二份状态。

## 3. 模块区域架构图

按使用入口、访问控制、业务、共享能力、数据以及外部系统分区。箭头表示主要访问和集成方向，双向箭头表示调用与结果交换；这里只画主要关系，不列出所有模块间接口。区域是逻辑职责，进程数量、服务拆分、部署节点和队列方案另行设计。

```mermaid
flowchart TB
    subgraph entryZone["使用入口区"]
        direction LR
        web["Web 工作台"]
        cli["CLI / API 与本地研发工具上报"]
        customer["客户反馈入口"]
    end

    subgraph platformZone["DevOps 平台逻辑边界"]
        access["访问控制区 · M01：统一接口、身份、团队隔离与操作授权"]

        subgraph businessZone["业务模块区"]
            direction LR
            projectDomain["项目研发 · M02 至 M06"]
            collaborationDomain["会话与任务 · M08、M09（V0.5）"]
            operationsDomain["变更与值守 · M13（V0.4b）、M14（V0.6）"]
        end

        subgraph supportZone["共享能力区"]
            direction LR
            botKnowledge["Bot 与知识 · M07（V0.5）、M10"]
            credentials["凭据与环境配置 · M11"]
            notifications["通知与待处理 · M15（V0.5 站内／V0.6 外部）"]
            adapters["连接、执行节点与项目工具 · M12"]
        end

        subgraph dataZone["数据区"]
            database[("PostgreSQL：业务、关联、结果与审计记录")]
            secretStorage[("加密凭据存储：具体服务待选型")]
        end
    end

    subgraph externalZone["外部系统与执行区"]
        direction LR
        git["GitHub / Gitea"]
        models["模型服务 / Bot 运行环境"]
        nodes["自托管执行节点"]
        observability["日志 / 监控系统"]
        channels["邮件服务 / 飞书"]
    end

    web --> access
    cli --> access
    customer -->|"仅获准反馈范围"| access
    access --> businessZone
    access --> supportZone

    projectDomain -->|"代码关联与交付结果"| adapters
    collaborationDomain -->|"任务与授权工具调用"| adapters
    operationsDomain -->|"事件接入与已放行操作"| adapters
    botKnowledge -->|"运行配置与知识"| adapters
    credentials -->|"按当前授权解析引用"| adapters
    notifications -->|"通知发送"| adapters

    businessZone -->|"业务记录"| database
    supportZone -->|"配置、授权元数据与活动记录"| database
    credentials -->|"敏感值受控存取"| secretStorage

    adapters <-->|"授权读取与写入"| git
    adapters <-->|"模型调用与任务执行结果"| models
    adapters <-->|"任务下发与结果回传"| nodes
    observability -->|"异常事件与证据"| adapters
    adapters -->|"邀请邮件与通知"| channels

    classDef boundary fill:#15324F,color:#FFFFFF,stroke:#15324F
    classDef business fill:#DBEAFE,color:#172554,stroke:#3B82F6
    classDef shared fill:#CCFBF1,color:#134E4A,stroke:#14B8A6
    classDef external fill:#F1F5F9,color:#334155,stroke:#94A3B8
    class access boundary
    class projectDomain,collaborationDomain,operationsDomain business
    class botKnowledge,credentials,notifications,adapters shared
    class git,models,nodes,observability,channels external
```

访问控制与审计覆盖每次操作，包括 Bot 工具调用和外部结果上报。M12 表示接入职责，不代表必须建设通用插件系统。加密凭据存储是安全职责边界，不预设独立服务部署；产物存文件还是存引用仍按需求待定项确认。技术方案见[技术选型与集成方案](../technical-selection.md)和[后端架构](../architecture/server-foundation.md)。

阅读三张图时保持以下业务边界：

- **提测与流水线独立。** 提测不触发、等待或重试构建部署；流水线结果不自动改写需求和 Bug 的业务进度。
- **最新产物与运行版本分别记录。** 服务可独立交付；运行版本需有实际依据。
- **开发验收与发布放行分开。** 变更需绑定具体计划，执行后验证健康与实际版本；数据库变更、服务器清理和云资源调整遵守同一框架，具体连接器另行确认。
- **聊天与任务分开。** 普通发言不自动变成任务；项目标签和资源引用不扩大会话、项目或凭据权限。
- **外部系统保留职责。** Git 系统托管代码；平台解析仓库内 YAML 定义的流水线并在自托管执行节点运行；外部商店与小程序平台由成员人工提审，平台记录审核及发布结果。
- **已确认规则与待定细节分开。** 邮箱邀请及邮箱密码登录已确定；root 初始化、邀请有效期、资料必填项等继续在 V0.1 文档逐项确认。
