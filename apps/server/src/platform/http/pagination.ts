import { ApiError } from './errors.ts'
import { ERROR_CODES } from './error-codes.ts'

const MAX_PAGE_SIZE = 100

/**
 * 校验分页参数，统一各列表接口的页码与页大小边界。
 * @param page 页码，从 1 开始。
 * @param pageSize 每页数量，允许 1 到 100。
 * @param maxPageSize 允许的最大页大小，默认 100。
 * @throws 参数不是安全整数或超出范围时抛出 VALIDATION_ERROR。
 */
export function validatePage(page: number, pageSize: number, maxPageSize = MAX_PAGE_SIZE): void {
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > maxPageSize
  ) {
    throw new ApiError(ERROR_CODES.VALIDATION_ERROR, '分页参数不合法')
  }
}
