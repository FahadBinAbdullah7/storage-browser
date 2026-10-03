import { useState } from 'react'
import type { Conn, ConnType } from '../types'
import { call } from '../util'
import Icon from './Icon'

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
  })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const type = f.type as ConnType
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const editing = !!initial.id
  const keep = editing ? ' (leave blank to keep)' : ''

  const payload = () => ({ ...f, id: initial.id, publicUrls: initial.publicUrls })
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMsg(null)
    try { await fn() } catch (e) { setMsg({ ok: false, text: (e as Error).message }) } finally { setBusy(false) }
  }

  const valid =
    type === 'd1' ? f.accountId && (f.apiToken || initial.has_apiToken)
    : type === 'r2' ? f.accountId && f.accessKeyId && (f.secretAccessKey || initial.has_secretAccessKey)
    : f.accessKeyId && (f.secretAccessKey || initial.has_secretAccessKey)

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog pop" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{editing ? 'Edit connection' : 'New connection'}</h3>
        <div className="tabs">
          {(['r2', 's3', 'd1'] as const).map((t) => (
            <button key={t} className={type === t ? 'on' : ''} disabled={editing} onClick={() => setF({ ...f, type: t })}>
              <Icon name={t === 'd1' ? 'db' : t === 'r2' ? 'cloud' : 'bucket'} size={15} /> {t === 'r2' ? 'R2' : t === 's3' ? 'S3' : 'D1'}
            </button>
          ))}
        </div>
        <label>Name<input value={f.name} onChange={set('name')} placeholder="e.g. Production videos" /></label>

        {type === 'r2' && <>
          <label>Account ID<input value={f.accountId} onChange={set('accountId')} /></label>
          <label>Access Key ID<input value={f.accessKeyId} onChange={set('accessKeyId')} /></label>
          <label>Secret Access Key{keep}<input type="password" value={f.secretAccessKey} onChange={set('secretAccessKey')} /></label>
          <label>Bucket name(s) — fill this in if your key is limited to a bucket<input value={f.defaultBucket} onChange={set('defaultBucket')} placeholder="e.g. 10ms-videos, 10mscdn" /></label>
          <label>Allowed folders (optional) — only if the key is limited to certain folders, one per line<textarea rows={2} value={f.folders} onChange={(e) => setF({ ...f, folders: e.target.value })} placeholder={'Skills\nK12/OB_27'} /></label>
          <label>CDN / public domain (optional) — used for “Copy link”<input value={f.publicBase} onChange={set('publicBase')} placeholder="https://cdn.10minuteschool.com" /></label>
        </>}
        {type === 's3' && <>
          <label>Access Key ID<input value={f.accessKeyId} onChange={set('accessKeyId')} /></label>
          <label>Secret Access Key{keep}<input type="password" value={f.secretAccessKey} onChange={set('secretAccessKey')} /></label>
          <label>Region<input value={f.region} onChange={set('region')} /></label>
          <label>Custom endpoint (optional — MinIO, Wasabi, etc.)<input value={f.endpoint} onChange={set('endpoint')} placeholder="https://…" /></label>
          <label>Bucket name(s) — fill this in if your key is limited to a bucket<input value={f.defaultBucket} onChange={set('defaultBucket')} placeholder="e.g. 10ms-videos, 10mscdn" /></label>
          <label>Allowed folders (optional) — only if the key is limited to certain folders, one per line<textarea rows={2} value={f.folders} onChange={(e) => setF({ ...f, folders: e.target.value })} placeholder={'Skills\nK12/OB_27'} /></label>
          <label>CDN / public domain (optional) — used for “Copy link”<input value={f.publicBase} onChange={set('publicBase')} placeholder="https://cdn.10minuteschool.com" /></label>
        </>}
        {type === 'd1' && <>
          <label>Account ID<input value={f.accountId} onChange={set('accountId')} /></label>
          <label>API Token{keep}<input type="password" value={f.apiToken} onChange={set('apiToken')} /></label>
          <p className="muted small">D1 doesn't use R2 keys. Create an API token at dash.cloudflare.com → My Profile → API Tokens with <b>D1: Edit</b> (or Read) permission.</p>
        </>}

        {msg && <div className={'note ' + (msg.ok ? 'ok' : 'bad')}>{msg.text}</div>}
        <div className="row end">
          {editing && <button className="danger left" disabled={busy} onClick={() => confirm('Delete this connection?') && run(async () => { await call(window.api.conn.remove(initial.id!)); onDeleted() })}>Delete</button>}
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button disabled={busy || !valid} onClick={() => run(async () => setMsg({ ok: true, text: await call(window.api.conn.test(payload())) }))}>Test</button>
          <button className="primary" disabled={busy || !valid} onClick={() => run(async () => {
            const name = f.name || (type === 'd1' ? 'D1' : type.toUpperCase())
            onSaved(await call(window.api.conn.save({ ...payload(), name })))
          })}>Save</button>
        </div>
      </div>
    </div>
  )
}
