import { useState } from 'react'
import type { Conn, ConnType } from '../types'
import { call } from '../util'
import Icon from './Icon'
import { parseEndpoint, type Parsed } from '../endpoint'

interface Props {
  initial: Partial<Conn>
  onClose(): void
  onSaved(id: string): void
  onDeleted(): void
}

export default function ConnectionDialog({ initial, onClose, onSaved, onDeleted }: Props) {
  const [f, setF] = useState<Record<string, string>>({
    type: initial.type || 'r2',
    name: initial.name || '',
    accessKeyId: initial.accessKeyId || '',
    secretAccessKey: '',
    region: initial.region || 'us-east-1',
    endpoint: initial.endpoint || '',
    accountId: initial.accountId || '',
    apiToken: '',
    defaultBucket: initial.defaultBucket || '',
    folders: initial.folders || '',
    publicBase: initial.publicBase || '',
    protocol: initial.protocol || 'smb',
    host: initial.host || '',
    port: initial.port ? String(initial.port) : '',
    username: initial.username || '',
    password: '',
    domain: initial.domain || '',
    share: initial.share || '',
    basePath: initial.basePath || '',
    secure: initial.secure ? '1' : '',
    insecureTls: initial.insecureTls ? '1' : '',
  })
  const [nasFound, setNasFound] = useState<{ name: string; host: string; port: number; protocol: 'smb' | 'sftp' | 'webdav'; secure?: boolean }[] | null>(null)
  const [scanning, setScanning] = useState(false)
  const [shares, setShares] = useState<string[]>([])
  const [link, setLink] = useState('')
  const [detected, setDetected] = useState<Parsed | null>(null)
  // Paste any endpoint / bucket link and the account, bucket and region are filled in for you.
  const onLink = (v: string) => {
    setLink(v)
    const p = parseEndpoint(v)
    setDetected(p)
    if (!p) return
    const names = [...new Set([...(f.defaultBucket || '').split(/[,\s]+/).filter(Boolean), ...(p.bucket ? [p.bucket] : [])])].join(', ')
    setF({
      ...f, defaultBucket: names,
      ...(p.accountId ? { accountId: p.accountId } : {}),
      ...(p.region ? { region: p.region } : {}),
      ...(p.endpoint || p.kind === 's3' ? { endpoint: p.kind === 's3' && !p.endpoint && p.region ? '' : p.endpoint || '' } : {}),
    })
  }
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const type = f.type as ConnType
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const editing = !!initial.id
  const keep = editing ? ' (leave blank to keep)' : ''

  const payload = () => ({ ...f, secure: f.secure === '1', insecureTls: f.insecureTls === '1', id: initial.id, publicUrls: initial.publicUrls })
  const scan = async () => {
    setScanning(true); setNasFound(null)
    try { setNasFound(await call(window.api.nas.discover())) } catch { setNasFound([]) } finally { setScanning(false) }
  }
  const listShares = () => run(async () => {
    const r = await call(window.api.nas.shares({ host: f.host, username: f.username, password: f.password, domain: f.domain }))
    setShares(r)
    setMsg({ ok: true, text: r.length ? `Found ${r.length} share(s). Click one below.` : 'Signed in, but no shares were listed. Type the share name yourself.' })
  })
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null)
    try { await fn() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  const valid =
    type === 'nas' ? f.host && f.username && (f.password || initial.has_password) && (f.protocol !== 'smb' || f.share)
    : type === 'd1' ? f.accountId && (f.apiToken || initial.has_apiToken)
    : type === 'r2' ? f.accountId && f.accessKeyId && (f.secretAccessKey || initial.has_secretAccessKey)
    : f.accessKeyId && (f.secretAccessKey || initial.has_secretAccessKey)

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog pop" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{editing ? 'Edit connection' : 'New connection'}</h3>
        <div className="tabs">
          {(['r2', 's3', 'd1', 'nas'] as const).map((t) => (
            <button key={t} className={type === t ? 'on' : ''} disabled={editing} onClick={() => setF({ ...f, type: t })}>
              <Icon name={t === 'd1' ? 'db' : t === 'r2' ? 'cloud' : t === 'nas' ? 'folder' : 'bucket'} size={15} /> {t === 'r2' ? 'R2' : t === 's3' ? 'S3' : t === 'd1' ? 'D1' : 'NAS'}
            </button>
          ))}
        </div>
        <label>Name<input value={f.name} onChange={set('name')} placeholder="e.g. Production videos" /></label>

        {type === 'r2' && <>
          <label>Paste an endpoint or bucket link (optional) — account, bucket and region are read from it<input value={link} onChange={(e) => onLink(e.target.value)} placeholder="https://<account>.r2.cloudflarestorage.com/my-bucket" /></label>
          {detected && <div className="note ok">Detected{detected.accountId ? ` account ${detected.accountId.slice(0, 6)}…` : ''}{detected.bucket ? ` · bucket “${detected.bucket}”` : ' · no bucket in this link (a plain endpoint is the same for every bucket)'}{detected.region ? ` · region ${detected.region}` : ''}</div>}
                    <label>Account ID<input value={f.accountId} onChange={set('accountId')} /></label>
          <label>Access Key ID<input value={f.accessKeyId} onChange={set('accessKeyId')} /></label>
          <label>Secret Access Key{keep}<input type="password" value={f.secretAccessKey} onChange={set('secretAccessKey')} /></label>
          <label>Cloudflare API token (optional) — lists <i>all</i> your buckets automatically{keep}<input type="password" value={f.apiToken} onChange={set('apiToken')} placeholder="needs the “Workers R2 Storage: Read” permission" /></label>
          <label>Bucket name(s) — fill this in if your key is limited to a bucket<input value={f.defaultBucket} onChange={set('defaultBucket')} placeholder="e.g. my-bucket, my-other-bucket" /></label>
          <label>Allowed folders (optional) — only if the key is limited to certain folders, one per line<textarea rows={2} value={f.folders} onChange={(e) => setF({ ...f, folders: e.target.value })} placeholder={'Skills\nK12/OB_27'} /></label>
          <label>CDN / public domain (optional) — used for “Copy link”<input value={f.publicBase} onChange={set('publicBase')} placeholder="https://cdn.example.com" /></label>
        </>}
        {type === 's3' && <>
          <label>Paste an endpoint or bucket link (optional) — account, bucket and region are read from it<input value={link} onChange={(e) => onLink(e.target.value)} placeholder="https://<account>.r2.cloudflarestorage.com/my-bucket" /></label>
          {detected && <div className="note ok">Detected{detected.accountId ? ` account ${detected.accountId.slice(0, 6)}…` : ''}{detected.bucket ? ` · bucket “${detected.bucket}”` : ' · no bucket in this link (a plain endpoint is the same for every bucket)'}{detected.region ? ` · region ${detected.region}` : ''}</div>}
                    <label>Access Key ID<input value={f.accessKeyId} onChange={set('accessKeyId')} /></label>
          <label>Secret Access Key{keep}<input type="password" value={f.secretAccessKey} onChange={set('secretAccessKey')} /></label>
          <label>Region<input value={f.region} onChange={set('region')} /></label>
          <label>Custom endpoint (optional — MinIO, Wasabi, etc.)<input value={f.endpoint} onChange={set('endpoint')} placeholder="https://…" /></label>
          <label>Bucket name(s) — fill this in if your key is limited to a bucket<input value={f.defaultBucket} onChange={set('defaultBucket')} placeholder="e.g. my-bucket, my-other-bucket" /></label>
          <label>Allowed folders (optional) — only if the key is limited to certain folders, one per line<textarea rows={2} value={f.folders} onChange={(e) => setF({ ...f, folders: e.target.value })} placeholder={'Skills\nK12/OB_27'} /></label>
          <label>CDN / public domain (optional) — used for “Copy link”<input value={f.publicBase} onChange={set('publicBase')} placeholder="https://cdn.example.com" /></label>
        </>}
        {type === 'd1' && <>
          <label>Account ID<input value={f.accountId} onChange={set('accountId')} /></label>
          <label>API Token{keep}<input type="password" value={f.apiToken} onChange={set('apiToken')} /></label>
          <p className="muted small">D1 doesn't use R2 keys. Create an API token at dash.cloudflare.com → My Profile → API Tokens with <b>D1: Edit</b> (or Read) permission.</p>
        </>}

        {type === 'nas' && <>
          <div className="tabs">
            {(['smb', 'sftp', 'webdav'] as const).map((p) => <button key={p} className={f.protocol === p ? 'on' : ''} disabled={editing} onClick={() => setF({ ...f, protocol: p, port: '', share: '' })}>{p === 'smb' ? 'SMB (Windows share)' : p === 'sftp' ? 'SFTP' : 'WebDAV'}</button>)}
          </div>
          <div className="row">
            <button onClick={scan} disabled={scanning}>{scanning ? <><div className="spinner sm" /> Looking…</> : <><Icon name="search" size={14} /> Find NAS devices on my network</>}</button>
          </div>
          {nasFound && (nasFound.length
            ? <div className="found">{nasFound.map((d) => <button key={d.protocol + d.host} className="chip" onClick={() => setF({ ...f, host: d.host, protocol: d.protocol, port: d.port && ![445, 22].includes(d.port) ? String(d.port) : '', secure: d.secure ? '1' : '', name: f.name || d.name })}><Icon name="folder" size={12} /> {d.name} · {d.protocol.toUpperCase()} · {d.host}</button>)}</div>
            : <p className="muted small">No devices announced themselves. Type the NAS address below (for example 192.168.1.20 or mynas.local).</p>)}
          <label>NAS address<input value={f.host} onChange={set('host')} placeholder="192.168.1.20 or mynas.local" /></label>
          <label>Username<input value={f.username} onChange={set('username')} autoComplete="off" /></label>
          <label>Password{keep}<input type="password" value={f.password} onChange={set('password')} autoComplete="off" /></label>
          {f.protocol === 'smb' && <>
            <label>Share name<input value={f.share} onChange={set('share')} placeholder="e.g. video, home, public" /></label>
            <div className="row"><button disabled={busy || !f.host || !f.username || !f.password} onClick={listShares}>List the shares on this NAS</button></div>
            {shares.length > 0 && <div className="found">{shares.map((x) => <button key={x} className={'chip' + (f.share === x ? ' accent' : '')} onClick={() => setF({ ...f, share: x })}>{x}</button>)}</div>}
            <label>Domain (optional — office networks only)<input value={f.domain} onChange={set('domain')} /></label>
          </>}
          {f.protocol === 'sftp' && <label>Port (optional, default 22)<input value={f.port} onChange={set('port')} placeholder="22" /></label>}
          {f.protocol === 'webdav' && <>
            <label>Port (optional — Synology 5005 / 5006 for HTTPS)<input value={f.port} onChange={set('port')} placeholder={f.secure ? '5006' : '5005'} /></label>
            <label>Folder on the server (optional)<input value={f.basePath} onChange={set('basePath')} placeholder="/home" /></label>
            <label className="check"><input type="checkbox" checked={f.secure === '1'} onChange={(e) => setF({ ...f, secure: e.target.checked ? '1' : '' })} /> Use HTTPS</label>
            {f.secure === '1' && <label className="check"><input type="checkbox" checked={f.insecureTls === '1'} onChange={(e) => setF({ ...f, insecureTls: e.target.checked ? '1' : '' })} /> My NAS uses a self-signed certificate</label>}
          </>}
          <p className="muted small">Your password is stored encrypted on this computer and sent only to your NAS.</p>
        </>}

        {msg && <div className={'note ' + (msg.ok ? 'ok' : 'bad')}>{msg.text}</div>}
        <div className="row end">
          {editing && <button className="danger left" disabled={busy} onClick={() => confirm('Delete this connection?') && run(async () => { await call(window.api.conn.remove(initial.id!)); onDeleted() })}>Delete</button>}
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button disabled={busy || !valid} onClick={() => run(async () => setMsg({ ok: true, text: await call(window.api.conn.test(payload())) }))}>Test</button>
          <button className="primary" disabled={busy || !valid} onClick={() => run(async () => {
            const name = f.name || (type === 'd1' ? 'D1' : type === 'nas' ? f.host || 'NAS' : type.toUpperCase())
            onSaved(await call(window.api.conn.save({ ...payload(), name })))
          })}>Save</button>
        </div>
      </div>
    </div>
  )
}
