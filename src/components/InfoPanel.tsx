import { useEffect, useState } from 'react'
import type { Conn, FileItem, FullHead } from '../types'
import { call, fmtDate, fmtSize } from '../util'
import Icon from './Icon'
import { useToast } from './Toast'

const CACHE = [
  ['None', ''],
  ['1 hour', 'public, max-age=3600'],
  ['1 day', 'public, max-age=86400'],
  ['1 year (immutable)', 'public, max-age=31536000, immutable'],
] as const

const enc = (k: string) => k.split('/').map(encodeURIComponent).join('/')

// "File details" drawer at the bottom: opens when a single file or folder is selected.
export default function DetailsDrawer({ conn, bucket, k, file, publicBase, onClose }: {
  conn: Conn; bucket: string; k: string; file?: FileItem; publicBase?: string; onClose(): void
}) {
  const toast = useToast()
  const isDir = k.endsWith('/')
  const bare = k.replace(/\/$/, '')
  const name = bare.split('/').pop() || bare
  const folder = isDir ? bare.slice(0, Math.max(0, bare.lastIndexOf('/'))) : bare.slice(0, Math.max(0, bare.lastIndexOf('/')))
  const [h, setH] = useState<FullHead | null>(null)
  const [st, setSt] = useState<{ count: number; size: number } | null>(null)
  const [ct, setCt] = useState('')
  const [cc, setCc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const sourceUri = conn.type === 'r2' ? `https://${conn.accountId}.r2.cloudflarestorage.com/${bucket}/${enc(k)}`
    : conn.endpoint ? `${conn.endpoint.replace(/\/+$/, '')}/${bucket}/${enc(k)}`
    : `https://${bucket}.s3.${conn.region || 'us-east-1'}.amazonaws.com/${enc(k)}`
  const cdn = publicBase ? `${publicBase}/${enc(k)}` : ''

  useEffect(() => {
    setH(null); setSt(null); setErr('')
    if (isDir) return
    let live = true
    call(window.api.obj.headFull(conn.id, bucket, k)).then((x) => { if (live) { setH(x); setCt(x.contentType); setCc(x.cacheControl) } }).catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [k, bucket])

  const copy = async (v: string, what: string) => { await window.api.copy(v); toast(`${what} copied`) }
  const calc = async () => {
    try { setSt(await call(window.api.obj.stats(conn.id, bucket, k))) } catch (e) { toast((e as Error).message, 'bad') }
  }
  const save = async () => {
    setBusy(true)
    try { await call(window.api.obj.setMeta(conn.id, bucket, k, { contentType: ct, cacheControl: cc })); toast('Headers updated') }
    catch (e) { toast((e as Error).message, 'bad') } finally { setBusy(false) }
  }

  const Field = ({ label, value, what }: { label: string; value: string; what: string }) => (
    <div className="dd-f wide">
      <label>{label}</label>
      <div className="dd-c"><input readOnly value={value} onFocus={(e) => e.currentTarget.select()} /><button onClick={() => copy(value, what)}><Icon name="link" size={14} /> Copy</button></div>
    </div>
  )

  return (
    <div className="drawer">
      <div className="drawer-head"><span>{isDir ? 'FOLDER DETAILS' : 'FILE DETAILS'}</span><button className="icon-btn" title="Close" onClick={onClose}><Icon name="close" /></button></div>
      <div className="drawer-body">
        <div className="dd-f"><label>{isDir ? 'FOLDER NAME' : 'FILE NAME'}</label><div className="dd-v">{name}</div></div>
        <Field label="FULL PATH (S3 KEY)" value={k} what="Path" />
        <Field label="SOURCE URI" value={sourceUri} what="Source URI" />
        {cdn && <Field label="CDN LINK" value={cdn} what="CDN link" />}
        {!isDir && <div className="dd-f"><label>SIZE</label><div className="dd-v">{fmtSize(file?.size ?? h?.size ?? 0)}</div></div>}
        {!isDir && <div className="dd-f"><label>LAST MODIFIED</label><div className="dd-v">{fmtDate(file?.lastModified ?? h?.lastModified)}</div></div>}
        <div className="dd-f"><label>FOLDER</label><div className="dd-v">{folder || '/'}</div></div>
        {isDir && <div className="dd-f"><label>CONTENTS</label><div className="dd-v">{st ? `${st.count} file(s) · ${fmtSize(st.size)}` : <button className="sm" onClick={calc}>Calculate size</button>}</div></div>}
        {err && <div className="note bad">{err}</div>}
        {h && <>
          <div className="dd-f"><label>CONTENT-TYPE</label><input value={ct} onChange={(e) => setCt(e.target.value)} /></div>
          <div className="dd-f"><label>CACHE-CONTROL</label><input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="e.g. public, max-age=31536000" />
            <div className="presets">{CACHE.map(([l, v]) => <button key={l} className={'chip' + (cc === v ? ' accent' : '')} onClick={() => setCc(v)}>{l}</button>)}</div>
          </div>
          <div className="dd-f"><label>&nbsp;</label><button className="primary" disabled={busy || (ct === h.contentType && cc === h.cacheControl)} onClick={save}>{busy ? 'Saving…' : 'Save headers'}</button></div>
        </>}
      </div>
    </div>
  )
}
