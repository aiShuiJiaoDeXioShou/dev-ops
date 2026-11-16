/**
 * 头像占位背景色。
 * @remarks 没有可用头像图片时，用稳定的种子（成员 userId）从语义 token 色板中取一种浅色背景，
 * 保证同一成员颜色稳定、不同成员可区分；颜色只使用 token 生成的语义类，不引入裸色值。
 */
const AVATAR_TONES = [
  'bg-primary/10 text-primary',
  'bg-success/10 text-success',
  'bg-warning/10 text-warning',
  'bg-destructive/10 text-destructive',
  'bg-accent text-accent-foreground',
] as const

/**
 * 按种子生成稳定的头像背景与文字色类名。
 * @param seed 稳定标识，通常为成员 userId；缺失时回退姓名。
 * @returns 语义 token 类名组合。
 */
export function avatarToneClassName(seed: string): string {
  let hash = 0
  for (const character of seed) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0
  }
  return AVATAR_TONES[hash % AVATAR_TONES.length] ?? AVATAR_TONES[0]
}

/**
 * 取成员姓名首字作为头像占位。
 * @param name 成员姓名。
 * @returns 首字符，姓名为空时返回问号。
 */
export function memberInitial(name: string): string {
  return name.trim().charAt(0) || '?'
}
