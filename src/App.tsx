import { useCallback, useEffect, useState } from 'react'
import type { Conn, UpdateState } from './types'
import { call } from './util'
import ConnectionDialog from './components/ConnectionDialog'
import ObjectBrowser from './components/ObjectBrowser'
import D1Browser from './components/D1Browser'
import DriveBrowser from './components/DriveBrowser'
import Icon from './components/Icon'

const LABEL = { s3: 'S3', r2: 'R2', d1: 'D1', gdrive: 'Drive' } as const
const CARDS = [
  { t: 'r2', title: 'Cloudflare R2', desc: 'Account ID + access keys', icon: 'cloud' },
  { t: 's3', title: 'Amazon S3', desc: 'Access key + secret (or any S3-compatible)', icon: 'bucket' },
  { t: 'd1', title: 'Cloudflare D1', desc: 'Account ID + API token', icon: 'db' },
  { t: 'gdrive', title: 'Google Drive', desc: 'Sign in with your Google account', icon: 'folder' },
] as const

export default function App() {
  const [conns, setConns] = useState<Conn[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<Conn> | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [version, setVersion] = useState('')

  const reload = useCallback(async () => setConns(await call(window.api.conn.list())), [])
  useEffect(() => {
    reload()
    call(window.api.version()).then(setVersion)
    call(window.api.update.state()).then((s) => s && setUpdate(s)).catch(() => {})
    return window.api.onUpdate(setUpdate)
  }, [reload])

  const active = conns.find((c) => c.id === activeId)

  return (
    <div className="app">
      {update && (update.state === 'available' || update.state === 'downloading' || update.state === 'ready') && (
        <div className="banner">
          {update.state === 'available' && <>Version {update.version} is available. <button onClick={() => { window.api.update.download() }}>Update now</button></>}
          {update.state === 'downloading' && <>Downloading update… {update.percent}%</>}
          {update.state === 'ready' && <>Version {update.version} is ready. <button onClick={() => { window.api.update.install() }}>Restart</button></>}
        </div>
      )}
      {update?.state === 'error' && (
        <div className="banner err">
          Couldn't check for updates right now{' '}<span className="muted-w" title={update.message}>(hover for details)</span>{' '}
          <button onClick={() => window.api.openExternal('https://github.com/FahadBinAbdullah7/storage-browser/releases/latest')}>Download manually</button>
          <button className="ghost" onClick={() => setUpdate(null)}>Dismiss</button>
        </div>
      )}
      <div className="layout">
        <aside className="sidebar">
          <div className="drag" />
          <div className="brand"><span className="brand-ico"><Icon name="cloud" size={15} /></span><b>Cloudpeek</b><span className="ver">v{version}</span></div>
          <div className="side-head">
            <span>Connections</span>
            <button className="icon-btn" title="New connection" onClick={() => setEditing({ type: 'r2' })}><Icon name="plus" /></button>
          </div>
          <div className="side-list">
            {conns.length === 0 && <p className="muted pad small">No connections yet.</p>}
            {conns.map((c) => (
              <div key={c.id} className={'conn' + (c.id === activeId ? ' on' : '')} onClick={() => setActiveId(c.id)}>
                <span className={'tag ' + c.type}><Icon name={c.type === 'd1' ? 'db' : c.type === 'r2' ? 'cloud' : c.type === 'gdrive' ? 'folder' : 'bucket'} size={13} />{LABEL[c.type]}</span>
                <span className="grow ellipsis">{c.name}</span>
                <button className="icon-btn sm" title="Edit" onClick={(e) => { e.stopPropagation(); setEditing(c) }}><Icon name="settings" size={14} /></button>
              </div>
            ))}
          </div>
          <div className="side-foot muted">
            <span>v{version}</span>
            <button className="ghost sm" disabled={update?.state === 'checking'} onClick={() => window.api.update.check()}>
              {update?.state === 'checking' ? 'Checking…' : update?.state === 'none' ? 'Up to date ✓' : update?.state === 'available' ? 'Update available' : 'Check for updates'}
            </button>
          </div>
        </aside>
        <main className="main">
          <div className="drag top" />
          {!active && (
            <div className="welcome fade">
              <div className="logo-mark"><Icon name="cloud" size={34} /></div>
              <h1>Cloudpeek</h1>
              <p className="muted">Browse, preview and share files from S3 and R2, and explore D1 databases.</p>
              <div className="cards">
                {CARDS.map((c, i) => (
                  <button key={c.t} className="card" style={{ animationDelay: i * 70 + 'ms' }} onClick={() => setEditing({ type: c.t })}>
                    <span className={'c-ico ' + c.t}><Icon name={c.icon} size={22} /></span>
                    <b>{c.title}</b><span className="muted small">{c.desc}</span>
                  </button>
                ))}
              </div>
              {conns.length > 0 && <p className="muted small">…or pick a saved connection on the left.</p>}
            </div>
          )}
          {active && active.type === 'd1' && <D1Browser key={active.id} conn={active} />}
          {active && active.type === 'gdrive' && <DriveBrowser key={active.id} conn={active} />}
          {active && active.type !== 'd1' && active.type !== 'gdrive' && <ObjectBrowser key={active.id} conn={active} onChanged={reload} />}
        </main>
      </div>
      {editing && (
        <ConnectionDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async (id) => { setEditing(null); await reload(); setActiveId(id) }}
          onDeleted={async () => { setEditing(null); setActiveId(null); await reload() }}
        />
      )}
    </div>
  )
}
