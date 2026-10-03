import { useEffect, useState } from 'react'
import type { Conn, FileItem } from '../types'
import { call, fmtSize, kindOf } from '../util'
import Icon from './Icon'

interface Props {
  conn: Conn; bucket: string; file: FileItem
  onClose(): void; onLink(): void; onDownload(): void; onPrev?(): void; onNext?(): void
}

export default function Preview({ conn, bucket, file, onClose, onLink, onDownload, onPrev, onNext }: Props) {
  const kind = kindOf(file.name)
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    let live = true
    setUrl(''); setText(''); setErr('')
    ;(async () => {
      try {
        if (kind === 'text') setText(await call(window.api.obj.text(conn.id, bucket, file.key)))
        else if (kind !== 'other') setUrl(await call(window.api.obj.presign(conn.id, bucket, file.key, 3600)))
      } catch (e) { live && setErr((e as Error).message) }
    })()
    return () => { live = false }
  }, [file.key])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onPrev?.()
      else if (e.key === 'ArrowRight') onNext?.()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose, onPrev, onNext])

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="viewer pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="v-head">
          <div className="grow ellipsis"><strong>{file.name}</strong> <span className="muted">{fmtSize(file.size)}</span></div>
          <button className="primary" onClick={onLink}><Icon name="link" /> Copy link</button>
          <button onClick={onDownload}><Icon name="download" /> Download</button>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><Icon name="close" /></button>
        </div>
        <div className="v-body">
          {onPrev && <button className="nav l" onClick={onPrev}><Icon name="chevL" size={22} /></button>}
          {onNext && <button className="nav r" onClick={onNext}><Icon name="chevR" size={22} /></button>}
          {!url && !text && !err && kind !== 'other' && <div className="spinner" />}
          {err && <div className="note bad">{err}</div>}
          {kind === 'video' && url && <video key={url} src={url} controls autoPlay />}
          {kind === 'audio' && url && <audio key={url} src={url} controls autoPlay />}
          {kind === 'image' && url && <img src={url} alt={file.name} />}
          {kind === 'pdf' && url && <iframe src={url} title={file.name} />}
          {kind === 'text' && <pre>{text}</pre>}
          {kind === 'other' && <div className="empty-state"><Icon name="file" size={44} /><h3>No preview available</h3><p className="muted">Download the file or copy its link.</p></div>}
        </div>
      </div>
    </div>
  )
}
