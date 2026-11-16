/** 晴雨表最大查询窗口和仓库日统计保留天数，均包含当日。 */
export const DASHBOARD_WINDOW_DAYS = 371
export const DASHBOARD_DAY_MS = 86_400_000
/** 每个仓库成功核对后的轮询间隔。 */
export const DASHBOARD_SYNC_INTERVAL_MS = 5 * 60_000
/** Worker 停摆时，超过该期限的来源不再作为已核对数据提供。 */
export const DASHBOARD_MAX_CACHE_AGE_MS = 3 * DASHBOARD_SYNC_INTERVAL_MS
