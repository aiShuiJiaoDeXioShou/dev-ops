type PageParams = { page: number; pageSize: number }

/**
 * 按接口允许的每页上限顺序读取候选项，供需要完整列表的选择器使用。
 * @param readPage 接收分页参数并返回条目和总数的接口调用，可由调用方传入取消信号。
 * @returns 按服务端顺序合并的条目。
 */
export async function readAllPages<Item>(
  readPage: (params: PageParams) => Promise<{ data: { items: Item[]; total: number } }>,
): Promise<Item[]> {
  const pageSize = 100
  const first = await readPage({ page: 1, pageSize })
  const items = [...first.data.items]
  const lastPage = Math.ceil(first.data.total / pageSize)
  for (let page = 2; page <= lastPage; page += 1) {
    const next = await readPage({ page, pageSize })
    items.push(...next.data.items)
  }
  return items
}
