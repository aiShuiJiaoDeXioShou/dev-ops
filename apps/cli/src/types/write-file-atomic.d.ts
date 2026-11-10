declare module 'write-file-atomic' {
  import type { Mode } from 'node:fs'

  interface Options {
    encoding?: BufferEncoding | null
    mode?: Mode
    chown?: { uid: number; gid: number }
    fsync?: boolean
  }
  function writeFileAtomic(filename: string, data: string | Buffer, options?: Options): Promise<void>
  export default writeFileAtomic
  export const sync: (filename: string, data: string | Buffer, options?: Options) => void
}
