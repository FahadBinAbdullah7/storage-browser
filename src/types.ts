export type ConnType = 's3' | 'r2' | 'd1'

export interface Conn {
  id: string
  name: string
  type: ConnType
  accessKeyId?: string
  region?: string
  endpoint?: string
  accountId?: string
  defaultBucket?: string
  publicBase?: string
  publicUrls?: Record<string, string>
  has_secretAccessKey?: boolean
  has_apiToken?: boolean
}

export interface Folder { prefix: string; name: string }
export interface FileItem { key: string; name: string; size: number; lastModified?: string }
export interface Transfer {
  id: string; name: string; kind: 'upload' | 'download'
  loaded: number; total: number; state: 'active' | 'done' | 'error'; error?: string
}
export type UpdateState =
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

type R<T> = Promise<{ ok: true; data: T } | { ok: false; error: string }>

declare global {
  interface Window {
    api: {
      version(): R<string>
      pathForFile(f: File): string
      conn: { list(): R<Conn[]>; save(c: Partial<Conn> & Record<string, unknown>): R<string>; remove(id: string): R<void>; test(c: Record<string, unknown>): R<string> }
      obj: {
        buckets(id: string): R<{ name: string }[]>
        list(id: string, b: string, p: string, t?: string | null): R<{ folders: Folder[]; files: FileItem[]; nextToken: string | null }>
        presign(id: string, b: string, k: string, secs: number): R<string>
        text(id: string, b: string, k: string): R<string>
        head(id: string, b: string, k: string): R<{ size: number; type?: string; etag?: string; lastModified?: string }>
        headFull(id: string, b: string, k: string): R<FullHead>
        setMeta(id: string, b: string, k: string, m: { contentType?: string; cacheControl?: string }): R<void>
        copy(id: string, b: string, from: string, to: string): R<void>
        createBucket(id: string, n: string): R<void>
        deleteBucket(id: string, n: string): R<void>
        search(id: string, b: string, p: string, q: string): R<FileItem[]>
        stats(id: string, b: string, p: string): R<{ count: number; size: number }>
        mkdir(id: string, b: string, p: string): R<void>
        remove(id: string, b: string, keys: string[]): R<number>
        move(id: string, b: string, from: string, to: string): R<void>
        upload(id: string, b: string, prefix: string, paths: string[]): R<boolean>
        pickUpload(id: string, b: string, prefix: string, dir: boolean): R<boolean>
        download(id: string, b: string, keys: string[]): R<boolean>
      }
      d1: {
        databases(id: string): R<{ id: string; name: string; size?: number; tables?: number }[]>
        tables(id: string, db: string): R<string[]>
        browse(id: string, db: string, t: string, l: number, o: number): R<D1Result & { total: number }>
        query(id: string, db: string, sql: string): R<D1Result>
      }
      copy(t: string): R<void>
      openExternal(u: string): R<void>
      onTransfer(cb: (t: Transfer) => void): () => void
      onUpdate(cb: (u: UpdateState) => void): () => void
      update: { download(): R<void>; install(): R<void> }
    }
  }
}

export interface D1Result { columns: string[]; rows: Record<string, unknown>[]; meta: Record<string, unknown> }

export interface FullHead { size: number; contentType: string; cacheControl: string; contentDisposition: string; etag?: string; storageClass: string; lastModified?: string; metadata: Record<string, string> }
