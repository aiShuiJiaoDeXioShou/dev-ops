import { Type } from 'typebox'

export const AVATAR_PREFIX = 'data:image/jpeg;base64,'
export const AVATAR_MAX_BYTES = 32 * 1024
const MAX_DATA_URL_LENGTH = AVATAR_PREFIX.length + Math.ceil(AVATAR_MAX_BYTES / 3) * 4

/** 业务响应只提供平台保存的 JPEG 缩略图；未设置时省略字段。 */
export const avatarImageSchema = Type.Optional(Type.String({ pattern: '^data:image/jpeg;base64,' }))

/**
 * 从账号资料取出可用于工作区展示的头像。
 * @param image 账号保存的头像地址；旧数据可能为外部地址。
 * @returns 有界的 JPEG 数据地址，其他值返回 undefined，避免替成员加载外部资源。
 */
export function displayAvatar(image: unknown): string | undefined {
  if (typeof image !== 'string' || image.length > MAX_DATA_URL_LENGTH || !image.startsWith(AVATAR_PREFIX)) {
    return undefined
  }
  return image
}
