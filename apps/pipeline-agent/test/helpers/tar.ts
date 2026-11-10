import { extract } from 'tar-stream'

/** 从 tar 字节中解出的条目；测试断言产物内容使用。 */
export interface ExtractedTarEntry {
  name: string
  type: string
  content: Buffer
}

/**
 * 解析 tar 字节为条目列表。
 * @param tar tar 文件内容。
 * @returns 条目名、类型与内容；用于校验产物打包结果。
 */
export async function extractTar(tar: Buffer): Promise<ExtractedTarEntry[]> {
  const entries: ExtractedTarEntry[] = []
  await new Promise<void>((resolve, reject) => {
    const parser = extract()
    parser.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: unknown) =>
        chunks.push(Buffer.from(chunk instanceof Uint8Array ? chunk : String(chunk))),
      )
      stream.on('error', reject)
      stream.on('end', () => {
        entries.push({ name: header.name, type: header.type, content: Buffer.concat(chunks) })
        next()
      })
      stream.resume()
    })
    parser.on('error', reject)
    parser.on('finish', resolve)
    parser.end(tar)
  })
  return entries
}
