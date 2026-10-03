const { app, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

const SECRET_FIELDS = ['secretAccessKey', 'apiToken']
const file = () => path.join(app.getPath('userData'), 'connections.json')

const enc = (v) => {
  if (!v) return ''
  return safeStorage.isEncryptionAvailable()
    ? 'enc:' + safeStorage.encryptString(v).toString('base64')
    : 'raw:' + Buffer.from(v).toString('base64')
}
const dec = (v) => {
  if (!v) return ''
  if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'))
  if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString()
  return v
}

function readAll() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')) } catch { return [] }
}
function writeAll(list) {
  fs.mkdirSync(path.dirname(file()), { recursive: true })
  fs.writeFileSync(file(), JSON.stringify(list, null, 2), { mode: 0o600 })
}

// Full connection with decrypted secrets (main process only).
function get(id) {
  const c = readAll().find((x) => x.id === id)
  if (!c) throw new Error('Connection not found')
  const out = { ...c }
  for (const f of SECRET_FIELDS) out[f] = dec(c[f])
  return out
}

// Safe for the renderer: secrets replaced by a boolean flag.
function listPublic() {
  return readAll().map((c) => {
    const out = { ...c }
    for (const f of SECRET_FIELDS) { out['has_' + f] = !!c[f]; delete out[f] }
    return out
  })
}

function save(conn) {
  const list = readAll()
  const idx = list.findIndex((x) => x.id === conn.id)
  const prev = idx >= 0 ? list[idx] : {}
  const next = { ...prev, ...conn }
  for (const f of SECRET_FIELDS) next[f] = conn[f] ? enc(conn[f]) : prev[f] || ''
  if (idx >= 0) list[idx] = next; else list.push(next)
  writeAll(list)
  return next.id
}

function remove(id) { writeAll(readAll().filter((x) => x.id !== id)) }

module.exports = { get, listPublic, save, remove }
