# React + TypeScript + Vite

## 本地开发

本项目使用 Node.js 24.15.0、pnpm 11.12.0 和 Tailwind CSS 4。使用 pnpm 管理依赖，提交 `pnpm-lock.yaml`。

```bash
cd apps/web
nvm use
pnpm install
pnpm dev
```

`pnpm build` 执行 TypeScript 检查与生产构建，`pnpm lint` 执行 Oxlint 检查，`pnpm preview` 预览构建产物。

按[项目根目录说明](../../README.md)启动 PostgreSQL、执行迁移并启动后端后，再运行前端开发服务。首页的“开发环境联通检查”会通过同源 `/api/v1/ready` 请求验证 Vite 代理、后端和数据库，成功时展示“已联通”及后端请求标识。

检查请求最多等待 5 秒；网络异常、数据库未就绪或响应不符合契约时显示失败原因，可点击“重新检查”重试。该面板用于本地开发联调，尚未实现的登录和项目业务功能仍按需求推进。

Tailwind 已通过 `@tailwindcss/vite` 接入，入口为 `src/index.css`，可直接在 JSX 中使用工具类：

```tsx
<div className="rounded-xl bg-slate-900 p-6 text-white">项目开发平台</div>
```

基础接入无需 `tailwind.config.js` 或额外 PostCSS 配置。现有模板 CSS 仍保留；后续页面使用 Tailwind 时，应将自定义默认样式放入 `@layer base` 或 `@layer components`，避免未分层的 CSS 覆盖工具类。

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.
You can also try [the experimental native React Compiler support in plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler) by using `compiler: true` in the plugin options instead of using the Babel plugin.

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
