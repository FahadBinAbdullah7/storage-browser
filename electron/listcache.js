const { app } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

// Remembers each folder listing on this computer so that opening a folder shows its sub-folders at once
// (the listing is then re-read quietly and replaced). One directory per connection so it can be wiped
// when the connection is deleted.
const MAX_FILES_PER_CONN = 600
const root = () => path.join(app.getPath('userData'), 'listcache')
const connDir = (id) => path.join(root(), String(id).replace(/[^\w-]/g, '_'))
const fileFor = (id, bucket, prefix) => path.join(connDir(id), crypto.createHash('sha1').update(bucket + '\n' + prefix).digest('hex') + '.json')

function get(id, bucket, prefix) {
  try { return JSON.parse(fs.readFileSync(fileFor(id, bucket, prefix), 'utf8')) } catch { return null }
}

function set(id, bucket, prefix, data) {
  try {
    const dir = connDir(id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(fileFor(id, bucket, prefix), JSON.stringify({ at: Date.now(), ...data }))
    const names = fs.readdirSync(dir)
    if (names.length > MAX_FILES_PER_CONN) {
      const old = names.map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => a.t - b.t).slice(0, names.length - MAX_FILES_PER_CONN + 50)
      for (const o of old) fs.rmSync(path.join(dir, o.n), { force: true })
    }
  } catch { /* the cache is only an accelerator */ }
}

function clearConn(id) { try { fs.rmSync(connDir(id), { recursive: true, force: true }) } catch { /* ignore */ } }

module.exports = { get, set, clearConn }
