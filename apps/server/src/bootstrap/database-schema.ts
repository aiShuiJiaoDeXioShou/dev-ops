// 迁移入口汇总业务模块的表定义；数据库基础设施只依赖命名空间，不反向依赖业务模块。
export { appSchema } from '../platform/database/namespace.js'
