import { migrateDatabase } from '../platform/database/migrate.ts'

try {
  const connectionString = process.env.MIGRATION_DATABASE_URL
  if (!connectionString) throw new Error('缺少迁移数据库配置')
  await migrateDatabase(connectionString)
  process.stdout.write('数据库迁移完成。\n')
} catch {
  process.stderr.write('数据库迁移失败，请检查 MIGRATION_DATABASE_URL、数据库状态、账号权限和迁移文件。\n')
  process.exitCode = 1
}
