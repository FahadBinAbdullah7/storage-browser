import { useEffect, useState } from 'react'
import type { Conn, FullHead } from '../types'
import { call, fmtDate, fmtSize } from '../util'
import Icon from './Icon'
import { useToast } from './Toast'

const CACHE = [
  ['None', ''],
  ['1 hour', 'public, max-age=3600'],
  ['1 day', 'public, max-age=86400'],
  ['1 year (immutable)', 'public, max-age=31536000, immutable'],
] as const

// Right-hand inspector: object headers (editable) or folder totals.
export default function InfoPanel({ conn, bucket, k, onClose }: { conn: Conn; bucket: string; k: string | null; onClose(): void }) {
  const toast = useToast()
  const isDir = !!k?.endsWith('/')
  const [h, setH] = useState<FullHead | null>(null)
  const [st, setSt] = useState<{ count: number; size: number } | null>(null)
  const [ct, setCt] = useState('')
  const [cc, setCc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    setH(null); setSt(null); setErr('')
    if (!k) return
    let live = true
    const p = isDir
      ? call(window.api.obj.stats(conn.id, bucket, k)).then((x) => live && setSt(x))
      : call(window.api.obj.headFull(conn.id, bucket, k)).then((x) => { if (live) { setH(x); setCt(x.contentType); setCc(x.cacheControl) } })
    p.catch((e) => live && setErr(e.message))
    return () => { live = false }
  }, [k, bucket])

  const save = async () => {
    if (!k) return
    setBusy(true)
    try { await call(window.api.obj.setMeta(conn.id, bucket, k, { contentType: ct, cacheControl: cc })); toast('Headers updated') }
    catch (e) { toast((e as Error).message, 'bad') } finally { setBusy(false) }
  }

  const Row = ({ l, v }: { l: string; v: string }) => <div className="kv"><span>{l}</span><b title={v}>{v}</b></div>

  return (
    <aside className="info">
      <div className="info-head"><strong>Info</strong><button className="icon-btn" onClick={onClose}><Icon name="close" /></button></div>
      {!k && <p className="muted pad small">Select a file or folder to see its details.</p>}
      {k && <>
        <div className="info-name"><Icon name={isDir ? 'folder' : 'file'} size={26} /><span>{k.replace(/\/$/, '').split('/').pop()}</span></div>
        <Row l="Path" v={'/' + k} />
        {err && <div className="note bad">{err}</div>}
        {isDir && (st ? <><Row l="Files" v={String(st.count)} /><Row l="Total size" v={fmtSize(st.size)} /></> : !err && <div className="spinner sm" />)}
        {h && <>
          <Row l="Size" v={fmtSize(h.size)} />
          <Row l="Modified" v={fmtDate(h.lastModified)} />
          <Row l="ETag" v={(h.etag || '').replace(/"/g, '')} />
          <Row l="Storage class" v={h.storageClass} />
          <div className="info-edit">
            <label>Content-Type<input value={ct} onChange={(e) => setCt(e.target.value)} /></label>
            <label>Cache-Control
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="e.g. public, max-age=31536000" />
            </label>
            <div className="presets">{CACHE.map(([l, v]) => <button key={l} className={'chip' + (cc === v ? ' accent' : '')} onClick={() => setCc(v)}>{l}</button>)}</div>
            <button className="primary" disabled={busy || (ct === h.contentType && cc === h.cacheControl)} onClick={save}>{busy ? 'Saving…' : 'Save headers'}</button>
          </div>
        </>}
      </>}
    </aside>
  )
}
