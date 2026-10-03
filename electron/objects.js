const {
  S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, HeadObjectCommand,
  DeleteObjectsCommand, CopyObjectCommand, PutObjectCommand, CreateBucketCommand,
} = require('@aws-sdk/client-s3')
const { Upload } = require('@aws-sdk/lib-storage')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const mime = require('mime-types')
const fs = require('fs')
const path = require('path')
const { pipeline } = require('stream/promises')

const clients = new Map()

function endpointFor(c) {
  if (c.type === 'r2') return `https://${c.accountId}.r2.cloudflarestorage.com`
  return c.endpoint || undefined
}

function client(c) {
  const key = [c.id, c.accessKeyId, c.secretAccessKey, c.accountId, c.endpoint, c.region].join('|')
  if (clients.has(key)) return clients.get(key)
  const endpoint = endpointFor(c)
  const cl = new S3Client({
    region: c.type === 'r2' ? 'auto' : c.region || 'us-east-1',
    endpoint,
    forcePathStyle: c.type === 's3' && !!c.endpoint,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    followRegionRedirects: c.type === 's3' && !c.endpoint,
    // R2 and many S3-compatible stores reject the newer default CRC32 checksums.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
  clients.set(key, cl)
  return cl
}

async function listBuckets(c) {
  // Names typed into the connection (comma/space separated). Keys limited to one bucket can't
  // list buckets at all, so these are always offered in addition to whatever the account lists.
  const extra = (c.defaultBucket || '').split(/[,\s]+/).filter(Boolean)
  let list = []
  try {
    const r = await client(c).send(new ListBucketsCommand({}))
    list = (r.Buckets || []).map((b) => ({ name: b.Name, created: b.CreationDate?.toISOString() }))
  } catch (e) {
    if (!extra.length) throw e
  }
  for (const n of extra) if (!list.some((b) => b.name === n)) list.push({ name: n })
  return list
}

async function list(c, bucket, prefix, token) {
  const r = await client(c).send(new ListObjectsV2Command({
    Bucket: bucket, Prefix: prefix, Delimiter: '/', ContinuationToken: token || undefined, MaxKeys: 1000,
  }))
  return {
    folders: (r.CommonPrefixes || []).map((p) => ({ prefix: p.Prefix, name: p.Prefix.slice(prefix.length).replace(/\/$/, '') })),
    files: (r.Contents || [])
      .filter((o) => o.Key !== prefix)
      .map((o) => ({ key: o.Key, name: o.Key.slice(prefix.length), size: o.Size, lastModified: o.LastModified?.toISOString() })),
    nextToken: r.IsTruncated ? r.NextContinuationToken : null,
  }
}

async function listAll(c, bucket, prefix) {
  const out = []
  let token
  do {
    const r = await client(c).send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    for (const o of r.Contents || []) out.push({ key: o.Key, size: o.Size })
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return out
}

// Expand a mix of file keys and folder prefixes (ending in "/") into file keys.
async function expand(c, bucket, keys) {
  const out = []
  for (const k of keys) {
    if (k.endsWith('/')) out.push(...(await listAll(c, bucket, k)))
    else out.push({ key: k })
  }
  return out
}

async function presign(c, bucket, key, expiresIn) {
  return getSignedUrl(client(c), new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn })
}

async function getText(c, bucket, key) {
  const r = await client(c).send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=0-204799' }))
  return r.Body.transformToString()
}

async function head(c, bucket, key) {
  const r = await client(c).send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  return { size: r.ContentLength, type: r.ContentType, etag: r.ETag, lastModified: r.LastModified?.toISOString() }
}

async function mkdir(c, bucket, prefix) {
  await client(c).send(new PutObjectCommand({ Bucket: bucket, Key: prefix.endsWith('/') ? prefix : prefix + '/', Body: '' }))
}

// Public delete: files only. Folders (and buckets) can never be deleted from the app.
async function remove(c, bucket, keys) {
  if (keys.some((k) => k.endsWith('/'))) throw new Error('Folders cannot be deleted. Select files only.')
  return removeUnchecked(c, bucket, keys)
}

// Internal: used by rename/move, which delete the old folder prefix after copying.
async function removeUnchecked(c, bucket, keys) {
  const files = await expand(c, bucket, keys)
  // Folder placeholders ("dir/") are removed too.
  for (const k of keys) if (k.endsWith('/') && !files.some((f) => f.key === k)) files.push({ key: k })
  for (let i = 0; i < files.length; i += 1000) {
    const batch = files.slice(i, i + 1000)
    const r = await client(c).send(new DeleteObjectsCommand({
      Bucket: bucket, Delete: { Objects: batch.map((f) => ({ Key: f.key })), Quiet: true },
    }))
    if (r.Errors?.length) throw new Error(r.Errors[0].Message || 'Delete failed')
  }
  return files.length
}

const srcOf = (bucket, key) => encodeURIComponent(`${bucket}/${key}`).replace(/%2F/g, '/')

// Copy a key or a whole folder prefix; optionally delete the source afterwards (= move).
async function transfer(c, bucket, from, to, del) {
  const isDir = from.endsWith('/')
  const files = isDir ? await listAll(c, bucket, from) : [{ key: from }]
  for (const f of files) {
    const dest = isDir ? to + f.key.slice(from.length) : to
    if (dest === f.key) continue
    await client(c).send(new CopyObjectCommand({ Bucket: bucket, Key: dest, CopySource: srcOf(bucket, f.key) }))
  }
  if (del && from !== to) await removeUnchecked(c, bucket, [from])
}
const move = (c, bucket, from, to) => transfer(c, bucket, from, to, true)
const copy = (c, bucket, from, to) => transfer(c, bucket, from, to, false)

async function headFull(c, bucket, key) {
  const r = await client(c).send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
  return {
    size: r.ContentLength, contentType: r.ContentType || '', cacheControl: r.CacheControl || '', contentDisposition: r.ContentDisposition || '',
    etag: r.ETag, storageClass: r.StorageClass || 'STANDARD', lastModified: r.LastModified?.toISOString(), metadata: r.Metadata || {},
  }
}

// S3/R2 can't edit headers in place; copying the object onto itself with REPLACE does it.
async function setMeta(c, bucket, key, m) {
  const cur = await headFull(c, bucket, key)
  await client(c).send(new CopyObjectCommand({
    Bucket: bucket, Key: key, CopySource: srcOf(bucket, key), MetadataDirective: 'REPLACE',
    ContentType: m.contentType || cur.contentType || undefined,
    CacheControl: m.cacheControl || undefined,
    ContentDisposition: cur.contentDisposition || undefined,
    Metadata: cur.metadata,
  }))
}

async function createBucket(c, name) { await client(c).send(new CreateBucketCommand({ Bucket: name })) }

// Parallel breadth-first search: many folders are listed at once (delimiter "/" keeps each
// request small), results stream back through emit() so the UI fills in while it works.
const searches = new Map()
const MAX_HITS = 500
const CONCURRENCY = 16

async function search(c, bucket, prefix, q, searchId, emit) {
  const state = { cancelled: false }
  searches.set(searchId, state)
  const needle = q.toLowerCase()
  const files = []
  const folders = []
  const queue = [prefix]
  let active = 0, scanned = 0, firstError = null, lastEmit = 0
  const full = () => files.length + folders.length >= MAX_HITS
  const stop = () => state.cancelled || full()
  const progress = (done) => {
    const now = Date.now()
    if (!done && now - lastEmit < 250) return
    lastEmit = now
    emit({ id: searchId, files: [...files], folders: [...folders], scanned, done, capped: full() })
  }

  async function scan(pfx) {
    let token
    do {
      if (stop()) return
      const r = await client(c).send(new ListObjectsV2Command({ Bucket: bucket, Prefix: pfx, Delimiter: '/', ContinuationToken: token }))
      for (const o of r.Contents || []) {
        if (o.Key === pfx || o.Key.endsWith('/')) continue
        if (o.Key.slice(pfx.length).toLowerCase().includes(needle)) {
          files.push({ key: o.Key, name: o.Key.slice(prefix.length), size: o.Size, lastModified: o.LastModified?.toISOString() })
        }
      }
      for (const p of r.CommonPrefixes || []) {
        if (p.Prefix.slice(pfx.length, -1).toLowerCase().includes(needle)) {
          folders.push({ prefix: p.Prefix, name: p.Prefix.slice(prefix.length).replace(/\/$/, '') })
        }
        queue.push(p.Prefix)
      }
      scanned += (r.Contents || []).length + (r.CommonPrefixes || []).length
      progress(false)
      token = r.IsTruncated ? r.NextContinuationToken : undefined
    } while (token)
  }

  await new Promise((resolve) => {
    const pump = () => {
      while (active < CONCURRENCY && queue.length && !stop()) {
        active++
        scan(queue.shift()).catch((e) => { firstError = firstError || e }).finally(() => { active--; pump() })
      }
      if (!active && (!queue.length || stop())) resolve()
    }
    pump()
  })
  searches.delete(searchId)
  if (firstError && !files.length && !folders.length) throw firstError
  progress(true)
  return true
}

const cancelSearch = (id) => { const s = searches.get(id); if (s) s.cancelled = true }

async function stats(c, bucket, prefix) {
  const all = await listAll(c, bucket, prefix)
  return { count: all.filter((f) => !f.key.endsWith('/')).length, size: all.reduce((n, f) => n + (f.size || 0), 0) }
}

function walk(p, base, out) {
  const st = fs.statSync(p)
  if (st.isDirectory()) {
    for (const n of fs.readdirSync(p)) walk(path.join(p, n), base, out)
  } else {
    out.push({ file: p, rel: path.relative(base, p).split(path.sep).join('/'), size: st.size })
  }
}

async function upload(c, bucket, prefix, paths, onProgress) {
  const items = []
  for (const p of paths) {
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      const root = path.dirname(p)
      walk(p, root, items)
    } else {
      items.push({ file: p, rel: path.basename(p), size: st.size })
    }
  }
  for (const it of items) {
    const id = `up:${Date.now()}:${it.rel}`
    const key = prefix + it.rel
    onProgress({ id, name: it.rel, kind: 'upload', loaded: 0, total: it.size, state: 'active' })
    try {
      const u = new Upload({
        client: client(c),
        params: { Bucket: bucket, Key: key, Body: fs.createReadStream(it.file), ContentType: mime.lookup(it.file) || 'application/octet-stream' },
        queueSize: 4, partSize: 8 * 1024 * 1024,
      })
      u.on('httpUploadProgress', (p) => onProgress({ id, name: it.rel, kind: 'upload', loaded: p.loaded || 0, total: it.size, state: 'active' }))
      await u.done()
      onProgress({ id, name: it.rel, kind: 'upload', loaded: it.size, total: it.size, state: 'done' })
    } catch (e) {
      onProgress({ id, name: it.rel, kind: 'upload', loaded: 0, total: it.size, state: 'error', error: e.message })
    }
  }
}

async function downloadTo(c, bucket, key, dest, onProgress) {
  const id = `dl:${Date.now()}:${key}`
  const name = key.split('/').pop()
  const total = (await head(c, bucket, key)).size || 0
  onProgress({ id, name, kind: 'download', loaded: 0, total, state: 'active' })
  try {
    const r = await client(c).send(new GetObjectCommand({ Bucket: bucket, Key: key }))
    let loaded = 0
    r.Body.on('data', (d) => { loaded += d.length; onProgress({ id, name, kind: 'download', loaded, total, state: 'active' }) })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    await pipeline(r.Body, fs.createWriteStream(dest))
    onProgress({ id, name, kind: 'download', loaded: total, total, state: 'done' })
  } catch (e) {
    onProgress({ id, name, kind: 'download', loaded: 0, total, state: 'error', error: e.message })
  }
}

module.exports = { listBuckets, list, expand, presign, getText, head, headFull, setMeta, mkdir, remove, move, copy, createBucket, search, cancelSearch, stats, upload, downloadTo }
