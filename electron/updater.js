const { app, shell } = require('electron')
const { spawn, execFileSync } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const OWNER = 'FahadBinAbdullah7'
const REPO = 'storage-browser'
const APP_NAME = 'Cloudpeek'
const RELEASES_URL = `https://github.com/${OWNER}/${REPO}/releases/latest`

const cmp = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  return 0
}

// Windows: electron-updater (works unsigned). macOS: our own updater below, because the
// built-in Squirrel.Mac updater refuses unsigned apps ("code signature did not pass validation").
function setup(emit) {
  if (!app.isPackaged) return {}
  // Remember the latest state: the window may finish loading after the check has already answered.
  let last = null
  const send = (s) => { last = s; emit(s) }
  return process.platform === 'darwin' ? macUpdater(send, () => last) : winUpdater(send, () => last)
}

function winUpdater(send, getState) {
  const { autoUpdater } = require('electron-updater')
  // Nothing downloads or installs without the user's click.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }))
  autoUpdater.on('update-not-available', () => send({ state: 'none' }))
  autoUpdater.on('update-available', (i) => send({ state: 'available', version: i.version }))
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => send({ state: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => send({ state: 'error', message: e?.message || 'Update failed' }))
  const check = () => autoUpdater.checkForUpdates().catch(() => {})
  check()
  setInterval(check, 4 * 60 * 60 * 1000)
  return {
    getState,
    check,
    download: () => autoUpdater.downloadUpdate().catch((e) => send({ state: 'error', message: e.message })),
    install: () => autoUpdater.quitAndInstall(),
    openReleases: () => shell.openExternal(RELEASES_URL),
  }
}

function macUpdater(send, getState) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  let release = null, asset = null, staged = null, busy = false

  const installedApp = () => {
    const m = /^(.*?\.app)\//.exec(app.getPath('exe'))
    if (!m) throw new Error('Could not find the installed app.')
    return m[1]
  }

  async function check() {
    if (busy || (last() && ['downloading', 'ready'].includes(last().state))) return
    send({ state: 'checking' })
    try {
      const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) throw new Error(`Update check failed (HTTP ${res.status})`)
      const r = await res.json()
      const latest = String(r.tag_name).replace(/^v/, '')
      if (cmp(latest, app.getVersion()) <= 0) return send({ state: 'none' })
      const a = (r.assets || []).find((x) => x.name === `Cloudpeek-Mac-${arch}.zip`)
      if (!a) return send({ state: 'none' }) // release still uploading
      release = r; asset = a
      send({ state: 'available', version: latest })
    } catch (e) {
      send({ state: 'error', message: e.message })
    }
  }
  const last = getState

  async function download() {
    if (!asset || busy) return
    busy = true
    const dir = path.join(os.tmpdir(), 'cloudpeek-update')
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, asset.name)
      const res = await fetch(asset.browser_download_url, { redirect: 'follow' })
      if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
      const total = asset.size || Number(res.headers.get('content-length')) || 0
      const hash = crypto.createHash('sha256')
      const out = fs.createWriteStream(file)
      let loaded = 0, lastSent = 0
      for await (const chunk of res.body) {
        hash.update(chunk)
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
        loaded += chunk.length
        if (Date.now() - lastSent > 150) { lastSent = Date.now(); send({ state: 'downloading', percent: total ? Math.floor((loaded / total) * 100) : 0 }) }
      }
      await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())))
      if (total && loaded !== total) throw new Error('Download was incomplete. Please try again.')
      const d = /^sha256:([0-9a-f]{64})$/i.exec(asset.digest || '')
      if (d && hash.digest('hex') !== d[1].toLowerCase()) throw new Error('Download failed its integrity check. Please try again.')

      // Unpack next to the installed app so the final swap is a same-volume rename.
      const target = installedApp()
      const stage = path.join(path.dirname(target), `.${APP_NAME}-update`)
      fs.rmSync(stage, { recursive: true, force: true })
      fs.mkdirSync(stage)
      execFileSync('ditto', ['-xk', file, stage])
      const newApp = path.join(stage, `${APP_NAME}.app`)
      if (!fs.existsSync(newApp)) throw new Error('The downloaded update is not a valid app.')
      fs.rmSync(dir, { recursive: true, force: true })
      staged = { stage, newApp, target }
      send({ state: 'ready', version: String(release.tag_name).replace(/^v/, '') })
    } catch (e) {
      const msg = e.code === 'EACCES' || e.code === 'EPERM' ? "Can't write to the Applications folder. Reinstall from the download page." : e.message
      send({ state: 'error', message: msg })
    } finally { busy = false }
  }

  // A small detached script waits for this process to exit, swaps the app, and reopens it.
  function install() {
    if (!staged) return
    const script = path.join(os.tmpdir(), 'cloudpeek-apply-update.sh')
    fs.writeFileSync(script, [
      '#!/bin/bash',
      'PID="$1"; STAGE="$2"; NEWAPP="$3"; APP="$4"; OLD="$APP.old"',
      'for i in $(seq 1 200); do kill -0 "$PID" 2>/dev/null || break; sleep 0.3; done',
      'rm -rf "$OLD"',
      'if mv "$APP" "$OLD" && mv "$NEWAPP" "$APP"; then',
      '  rm -rf "$OLD"',
      'elif [ -d "$OLD" ] && [ ! -d "$APP" ]; then',
      '  mv "$OLD" "$APP"',
      'fi',
      'xattr -dr com.apple.quarantine "$APP" 2>/dev/null',
      'rm -rf "$STAGE"',
      'open "$APP"',
    ].join('\n'), { mode: 0o755 })
    spawn('/bin/bash', [script, String(process.pid), staged.stage, staged.newApp, staged.target], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
  }

  check()
  setInterval(check, 4 * 60 * 60 * 1000)
  return { getState, check, download, install, openReleases: () => shell.openExternal(RELEASES_URL) }
}

module.exports = { setup }
