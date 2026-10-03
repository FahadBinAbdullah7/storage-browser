const { shell } = require('electron')
const http = require('http')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const mime = require('mime-types')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const store = require('./store')
const oauth = require('./oauth.json')

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const SCOPES = 'openid email https://www.googleapis.com/auth/drive'
const FOLDER = 'application/vnd.google-apps.folder'
const FIELDS = 'id,name,mimeType,size,modifiedTime,webViewLink,shortcutDetails'

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const clientOf = (c) => ({ id: c.clientId || oauth.google.clientId, secret: c.clientSecret || oauth.google.clientSecret })
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")

// ---------------------------------------------------------------- sign-in (OAuth + PKCE, loopback redirect)
// The password is typed on Google's own page in the user's browser; Cloudpeek only receives a token.
async function signIn(input) {
  const { id, secret } = clientOf(input)
  if (!id) throw new Error('NO_CLIENT_ID')
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(16))
  const server = http.createServer()
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const redirect = `http://127.0.0.1:${server.address().port}`

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error('Sign-in timed out. Please try again.')) }, 5 * 60 * 1000)
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirect)
      if (u.pathname !== '/') { res.writeHead(404); return res.end() }
      const err = u.searchParams.get('error')
      const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(`<body style="font:16px system-ui;background:#000;color:#eee;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>${ok ? 'Signed in ✓' : 'Sign-in failed'}</h2><p>You can close this tab and return to Cloudpeek.</p></div></body>`)
      clearTimeout(timer); server.close()
      ok ? resolve(u.searchParams.get('code')) : reject(new Error(err ? `Google: ${err}` : 'Sign-in was not completed.'))
    })
    shell.openExternal('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: id, redirect_uri: redirect, response_type: 'code', scope: SCOPES, state,
      code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
    }))
  })

  const tok = await tokenRequest({ code, client_id: id, client_secret: secret || '', code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' })
  if (!tok.refresh_token) throw new Error('Google did not return a refresh token. Remove Cloudpeek at myaccount.google.com/permissions and sign in again.')
  const me = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + tok.access_token } })).json()
  return { email: me.email || 'Google account', refreshToken: tok.refresh_token }
}

async function tokenRequest(params) {
  const body = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== ''))
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (j.error === 'invalid_grant') throw new Error('Google sign-in expired. Edit the connection and sign in again.')
    throw new Error(j.error_description || j.error || `Google sign-in error (${res.status})`)
  }
  return j
}

// ---------------------------------------------------------------- authenticated API calls
const tokens = new Map()
async function accessToken(c) {
  const hit = tokens.get(c.id)
  if (hit && hit.exp > Date.now() + 60000) return hit.token
  const { id, secret } = clientOf(c)
  const j = await tokenRequest({ grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: id, client_secret: secret || '' })
  tokens.set(c.id, { token: j.access_token, exp: Date.now() + j.expires_in * 1000 })
  return j.access_token
}

async function api(c, url, opts = {}) {
  const go = async () => fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + (await accessToken(c)) } })
  let res = await go()
  if (res.status === 401) { tokens.delete(c.id); res = await go() }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error?.message || `Google Drive error (${res.status})`)
  }
  return res
}
const json = async (c, url, opts) => (await api(c, url, opts)).json()
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)).toString()

// ---------------------------------------------------------------- browsing
async function drives(c) {
  const out = [{ id: 'root', name: 'My Drive' }]
  let t
  do {
    const r = await json(c, `${API}/drives?${qs({ pageSize: 100, fields: 'nextPageToken,drives(id,name)', pageToken: t })}`)
    out.push(...(r.drives || []).map((d) => ({ id: d.id, name: d.name, shared: true })))
    t = r.nextPageToken
  } while (t)
  return out
}

function toItem(f) {
  // Shortcuts behave like the thing they point to.
  const sc = f.shortcutDetails
  const isShortcut = f.mimeType === 'application/vnd.google-apps.shortcut' && sc
  const mimeType = isShortcut ? sc.targetMimeType : f.mimeType
  return {
    id: isShortcut ? sc.targetId : f.id, name: f.name, mimeType, isFolder: mimeType === FOLDER,
    size: Number(f.size || 0), modifiedTime: f.modifiedTime, link: f.webViewLink,
  }
}

const scopeOf = (driveId) => (driveId && driveId !== 'root' ? { corpora: 'drive', driveId } : { corpora: 'user' })

async function list(c, driveId, folderId, pageToken) {
  const r = await json(c, `${API}/files?${qs({
    q: `'${esc(folderId)}' in parents and trashed=false`, fields: `nextPageToken,files(${FIELDS})`, pageSize: 1000,
    orderBy: 'folder,name', supportsAllDrives: true, includeItemsFromAllDrives: true, pageToken, ...scopeOf(driveId),
  })}`)
  return { items: (r.files || []).map(toItem), nextToken: r.nextPageToken || null }
}

// Server-side name search across the whole drive (fast, unlike scanning folders one by one).
async function search(c, driveId, term, kind) {
  const typeQ = kind === 'folders' ? ` and mimeType='${FOLDER}'` : kind === 'files' ? ` and mimeType!='${FOLDER}'` : ''
  const r = await json(c, `${API}/files?${qs({
    q: `name contains '${esc(term)}' and trashed=false${typeQ}`, fields: `files(${FIELDS})`, pageSize: 200,
    orderBy: 'folder,name', supportsAllDrives: true, includeItemsFromAllDrives: true, ...scopeOf(driveId),
  })}`)
  return (r.files || []).map(toItem)
}

async function info(c, id) {
  const f = await json(c, `${API}/files/${id}?${qs({ fields: FIELDS + ',owners(displayName,emailAddress),createdTime,parents', supportsAllDrives: true })}`)
  return { ...toItem(f), created: f.createdTime, owner: f.owners?.[0]?.displayName || '' }
}

// ---------------------------------------------------------------- changes
async function mkdir(c, parentId, name) {
  return json(c, `${API}/files?${qs({ supportsAllDrives: true, fields: 'id,name' })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
  })
}

async function rename(c, id, name) {
  await json(c, `${API}/files/${id}?${qs({ supportsAllDrives: true })}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
}

// Files go to the Drive trash (recoverable for 30 days). Folders can never be deleted from the app.
async function trash(c, ids) {
  for (const id of ids) {
    const f = await json(c, `${API}/files/${id}?${qs({ fields: 'mimeType', supportsAllDrives: true })}`)
    if (f.mimeType === FOLDER) throw new Error('Folders cannot be deleted. Select files only.')
  }
  for (const id of ids) {
    await json(c, `${API}/files/${id}?${qs({ supportsAllDrives: true })}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
  }
}

// "Anyone with the link can view" — only called after the user confirms.
async function share(c, id) {
  await api(c, `${API}/files/${id}/permissions?${qs({ supportsAllDrives: true })}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  })
  const f = await json(c, `${API}/files/${id}?${qs({ fields: 'webViewLink', supportsAllDrives: true })}`)
  return { view: f.webViewLink, download: `https://drive.google.com/uc?export=download&id=${id}` }
}

// ---------------------------------------------------------------- transfers
const CHUNK = 8 * 1024 * 1024 // multiple of 256 KB, as the resumable protocol requires

async function uploadFile(c, parentId, file, rel, size, onProgress) {
  const id = `up:${Date.now()}:${rel}`
  const base = { id, name: rel, kind: 'upload', total: size }
  onProgress({ ...base, loaded: 0, state: 'active' })
  try {
    const type = mime.lookup(file) || 'application/octet-stream'
    const init = await api(c, `${UPLOAD}/files?${qs({ uploadType: 'resumable', supportsAllDrives: true, fields: 'id,name' })}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify({ name: path.basename(file), parents: [parentId] }),
    })
    const loc = init.headers.get('location')
    let result
    if (size === 0) {
      result = await (await api(c, loc, { method: 'PUT', headers: { 'Content-Length': '0' } })).json()
    } else {
      const fh = await fs.promises.open(file, 'r')
      try {
        for (let start = 0; start < size; start += CHUNK) {
          const end = Math.min(start + CHUNK, size) - 1
          const buf = Buffer.alloc(end - start + 1)
          await fh.read(buf, 0, buf.length, start)
          const res = await fetch(loc, {
            method: 'PUT', body: buf,
            headers: { Authorization: 'Bearer ' + (await accessToken(c)), 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end}/${size}` },
          })
          if (res.status === 308) { onProgress({ ...base, loaded: end + 1, state: 'active' }); continue }
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error?.message || `Upload failed (${res.status})`)
          result = await res.json()
        }
      } finally { await fh.close() }
    }
    onProgress({ ...base, key: result?.id, loaded: size, state: 'done' })
  } catch (e) {
    onProgress({ ...base, loaded: 0, state: 'error', error: e.message })
  }
}

// Uploads files and whole folders (recreating the folder structure inside `parentId`).
async function upload(c, parentId, paths, onProgress) {
  const walk = async (p, parent) => {
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      const made = await mkdir(c, parent, path.basename(p))
      for (const n of fs.readdirSync(p)) await walk(path.join(p, n), made.id)
    } else {
      await uploadFile(c, parent, p, path.basename(p), st.size, onProgress)
    }
  }
  for (const p of paths) {
    try { await walk(p, parentId) } catch (e) { onProgress({ id: `err:${p}`, name: path.basename(p), kind: 'upload', loaded: 0, total: 0, state: 'error', error: e.message }) }
  }
}

// Google-native files (Docs, Sheets, Slides) have no bytes; they are exported instead.
const EXPORTS = {
  'application/vnd.google-apps.document': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.spreadsheet': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  'application/vnd.google-apps.presentation': ['application/pdf', '.pdf'],
  'application/vnd.google-apps.drawing': ['image/png', '.png'],
}

async function downloadTo(c, item, dest, onProgress) {
  const id = `dl:${Date.now()}:${item.id}`
  const exp = EXPORTS[item.mimeType]
  const name = exp && !item.name.endsWith(exp[1]) ? item.name + exp[1] : item.name
  const total = item.size || 0
  onProgress({ id, name, kind: 'download', loaded: 0, total, state: 'active' })
  try {
    const url = exp ? `${API}/files/${item.id}/export?${qs({ mimeType: exp[0] })}` : `${API}/files/${item.id}?${qs({ alt: 'media', supportsAllDrives: true })}`
    const res = await api(c, url)
    let loaded = 0
    const src = Readable.fromWeb(res.body)
    src.on('data', (d) => { loaded += d.length; onProgress({ id, name, kind: 'download', loaded, total, state: 'active' }) })
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    await pipeline(src, fs.createWriteStream(dest))
    onProgress({ id, name, kind: 'download', loaded: total || loaded, total: total || loaded, state: 'done' })
  } catch (e) {
    onProgress({ id, name, kind: 'download', loaded: 0, total, state: 'error', error: e.message })
  }
}

async function allFiles(c, driveId, folderId, rel = '') {
  const out = []
  let t = null
  do {
    const r = await list(c, driveId, folderId, t)
    for (const it of r.items) {
      if (it.isFolder) out.push(...(await allFiles(c, driveId, it.id, path.join(rel, it.name))))
      else out.push({ item: it, rel: path.join(rel, it.name) })
    }
    t = r.nextToken
  } while (t)
  return out
}

// ---------------------------------------------------------------- preview: a tiny local proxy adds the auth header
const proxySecret = crypto.randomBytes(16).toString('hex')
let proxy = null
async function proxyPort() {
  if (proxy) return proxy.address().port
  proxy = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1')
      const [, , connId, fileId] = u.pathname.split('/')
      if (u.searchParams.get('k') !== proxySecret) { res.writeHead(403); return res.end() }
      const c = store.get(connId)
      const m = u.searchParams.get('m') || ''
      const exp = EXPORTS[m]
      const url = exp ? `${API}/files/${fileId}/export?${qs({ mimeType: exp[0] })}` : `${API}/files/${fileId}?${qs({ alt: 'media', supportsAllDrives: true })}`
      const headers = { Authorization: 'Bearer ' + (await accessToken(c)) }
      if (req.headers.range) headers.Range = req.headers.range
      const up = await fetch(url, { headers })
      const out = {}
      for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (up.headers.get(h)) out[h] = up.headers.get(h)
      res.writeHead(up.status, out)
      if (!up.body) return res.end()
      Readable.fromWeb(up.body).on('error', () => res.destroy()).pipe(res)
      req.on('close', () => res.destroy())
    } catch { res.writeHead(500); res.end() }
  })
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r))
  return proxy.address().port
}
async function previewUrl(connId, fileId, mimeType) {
  const port = await proxyPort()
  return `http://127.0.0.1:${port}/g/${connId}/${fileId}?${qs({ k: proxySecret, m: mimeType || '' })}`
}

module.exports = { signIn, drives, list, search, info, mkdir, rename, trash, share, upload, downloadTo, allFiles, previewUrl, EXPORTS }
