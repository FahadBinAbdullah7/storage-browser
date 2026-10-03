import { useState } from 'react'
import type { Conn } from '../types'
import { call } from '../util'
import Icon from './Icon'
import { useToast } from './Toast'

interface Item { key: string; name: string }

// Shown after an upload finishes: every link for every uploaded file, each with a Copy button.
export default function UploadDone({ conn, bucket, publicBase, items, onClose }: {
  conn: Conn; bucket: string; publicBase?: string; items: Item[]; onClose(): void
}) {
  const toast = useToast()
  const [signed, setSigned] = useState<Record<string, string>>({})
  const cdn = (k: string) => (publicBase ? `${publicBase}/${k.split('/').map(encodeURIComponent).join('/')}` : '')
  const copy = async (text: string, what: string) => { await window.api.copy(text); toast(`${what} copied`) }

  const sign = async (k: string) => {
    try { setSigned((s) => ({ ...s, [k]: '…' })); const u = await call(window.api.obj.presign(conn.id, bucket, k, 86400)); setSigned((s) => ({ ...s, [k]: u })) }
    catch (e) { toast((e as Error).message, 'bad'); setSigned((s) => { const n = { ...s }; delete n[k]; return n }) }
  }

  const Row = ({ label, value, what }: { label: string; value: string; what: string }) => (
    <div className="lk">
      <span className="lk-l">{label}</span>
      <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} />
      <button onClick={() => copy(value, what)}><Icon name="link" size={14} /> Copy</button>
    </div>
  )

  return (
    <div className="overlay top" onMouseDown={onClose}>
      <div className="dialog pop wide" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row">
          <h3 className="grow">Upload complete — {items.length} file(s)</h3>
          <button className="icon-btn" onClick={onClose}><Icon name="close" /></button>
        </div>
        {items.length > 1 && (
          <div className="row">
            {publicBase && <button onClick={() => copy(items.map((i) => cdn(i.key)).join('\n'), 'All CDN links')}>Copy all CDN links</button>}
            <button onClick={() => copy(items.map((i) => i.key).join('\n'), 'All paths')}>Copy all paths</button>
          </div>
        )}
        {!publicBase && <div className="note ok">No CDN domain is set for this bucket, so there is no CDN link. Use “Set CDN URL” in the toolbar to add one.</div>}
        <div className="lk-list">
          {items.map((i) => (
            <div key={i.key} className="lk-file">
              <div className="lk-name"><Icon name="check" size={15} className="ok-t" /> {i.name}</div>
              {publicBase && <Row label="CDN link" value={cdn(i.key)} what="CDN link" />}
              <Row label="Path" value={i.key} what="Path" />
              <Row label="S3 URI" value={`s3://${bucket}/${i.key}`} what="S3 URI" />
              {signed[i.key] && signed[i.key] !== '…'
                ? <Row label="Signed (24h)" value={signed[i.key]} what="Signed link" />
                : <button className="ghost sm" disabled={signed[i.key] === '…'} onClick={() => sign(i.key)}>{signed[i.key] === '…' ? 'Generating…' : 'Create a 24-hour signed link'}</button>}
            </div>
          ))}
        </div>
        <div className="row end"><button className="primary" onClick={onClose}>Done</button></div>
      </div>
    </div>
  )
}
