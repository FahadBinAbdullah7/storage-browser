const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const http = require('http')
const https = require('https')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { pipeline } = require('stream/promises')
const mime = require('mime-types')
const store = require('./store')

// A NAS connection is { protocol: 'smb' | 'sftp' | 'webdav', host, port, username, password, ... }.
// Every protocol is wrapped in the same small interface so one browser screen handles them all:
//   list(p) stat(p) mkdir(p) rename(a,b) remove(p) readStream(p,{start,end}) upload(local,remote,cb) download(remote,local,cb)
// Remote paths are POSIX-style ("/Movies/a.mp4") and always relative to the share / base path.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { timeout: 30000, ...opts }, (err, stdout, stderr) => {
    if (err) reject(new Error((stderr || stdout || err.message).toString().trim() || err.message))
    else resolve(stdout.toString())
  })
})

function clean(p) {
  const parts = String(p || '/').split('/').filter((x) => x && x !== '.')
  if (parts.includes('..')) throw new Error('Invalid path')
  return '/' + parts.join('/')
}
const join = (dir, name) => (clean(dir) === '/' ? '' : clean(dir)) + '/' + name

// ------------------------------------------------------------------ discovery (Bonjour / mDNS)
async function discover(ms = 4000) {
  const { Bonjour } = require('bonjour-service')
  const b = new Bonjour()
  const found = new Map()
  const kinds = [['smb', 'smb'], ['sftp-ssh', 'sftp'], ['webdav', 'webdav'], ['webdavs', 'webdav']]
  const browsers = kinds.map(([type, protocol]) => b.find({ type }, (svc) => {
    const v4 = (svc.addresses || []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
    const host = v4 || (svc.host || '').replace(/\.$/, '')
    if (!host) return
    found.set(`${protocol}|${host}`, { name: svc.name, host, port: svc.port, protocol, secure: type === 'webdavs' })
  }))
  await sleep(ms)
  browsers.forEach((x) => x.stop())
  b.destroy()
  return [...found.values()]
}

// ------------------------------------------------------------------ SMB (through the operating system)
// Mounting with the OS supports every SMB version/signing mode NAS boxes use.
const mounts = new Map() // connId -> root folder

const smbUser = (c) => (c.domain ? `${c.domain};${c.username}` : c.username)

async function smbMount(c) {
  if (mounts.has(c.id)) return mounts.get(c.id)
  const share = String(c.share || '').replace(/^\/+|\/+$/g, '')
  if (!share) throw new Error('Enter the share name (for example "video" or "home").')
  if (process.platform === 'win32') {
    const unc = `\\\\${c.host}\\${share}`
    await run('net', ['use', unc, c.password, `/user:${c.domain ? c.domain + '\\' : ''}${c.username}`, '/persistent:no'])
    mounts.set(c.id, unc)
    return unc
  }
  if (process.platform !== 'darwin') throw new Error('SMB is supported on macOS and Windows. Use SFTP or WebDAV on this system.')
  const mp = path.join(app.getPath('userData'), 'mnt', c.id)
  fs.mkdirSync(mp, { recursive: true })
  const listed = await run('mount', [])
  if (!listed.includes(` on ${mp} `)) {
    const url = `//${encodeURIComponent(smbUser(c))}:${encodeURIComponent(c.password)}@${c.host}${c.port && Number(c.port) !== 445 ? ':' + Number(c.port) : ''}/${encodeURIComponent(share)}`
    await run('mount_smbfs', [url, mp])
  }
  mounts.set(c.id, mp)
  return mp
}

async function smbUnmount(c) {
  const root = mounts.get(c.id)
  mounts.delete(c.id)
  if (!root) return
  try {
    if (process.platform === 'win32') await run('net', ['use', root, '/delete', '/y'])
    else { await run('umount', [root]); fs.rmdirSync(root) }
  } catch { /* already gone */ }
}

async function smbShares(input) {
  if (process.platform === 'win32') {
    const ipc = `\\\\${input.host}\\IPC$`
    await run('net', ['use', ipc, input.password, `/user:${input.domain ? input.domain + '\\' : ''}${input.username}`, '/persistent:no'])
    try {
      const out = await run('net', ['view', `\\\\${input.host}`])
      return out.split(/\r?\n/).map((l) => /^(\S.*?)\s{2,}Disk\b/.exec(l)?.[1]).filter(Boolean)
    } finally { run('net', ['use', ipc, '/delete', '/y']).catch(() => {}) }
  }
  if (process.platform !== 'darwin') return []
  const url = `//${encodeURIComponent(smbUser(input))}:${encodeURIComponent(input.password)}@${input.host}`
  const out = await run('smbutil', ['view', '-N', url])
  return out.split('\n').map((l) => /^(\S.*?)\s{2,}Disk\b/.exec(l)?.[1]).filter((n) => n && !n.endsWith('$'))
}

async function smbProvider(c) {
  const root = await smbMount(c)
  const loc = (p) => path.join(root, ...clean(p).split('/').filter(Boolean))
  return {
    async list(p) {
      const ents = await fs.promises.readdir(loc(p), { withFileTypes: true })
      const out = []
      for (let i = 0; i < ents.length; i += 32) {
        out.push(...(await Promise.all(ents.slice(i, i + 32).map(async (e) => {
          try { const st = await fs.promises.stat(path.join(loc(p), e.name)); return { name: e.name, isFolder: st.isDirectory(), size: st.size, mtime: st.mtime.toISOString() } }
          catch { return { name: e.name, isFolder: e.isDirectory(), size: 0, mtime: null } }
        }))))
      }
      return out
    },
    async stat(p) { const st = await fs.promises.stat(loc(p)); return { isFolder: st.isDirectory(), size: st.size } },
    mkdir: (p) => fs.promises.mkdir(loc(p), { recursive: true }),
    rename: (a, b) => fs.promises.rename(loc(a), loc(b)),
    remove: (p) => fs.promises.unlink(loc(p)),
    async readStream(p, r) { const st = await fs.promises.stat(loc(p)); return { size: st.size, stream: fs.createReadStream(loc(p), r) } },
    async upload(local, remote, cb) {
      const total = fs.statSync(local).size
      let n = 0
      const src = fs.createReadStream(local, { highWaterMark: 4 * 1024 * 1024 })
      src.on('data', (d) => { n += d.length; cb(n, total) })
      await pipeline(src, fs.createWriteStream(loc(remote), { highWaterMark: 4 * 1024 * 1024 }))
    },
    async download(remote, local, cb) {
      const total = (await fs.promises.stat(loc(remote))).size
      let n = 0
      const src = fs.createReadStream(loc(remote), { highWaterMark: 4 * 1024 * 1024 })
      src.on('data', (d) => { n += d.length; cb(n, total) })
      await pipeline(src, fs.createWriteStream(local, { highWaterMark: 4 * 1024 * 1024 }))
    },
    async close() { await smbUnmount(c) },
  }
}

// ------------------------------------------------------------------ SFTP
async function sftpProvider(c) {
  const Client = require('ssh2-sftp-client')
  let sftp = null
  const connect = async () => {
    const cl = new Client()
    await cl.connect({
      host: c.host, port: Number(c.port) || 22, username: c.username, password: c.password, readyTimeout: 15000, keepaliveInterval: 15000,
      hostHash: 'sha256',
      // Trust on first use: remember the server's fingerprint and refuse if it ever changes.
      hostVerifier: (hash) => {
        const known = store.get(c.id).hostKey
        if (known) return known === hash
        store.save({ id: c.id, hostKey: hash })
        return true
      },
    }).catch((e) => { throw new Error(/hostkey|verif/i.test(e.message) ? 'The server identity changed since the first connection. If you expected this, delete and re-add the connection.' : e.message) })
    return cl
  }
  const cl = async () => (sftp ||= await connect())
  const retry = async (fn) => {
    try { return await fn(await cl()) } catch (e) {
      if (!/not connected|No SFTP|ECONN|EPIPE|closed|ended/i.test(e.message)) throw e
      try { await sftp?.end() } catch { /* ignore */ }
      sftp = null
      return fn(await cl())
    }
  }
  return {
    list: (p) => retry(async (s) => {
      const items = await s.list(clean(p))
      // A symbolic link may point at a folder (common on NAS shares), so resolve links.
      return Promise.all(items.map(async (e) => {
        let isFolder = e.type === 'd'
        if (e.type === 'l') { try { isFolder = (await s.stat(join(p, e.name))).isDirectory } catch { /* broken link */ } }
        return { name: e.name, isFolder, size: e.size, mtime: e.modifyTime ? new Date(e.modifyTime).toISOString() : null }
      }))
    }),
    stat: (p) => retry(async (s) => { const st = await s.stat(clean(p)); return { isFolder: st.isDirectory, size: st.size } }),
    mkdir: (p) => retry((s) => s.mkdir(clean(p), true)),
    rename: (a, b) => retry((s) => s.rename(clean(a), clean(b))),
    remove: (p) => retry((s) => s.delete(clean(p))),
    readStream: (p, r) => retry(async (s) => { const st = await s.stat(clean(p)); return { size: st.size, stream: s.createReadStream(clean(p), r) } }),
    upload: (local, remote, cb) => retry((s) => s.fastPut(local, clean(remote), { step: (t, _c, total) => cb(t, total) })),
    download: (remote, local, cb) => retry((s) => s.fastGet(clean(remote), local, { step: (t, _c, total) => cb(t, total) })),
    close: async () => { try { await sftp?.end() } catch { /* ignore */ } sftp = null },
  }
}

// ------------------------------------------------------------------ WebDAV
async function webdavProvider(c) {
  const { createClient } = await import('webdav')
  const base = `${c.secure ? 'https' : 'http'}://${c.host}:${Number(c.port) || (c.secure ? 5006 : 5005)}${('/' + String(c.basePath || '').replace(/^\/+/, '')).replace(/\/$/, '')}`
  const client = createClient(base, {
    username: c.username, password: c.password,
    ...(c.secure && c.insecureTls ? { httpsAgent: new https.Agent({ rejectUnauthorized: false }) } : {}),
  })
  return {
    list: async (p) => (await client.getDirectoryContents(clean(p))).map((e) => ({ name: e.basename, isFolder: e.type === 'directory', size: e.size || 0, mtime: e.lastmod ? new Date(e.lastmod).toISOString() : null })),
    stat: async (p) => { const st = await client.stat(clean(p)); return { isFolder: st.type === 'directory', size: st.size || 0 } },
    mkdir: (p) => client.createDirectory(clean(p), { recursive: true }),
    rename: (a, b) => client.moveFile(clean(a), clean(b)),
    remove: (p) => client.deleteFile(clean(p)),
    async readStream(p, r) {
      const st = await client.stat(clean(p))
      return { size: st.size || 0, stream: client.createReadStream(clean(p), r && r.end !== undefined ? { range: { start: r.start, end: r.end } } : r && r.start ? { range: { start: r.start } } : undefined) }
    },
    async upload(local, remote, cb) {
      const size = fs.statSync(local).size
      await client.putFileContents(clean(remote), fs.createReadStream(local), { overwrite: true, contentLength: size, onUploadProgress: (e) => cb(e.loaded, e.total || size) })
    },
    async download(remote, local, cb) {
      const total = (await client.stat(clean(remote))).size || 0
      let n = 0
      const src = client.createReadStream(clean(remote))
      src.on('data', (d) => { n += d.length; cb(n, total) })
      await pipeline(src, fs.createWriteStream(local))
    },
    close: async () => {},
  }
}

// ------------------------------------------------------------------ connection cache + operations
const providers = new Map() // connId -> { sig, provider }
async function provider(c) {
  const sig = [c.protocol, c.host, c.port, c.username, c.password, c.share, c.basePath, c.secure, c.insecureTls, c.domain].join('|')
  const hit = providers.get(c.id)
  if (hit && hit.sig === sig) return hit.provider
  if (hit) await hit.provider.close().catch(() => {})
  const p = c.protocol === 'sftp' ? await sftpProvider(c) : c.protocol === 'webdav' ? await webdavProvider(c) : await smbProvider(c)
  providers.set(c.id, { sig, provider: p })
  return p
}
const get = async (id) => provider(store.get(id))

async function test(c) {
  const full = { id: c.id || 'test-' + crypto.randomUUID(), ...c }
  const p = await provider(full)
  const items = await p.list('/')
  if (!c.id) { await p.close().catch(() => {}); providers.delete(full.id) }
  return `Connected. ${items.length} item(s) at the top level.`
}

async function disconnect(id) {
  const hit = providers.get(id)
  providers.delete(id)
  if (hit) await hit.provider.close().catch(() => {})
}
async function closeAll() { await Promise.all([...providers.keys()].map(disconnect)) }

async function list(id, p) {
  const items = await (await get(id)).list(p)
  return items.map((e) => ({ ...e, path: join(p, e.name) }))
}
async function mkdir(id, dir, name) { await (await get(id)).mkdir(join(dir, name)) }
async function rename(id, from, name) {
  const parent = clean(from).split('/').slice(0, -1).join('/') || '/'
  await (await get(id)).rename(from, join(parent, name))
}
// Files only; folders can never be deleted from the app.
async function remove(id, paths) {
  const p = await get(id)
  for (const x of paths) if ((await p.stat(x)).isFolder) throw new Error('Folders cannot be deleted. Select files only.')
  for (const x of paths) await p.remove(x)
}

// ------------------------------------------------------------------ search (recursive, streamed)
const searches = new Map()
async function search(id, root, q, kind, sid, emit) {
  const p = await get(id)
  const state = { cancelled: false }
  searches.set(sid, state)
  const needle = q.toLowerCase()
  const files = [], folders = []
  const queue = [clean(root)]
  const depth = new Map([[clean(root), 0]]) // guards against symlink loops
  let scanned = 0, last = 0
  const started = Date.now()
  const stop = () => state.cancelled || files.length + folders.length >= 500 || scanned > 300000 || Date.now() - started > 60000
  const push = (done) => {
    if (!done && Date.now() - last < 300) return
    last = Date.now()
    emit({ id: sid, files: [...files], folders: [...folders], scanned, done, capped: files.length + folders.length >= 500 })
  }
  const rel = (x) => x.slice(clean(root) === '/' ? 1 : clean(root).length + 1)
  const scan = async (dir) => {
    let items
    try { items = await p.list(dir) } catch { return }
    for (const e of items) {
      scanned++
      const full = join(dir, e.name)
      if (e.isFolder) {
        if ((depth.get(dir) || 0) < 10) { depth.set(full, (depth.get(dir) || 0) + 1); queue.push(full) }
        if (kind !== 'files' && e.name.toLowerCase().includes(needle)) folders.push({ prefix: full, name: rel(full) })
      } else if (kind !== 'folders' && e.name.toLowerCase().includes(needle)) {
        files.push({ key: full, name: rel(full), size: e.size, lastModified: e.mtime || undefined })
      }
    }
    push(false)
  }
  let active = 0
  const workers = Array.from({ length: 4 }, async () => {
    while (!stop()) {
      const dir = queue.shift()
      if (dir === undefined) { if (active === 0) break; await sleep(40); continue }
      active++
      try { await scan(dir) } finally { active-- }
    }
  })
  await Promise.all(workers)
  searches.delete(sid)
  push(true)
  return true
}
const cancelSearch = (sid) => { const s = searches.get(sid); if (s) s.cancelled = true }

// ------------------------------------------------------------------ transfers
async function allFiles(p, dir, rel = '') {
  const out = []
  for (const e of await p.list(dir)) {
    const full = join(dir, e.name)
    if (e.isFolder) out.push(...(await allFiles(p, full, path.join(rel, e.name))))
    else out.push({ path: full, rel: path.join(rel, e.name), size: e.size })
  }
  return out
}

async function upload(id, dir, paths, onProgress) {
  const p = await get(id)
  const one = async (local, remoteDir) => {
    const st = fs.statSync(local)
    const name = path.basename(local)
    if (st.isDirectory()) {
      const sub = join(remoteDir, name)
      await p.mkdir(sub)
      for (const n of fs.readdirSync(local)) await one(path.join(local, n), sub)
      return
    }
    const tid = `up:${Date.now()}:${local}`
    const base = { id: tid, name, kind: 'upload', total: st.size }
    onProgress({ ...base, loaded: 0, state: 'active' })
    try {
      let lastSent = 0
      await p.upload(local, join(remoteDir, name), (n) => { if (Date.now() - lastSent > 150) { lastSent = Date.now(); onProgress({ ...base, loaded: n, state: 'active' }) } })
      onProgress({ ...base, loaded: st.size, state: 'done' })
    } catch (e) { onProgress({ ...base, loaded: 0, state: 'error', error: e.message }) }
  }
  for (const l of paths) {
    try { await one(l, dir) } catch (e) { onProgress({ id: `err:${l}`, name: path.basename(l), kind: 'upload', loaded: 0, total: 0, state: 'error', error: e.message }) }
  }
}

async function downloadOne(p, remote, local, size, onProgress) {
  const tid = `dl:${Date.now()}:${remote}`
  const name = path.basename(local)
  const base = { id: tid, name, kind: 'download', total: size }
  onProgress({ ...base, loaded: 0, state: 'active' })
  try {
    fs.mkdirSync(path.dirname(local), { recursive: true })
    let lastSent = 0
    await p.download(remote, local, (n) => { if (Date.now() - lastSent > 150) { lastSent = Date.now(); onProgress({ ...base, loaded: n, state: 'active' }) } })
    onProgress({ ...base, loaded: size, state: 'done' })
  } catch (e) { onProgress({ ...base, loaded: 0, state: 'error', error: e.message }) }
}

async function download(id, items, destDir, onProgress) {
  const p = await get(id)
  for (const it of items) {
    if (it.isFolder) {
      for (const f of await allFiles(p, it.path, it.name)) await downloadOne(p, f.path, path.join(destDir, f.rel), f.size, onProgress)
    } else {
      await downloadOne(p, it.path, path.join(destDir, it.name), it.size || 0, onProgress)
    }
  }
}

// ------------------------------------------------------------------ preview: local proxy with Range support
const secret = crypto.randomBytes(16).toString('hex')
let proxy = null
async function proxyPort() {
  if (proxy) return proxy.address().port
  proxy = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.searchParams.get('k') !== secret) { res.writeHead(403); return res.end() }
      const [, , id] = u.pathname.split('/')
      const rp = u.searchParams.get('p') || '/'
      const p = await get(id)
      const { size } = await p.stat(rp)
      const type = mime.lookup(rp) || 'application/octet-stream'
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
      let start = 0, end = size - 1, status = 200
      if (m && (m[1] || m[2])) {
        start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]))
        end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
        status = 206
      }
      if (size === 0) { res.writeHead(200, { 'Content-Type': type, 'Content-Length': 0 }); return res.end() }
      const { stream } = await p.readStream(rp, { start, end })
      res.writeHead(status, {
        'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
        ...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      })
      req.on('close', () => stream.destroy())
      stream.on('error', () => res.destroy())
      stream.pipe(res)
    } catch { try { res.writeHead(500); res.end() } catch { /* ignore */ } }
  })
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
  return proxy.address().port
}
async function previewUrl(id, remote) {
  const port = await proxyPort()
  return `http://127.0.0.1:${port}/n/${id}?${new URLSearchParams({ k: secret, p: remote })}`
}

module.exports = { discover, smbShares, test, list, mkdir, rename, remove, search, cancelSearch, upload, download, previewUrl, disconnect, closeAll }
