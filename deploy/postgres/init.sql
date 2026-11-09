-- 仅在空数据卷首次启动时执行；角色密码从容器环境读取，不写入迁移文件。
\getenv app_password APP_DATABASE_PASSWORD
\getenv migration_password MIGRATION_DATABASE_PASSWORD
CREATE ROLE dev_ops_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE dev_ops_migrator LOGIN PASSWORD :'migration_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
REVOKE ALL ON DATABASE dev_ops FROM PUBLIC;
GRANT CONNECT ON DATABASE dev_ops TO dev_ops_app, dev_ops_migrator;
GRANT CREATE ON DATABASE dev_ops TO dev_ops_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER ROLE dev_ops_app SET timezone = 'UTC';
ALTER ROLE dev_ops_migrator SET timezone = 'UTC';
