/** 极简 ZIP 写入器：仅使用 store 模式，满足技能包导出，不引入额外依赖。 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

/**
 * 计算 ZIP 使用的 CRC32 校验值。
 * @param data 文件字节。
 * @returns 无符号 32 位校验值。
 */
function crc32(data: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of data) {
    value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

/** 写入一个 ZIP 条目所需的字节。 */
interface ZipEntry {
  nameBytes: Uint8Array
  data: Uint8Array
  crc: number
  offset: number
}

/** 以当前时间生成 DOS 日期/时间字段。 */
function dosDateTime(): { date: number; time: number } {
  const now = new Date()
  return {
    date: ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate(),
    time: (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2),
  }
}

/**
 * 生成不含压缩的 ZIP 文件。
 * @param entries 相对路径与文本或二进制内容。
 * @returns 可下载的 ZIP Blob。
 */
export function createZip(entries: Array<{ path: string; content: string | Uint8Array }>): Blob {
  const encoder = new TextEncoder()
  const { date, time } = dosDateTime()
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  const records: ZipEntry[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path)
    const data = typeof entry.content === 'string' ? encoder.encode(entry.content) : entry.content
    const crc = crc32(data)

    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x0800, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, time, true)
    localView.setUint16(12, date, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    records.push({ nameBytes, data, crc, offset })
    chunks.push(local, data)
    offset += local.length + data.length
  }

  for (const record of records) {
    const header = new Uint8Array(46 + record.nameBytes.length)
    const view = new DataView(header.buffer)
    view.setUint32(0, 0x02014b50, true)
    view.setUint16(4, 20, true)
    view.setUint16(6, 20, true)
    view.setUint16(8, 0x0800, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, time, true)
    view.setUint16(14, date, true)
    view.setUint32(16, record.crc, true)
    view.setUint32(20, record.data.length, true)
    view.setUint32(24, record.data.length, true)
    view.setUint16(28, record.nameBytes.length, true)
    view.setUint16(30, 0, true)
    view.setUint16(32, 0, true)
    view.setUint16(34, 0, true)
    view.setUint16(36, 0, true)
    view.setUint32(38, 0, true)
    view.setUint32(42, record.offset, true)
    header.set(record.nameBytes, 46)
    central.push(header)
  }

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, records.length, true)
  endView.setUint16(10, records.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  const parts = [...chunks, ...central, end].map((chunk) => {
    const copy = new Uint8Array(chunk.byteLength)
    copy.set(chunk)
    return copy.buffer
  })
  return new Blob(parts, { type: 'application/zip' })
}
