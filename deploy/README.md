# 本地依赖环境

[compose.yaml](compose.yaml) 提供 PostgreSQL 18，[初始化脚本](postgres/init.sql) 创建本地应用与迁移角色。工作区默认使用项目名 `dev-ops` 和 `dev-ops_postgres_data` 数据卷，移动配置文件不会改变数据卷名称。

在仓库根目录运行：

```bash
pnpm db:setup
pnpm db:up
pnpm db:migrate
```

本地配置保存在 `apps/server/.env` 与 `apps/server/.env.database`，初始化命令保留已存在的配置。`pnpm db:up` 同时启动 Mailpit（SMTP `127.0.0.1:1025`，Web `http://127.0.0.1:8025`）；应用 `.env` 使用 `SMTP_URL=smtp://127.0.0.1:1025`。`pnpm db:down` 停止本项目容器并保留数据卷。

连接、账号权限、迁移与测试说明统一见[数据库说明](../docs/architecture/database.md)。

## Web 网关

[gateway.compose.yaml](gateway.compose.yaml) 部署 Nginx，把页面和静态资源转发到 Web，把 `/api/` 转发到应用服务。Web 上游返回或 Nginx 产生 502、503、504 时，Nginx 保留原状态码并返回内嵌 Bot 插画和样式的 HTML。浏览器可直接重新加载当前地址。API 保留接口自身的响应格式。

在仓库根目录启动，按部署环境替换上游地址：

```bash
GATEWAY_WEB_UPSTREAM=http://host.docker.internal:5173 \
GATEWAY_API_UPSTREAM=http://host.docker.internal:3001 \
docker compose -f deploy/gateway.compose.yaml up -d --build
```

网关默认监听宿主机 `127.0.0.1:8080`，可通过 `GATEWAY_BIND_ADDRESS` 和 `GATEWAY_PORT` 调整。上游地址只填协议、主机和端口。Docker Desktop 可以使用 `host.docker.internal`。Linux 上填写容器可访问的 IP 或同一 Docker 网络可解析的服务名。网关在收到请求时解析上游地址，可以先于应用启动。`GATEWAY_WEB_READ_TIMEOUT` 默认 30 秒。

将服务端 `APP_ORIGIN` 设置为用户实际访问的公开 URL。如果线上还有 CDN 或外层负载均衡，外层自身产生的错误需在该层设置错误页。

## 邮件与应用初始化

本地可运行 Mailpit（`smtp://127.0.0.1:1025`）并配置 `apps/server/.env` 的 `SMTP_URL=smtp://127.0.0.1:1025`；stg 使用 Resend SMTP，需同时设置 `MAIL_FROM`。首次启动后运行 `pnpm --dir apps/server seed:root` 创建平台 root，不要提交真实凭据或 `.env`。
