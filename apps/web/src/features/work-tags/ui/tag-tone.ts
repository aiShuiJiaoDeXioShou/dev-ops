const TAG_TONES = ['blue', 'green', 'amber', 'red', 'neutral'] as const

export type TagTone = (typeof TAG_TONES)[number]

/**
 * 按标签标识稳定选取颜色，同一标签在会话、任务和管理弹窗中颜色一致。
 * @param id 工作标签标识。
 * @returns 对应 `work-tag-chip[data-tone]` 样式的色调名称。
 */
export function tagTone(id: string): TagTone {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return TAG_TONES[hash % TAG_TONES.length] ?? 'neutral'
}
