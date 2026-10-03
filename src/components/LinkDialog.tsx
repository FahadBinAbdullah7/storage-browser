import { useEffect, useState } from 'react'
import type { Conn } from '../types'
import { call } from '../util'
import { useToast } from './Toast'
import Icon from './Icon'

const EXPIRY = [['1 hour', 3600], ['1 day', 86400], ['7 days (max)', 604800]] as const

export default function LinkDialog({ conn, bucket, keyName, publicBase, onClose }: {
  conn: Conn; bucket: string; keyName: string; publicBase?: string; onClose(): void
}) {
  const [secs, setSecs] = useState(86400)
  const [signed, setSigned] = useState('')
  const [copied, setCopied] = useState('')
  const toast = useToast()
  const [err, setErr] = useState('')
  const pub = publicBase ? `${publicBase}/${keyName.split('/').map(encodeURIComponent).join('/')}` : ''

  useEffect(() => {
    setSigned('')
    call(window.api.obj.presign(conn.id, bucket, keyName, secs)).then(setSigned).catch((e) => setErr(e.message))
  }, [secs])

  const copy = async (label: string, v: string) => { await window.api.copy(v); setCopied(label); toast('Link copied'); setTimeout(() => setCopied(''), 1500) }

  return (
    <div className="overlay top" onMouseDown={onClose}>
      <div className="dialog pop" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Signed (expiring) link</h3>
        <p className="muted small ellipsis">{keyName}</p>
        {pub && <>
          <label>Public link (permanent)<input readOnly value={pub} /></label>
          <button onClick={() => copy('pub', pub)}>{copied === 'pub' ? 'Copied ✓' : 'Copy public link'}</button>
        </>}
        <label>Temporary signed link
          <select value={secs} onChange={(e) => setSecs(Number(e.target.value))}>
            {EXPIRY.map(([l, s]) => <option key={s} value={s}>Expires in {l}</option>)}
          </select>
        </label>
        <input readOnly value={signed || 'Generating…'} />
        {err && <div className="note bad">{err}</div>}
        <div className="row end">
          <button className="ghost" onClick={onClose}>Close</button>
          <button className="primary" disabled={!signed} onClick={() => copy('sig', signed)}>{copied === 'sig' ? 'Copied ✓' : 'Copy signed link'}</button>
        </div>
        {!pub && <p className="muted small">Want a permanent CDN link instead? Set your CDN domain on the connection (✎) or with “Set CDN URL” in the toolbar.</p>}
      </div>
    </div>
  )
}
