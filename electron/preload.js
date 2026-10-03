const { contextBridge, ipcRenderer, webUtils } = require('electron')

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a)
const on = (ch) => (cb) => {
  const h = (_e, d) => cb(d)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

contextBridge.exposeInMainWorld('api', {
  version: () => invoke('app:version'),
  pathForFile: (f) => webUtils.getPathForFile(f),
  conn: {
    list: () => invoke('conn:list'),
    save: (c) => invoke('conn:save', c),
    remove: (id) => invoke('conn:remove', id),
    test: (c) => invoke('conn:test', c),
  },
  obj: {
    buckets: (id) => invoke('obj:buckets', id),
    list: (id, b, p, t) => invoke('obj:list', id, b, p, t),
    presign: (id, b, k, s) => invoke('obj:presign', id, b, k, s),
    text: (id, b, k) => invoke('obj:text', id, b, k),
    head: (id, b, k) => invoke('obj:head', id, b, k),
    headFull: (id, b, k) => invoke('obj:headFull', id, b, k),
    setMeta: (id, b, k, m) => invoke('obj:setMeta', id, b, k, m),
    copy: (id, b, f, t) => invoke('obj:copy', id, b, f, t),
    createBucket: (id, n) => invoke('obj:createBucket', id, n),
    search: (id, b, p, q, sid, kind) => invoke('obj:search', id, b, p, q, sid, kind),
    searchCancel: (sid) => invoke('obj:searchCancel', sid),
    stats: (id, b, p) => invoke('obj:stats', id, b, p),
    mkdir: (id, b, p) => invoke('obj:mkdir', id, b, p),
    remove: (id, b, keys) => invoke('obj:remove', id, b, keys),
    move: (id, b, from, to) => invoke('obj:move', id, b, from, to),
    upload: (id, b, prefix, paths) => invoke('obj:upload', id, b, prefix, paths),
    pickUpload: (id, b, prefix, dir) => invoke('obj:pickUpload', id, b, prefix, dir),
    download: (id, b, keys) => invoke('obj:download', id, b, keys),
  },
  d1: {
    databases: (id) => invoke('d1:databases', id),
    tables: (id, db) => invoke('d1:tables', id, db),
    browse: (id, db, t, l, o) => invoke('d1:browse', id, db, t, l, o),
    query: (id, db, sql) => invoke('d1:query', id, db, sql),
  },
  gd: {
    signIn: (i) => invoke('g:signIn', i),
    drives: (id) => invoke('g:drives', id),
    list: (id, d, f, t) => invoke('g:list', id, d, f, t),
    search: (id, d, q, k) => invoke('g:search', id, d, q, k),
    info: (id, f) => invoke('g:info', id, f),
    mkdir: (id, p, n) => invoke('g:mkdir', id, p, n),
    rename: (id, f, n) => invoke('g:rename', id, f, n),
    trash: (id, ids) => invoke('g:trash', id, ids),
    share: (id, f) => invoke('g:share', id, f),
    previewUrl: (id, f, m) => invoke('g:previewUrl', id, f, m),
    upload: (id, p, paths) => invoke('g:upload', id, p, paths),
    pickUpload: (id, p, dir) => invoke('g:pickUpload', id, p, dir),
    download: (id, d, items) => invoke('g:download', id, d, items),
  },
  copy: (text) => invoke('clipboard:write', text),
  openExternal: (u) => invoke('shell:open', u),
  onTransfer: on('transfer'),
  onSearch: on('search'),
  onUpdate: on('update'),
  update: { state: () => invoke('update:state'), check: () => invoke('update:check'), download: () => invoke('update:download'), install: () => invoke('update:install') },
})
