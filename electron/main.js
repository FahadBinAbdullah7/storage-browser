const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, session } = require('electron')
const path = require('path')
const crypto = require('crypto')
const store = require('./store')
const objects = require('./objects')
const d1 = require('./d1')
const updater = require('./updater')
const nas = require('./nas')

const DEV = !!process.env.VITE_DEV
let win
let upd = {}

const send = (ch) => (d) => win && !win.isDestroyed() && win.webContents.send(ch, d)

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 560,
    title: 'Cloudpeek',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('http://localhost:5173')) e.preventDefault() })
  if (DEV) win.loadURL('http://localhost:5173')
  else win.loadFile(path.join(__dirname, '../dist/index.html'))
}

app.whenReady().then(() => {
  if (!DEV) {
    session.defaultSession.webRequest.onHeadersReceived((d, cb) => cb({
      responseHeaders: {
        ...d.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; style-src 'self' 'unsafe-inline'; img-src * data: blob:; media-src * blob:; frame-src https: http://127.0.0.1:*; connect-src 'self'"],
      },
    }))
  }
  createWindow()
  upd = updater.setup(send('update'))
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
})
app.on('before-quit', () => { nas.closeAll().catch(() => {}) })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// Wrap handlers so errors reach the renderer as readable messages.
const h = (ch, fn) => ipcMain.handle(ch, async (_e, ...a) => {
  try { return { ok: true, data: await fn(...a) } }
  catch (err) { return { ok: false, error: err?.name && err.name !== 'Error' ? `${err.name}: ${err.message}` : err?.message || String(err) } }
})

h('app:version', () => app.getVersion())
h('clipboard:write', (t) => clipboard.writeText(t))
h('shell:open', (u) => { if (/^https?:\/\//.test(u)) shell.openExternal(u) })
h('update:state', () => upd.getState?.() ?? null)
h('update:check', () => upd.check?.())
h('update:download', () => upd.download?.())
h('update:install', () => upd.install?.())

h('conn:list', () => store.listPublic())
h('conn:save', (c) => store.save({ ...c, id: c.id || crypto.randomUUID() }))
h('conn:remove', (id) => store.remove(id))
h('conn:test', async (c) => {
  const full = c.id ? { ...store.get(c.id), ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== '' && v !== undefined && v !== null)) } : c
  if (full.type === 'nas') return nas.test(full)
  if (full.type === 'd1') { const dbs = await d1.databases(full); return `Connected. ${dbs.length} database(s).` }
  const b = await objects.listBuckets(full)
  return `Connected. ${b.length} bucket(s).`
})

const C = (id) => store.get(id)
h('obj:buckets', (id) => objects.listBuckets(C(id)))
h('obj:list', (id, b, p, t) => objects.list(C(id), b, p, t))
h('obj:presign', (id, b, k, s) => objects.presign(C(id), b, k, s))
h('obj:listStream', (id, b, p, lid) => { objects.listStream(C(id), b, p, lid, send('listing')); return true })
h('obj:listCancel', (lid) => objects.cancelListing(lid))
h('obj:text', (id, b, k) => objects.getText(C(id), b, k))
h('obj:head', (id, b, k) => objects.head(C(id), b, k))
h('obj:mkdir', (id, b, p) => objects.mkdir(C(id), b, p))
h('obj:remove', (id, b, keys) => objects.remove(C(id), b, keys))
h('obj:move', (id, b, from, to) => objects.move(C(id), b, from, to))
h('obj:headFull', (id, b, k) => objects.headFull(C(id), b, k))
h('obj:setMeta', (id, b, k, m) => objects.setMeta(C(id), b, k, m))
h('obj:copy', (id, b, from, to) => objects.copy(C(id), b, from, to))
h('obj:createBucket', (id, n) => objects.createBucket(C(id), n))
h('obj:search', (id, b, p, q, sid, kind) => objects.search(C(id), b, p, q, sid, send('search'), kind))
h('obj:searchCancel', (sid) => objects.cancelSearch(sid))
h('obj:stats', (id, b, p) => objects.stats(C(id), b, p))
h('obj:upload', (id, b, prefix, paths) => { objects.upload(C(id), b, prefix, paths, send('transfer')); return true })
h('obj:pickUpload', async (id, b, prefix, dir) => {
  const r = await dialog.showOpenDialog(win, { properties: [dir ? 'openDirectory' : 'openFile', ...(dir ? [] : ['multiSelections'])] })
  if (r.canceled) return false
  objects.upload(C(id), b, prefix, r.filePaths, send('transfer'))
  return true
})
h('obj:download', async (id, b, keys) => {
  const c = C(id)
  const files = await objects.expand(c, b, keys)
  if (!files.length) return false
  const progress = send('transfer')
  if (keys.length === 1 && !keys[0].endsWith('/')) {
    const r = await dialog.showSaveDialog(win, { defaultPath: keys[0].split('/').pop() })
    if (r.canceled) return false
    objects.downloadTo(c, b, keys[0], r.filePath, progress)
    return true
  }
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Download to…' })
  if (r.canceled) return false
  // Keep folder structure relative to the parent of each selected item.
  const base = (k) => (k.endsWith('/') ? k.slice(0, k.slice(0, -1).lastIndexOf('/') + 1) : k.slice(0, k.lastIndexOf('/') + 1))
  // All files start together; the transfer budget in objects.js decides how many run at once.
  Promise.all(files.map((f) => {
    const root = keys.find((k) => f.key === k || (k.endsWith('/') && f.key.startsWith(k))) || f.key
    return objects.downloadTo(c, b, f.key, path.join(r.filePaths[0], f.key.slice(base(root).length)), progress, f.size)
  })).catch(() => {})
  return true
})

h('d1:databases', (id) => d1.databases(C(id)))
h('d1:tables', (id, db) => d1.tables(C(id), db))
h('d1:browse', (id, db, t, l, o) => d1.browse(C(id), db, t, l, o))
h('d1:query', (id, db, sql) => d1.query(C(id), db, sql))


// ---- NAS (SMB / SFTP / WebDAV)
h('nas:discover', () => nas.discover())
h('nas:shares', (input) => nas.smbShares(input))
h('nas:list', (id, p) => nas.list(id, p))
h('nas:mkdir', (id, dir, name) => nas.mkdir(id, dir, name))
h('nas:rename', (id, from, name) => nas.rename(id, from, name))
h('nas:remove', (id, paths) => nas.remove(id, paths))
h('nas:search', (id, root, q, kind, sid) => nas.search(id, root, q, kind, sid, send('search')))
h('nas:searchCancel', (sid) => nas.cancelSearch(sid))
h('nas:previewUrl', (id, p) => nas.previewUrl(id, p))
h('nas:disconnect', (id) => nas.disconnect(id))
h('nas:upload', (id, dir, paths) => { nas.upload(id, dir, paths, send('transfer')).catch(() => {}); return true })
h('nas:pickUpload', async (id, dir, isDir) => {
  const r = await dialog.showOpenDialog(win, { properties: [isDir ? 'openDirectory' : 'openFile', ...(isDir ? [] : ['multiSelections'])] })
  if (r.canceled) return false
  nas.upload(id, dir, r.filePaths, send('transfer')).catch(() => {})
  return true
})
h('nas:download', async (id, items) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: 'Download to…' })
  if (r.canceled) return false
  nas.download(id, items, r.filePaths[0], send('transfer')).catch(() => {})
  return true
})
