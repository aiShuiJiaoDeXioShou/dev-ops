import { pgSchema } from 'drizzle-orm/pg-core'

/** 业务表统一归属 app schema；业务模块使用此命名空间定义所属表，不创建数据库外键。 */
export const appSchema = pgSchema('app')
