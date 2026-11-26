# Markdown 预览

代码页与共享文档正文使用 `react-markdown`，通过 `remark-gfm` 解析 GitHub Flavored Markdown。支持标题、列表、引用、表格及对齐、任务列表、删除线、自动链接、脚注、代码块、图片和引用式链接；另外支持 GitHub 提示块、表情短码、数学公式、Mermaid 图表和自动标题锚点。

HTML 先通过 `rehype-raw` 解析，再由 `rehype-sanitize` 白名单清洗。保留图片尺寸、对齐、`details` / `summary` 等文档标记，不执行脚本、事件属性或任意样式。公式使用 KaTeX 非信任模式；Mermaid 按需加载并使用严格安全模式，解析失败时展示源码。

代码页以当前文件目录为相对路径起点，以当前分支构造来源链接。以 `/` 开头的路径相对仓库根目录；`..` 不得越过根目录。Markdown 图片与 HTML 图片使用相同解析逻辑。GitHub 公共仓库图片指向 `raw.githubusercontent.com`，Gitea 图片指向仓库 `raw/branch`；远程图片仍依赖来源网络可达性。此实现不代理私有仓库图片的鉴权，私有资源需要浏览器具备相应访问能力。

这不是 GitHub 整站功能镜像：GitHub 用户/Issue 自动关联、附件上传、GeoJSON/TopoJSON 地图、STL 模型等站点功能未接入。MDX 按 Markdown 文档读取，不执行 JSX。

验证覆盖共享渲染组件、路径解析，以及实际 README 在桌面与窄屏代码页的表格、图片、折叠区、锚点、公式和图表。页面测试通过模拟 API 与本地图片提供确定性结果，不代替线上鉴权与网络验证。
