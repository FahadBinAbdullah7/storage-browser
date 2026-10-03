const { app, shell } = require('electron')

const RELEASES_URL = 'https://github.com/FahadBinAbdullah7/storage-browser/releases/latest'

function setup(emit) {
  if (!app.isPackaged) return {}
  // Remember the latest state: the window may finish loading after the update check has already answered.
  let last = null
  const send = (s) => { last = s; emit(s) }
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
    getState: () => last,
    check,
    download: () => autoUpdater.downloadUpdate().catch((e) => send({ state: 'error', message: e.message })),
    install: () => autoUpdater.quitAndInstall(),
    // Unsigned macOS builds cannot self-install; fall back to the download page.
    openReleases: () => shell.openExternal(RELEASES_URL),
  }
}

module.exports = { setup }
