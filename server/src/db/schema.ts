import { pgSchema } from 'drizzle-orm/pg-core'

/** 业务表统一归属 app schema；新增表从此导出，不创建数据库外键。 */
export const appSchema = pgSchema('app')
