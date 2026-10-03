import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Conn, DriveItem, Transfer } from '../types'
import { call, fmtDate, fmtSize, kindOf, ICON_NAME } from '../util'
import Icon, { type IconName } from './Icon'
import Prompt, { type PromptReq } from './Prompt'
import { useToast } from './Toast'

const GAPPS = 'application/vnd.google-apps.'
const kindFor = (it: DriveItem) =>
  it.mimeType.startsWith('video/') ? 'video' : it.mimeType.startsWith('image/') ? 'image' : it.mimeType.startsWith('audio/') ? 'audio'
    : it.mimeType === 'application/pdf' || it.mimeType === GAPPS + 'document' || it.mimeType === GAPPS + 'presentation' ? 'pdf' : kindOf(it.name)
const viewLink = (it: { id: string; link?: string }) => it.link || `https://drive.google.com/file/d/${it.id}/view`

export default function DriveBrowser({ conn }: { conn: Conn }) {
  const toast = useToast()
  const [drives, setDrives] = useState<{ id: string; name: string }[]>([])
  const [drive, setDrive] = useState('root')
  const [stack, setStack] = useState<{ id: string; name: string }[]>([{ id: 'root', name: 'My Drive' }])
  const [items, setItems] = useState<DriveItem[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [kind, setKind] = useState<'all' | 'folders' | 'files'>('all')
  const [results, setResults] = useState<DriveItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [preview, setPreview] = useState<DriveItem | null>(null)
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const [ask, setAsk] = useState<PromptReq | null>(null)
  const [transfers, setTransfers] = useState<Record<string, Transfer>>({})
  const [uploaded, setUploaded] = useState<{ id: string; name: string }[] | null>(null)
  const [drag, setDrag] = useState(false)
  const cache = useRef(new Map<string, { items: DriveItem[]; next: string | null }>())
  const reqId = useRef(0)
  const batch = useRef<{ id: string; name: string }[]>([])
  const activeUp = useRef(new Set<string>())
  const doneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const folder = stack[stack.length - 1]
  const guard = async <T,>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>) => {
    try { return await call(p) } catch (e) { setError((e as Error).message); toast((e as Error).message, 'bad'); return undefined }
  }

  useEffect(() => {
    guard(window.api.gd.drives(conn.id)).then((d) => { if (d) setDrives(d) })
  }, [conn.id])

  const load = useCallback(async () => {
    const id = ++reqId.current
    const key = `${drive}|${folder.id}`
    if (!cache.current.has(key)) setLoading(true)
    setError('')
    let token: string | null = null
    let acc: DriveItem[] = []
    let pages = 0
    do {
      const r: { items: DriveItem[]; nextToken: string | null } | undefined = await guard(window.api.gd.list(conn.id, drive, folder.id, token))
      if (id !== reqId.current) return
      setLoading(false)
      if (!r) return
      acc = [...acc, ...r.items]
      setItems(acc); setNext(r.nextToken)
      cache.current.set(key, { items: acc, next: r.nextToken })
      token = r.nextToken
      pages++
    } while (token && pages < 60)
  }, [conn.id, drive, folder.id])

  useEffect(() => {
    setFilter(''); setResults(null); setSel(new Set())
    const c = cache.current.get(`${drive}|${folder.id}`)
    if (c) { setItems(c.items); setNext(c.next); setLoading(false) } else setItems([])
    load()
  }, [drive, folder.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = () => { cache.current.clear(); load() }

  // Search runs on Google's servers, so it covers the whole drive quickly.
  useEffect(() => {
    const q = filter.trim()
    if (q.length < 2) { setResults(null); setSearching(false); return }
    let live = true
    setSearching(true)
    const t = setTimeout(async () => {
      const r = await guard(window.api.gd.search(conn.id, drive, q, kind))
      if (live) { setResults(r ?? []); setSearching(false) }
    }, 350)
    return () => { live = false; clearTimeout(t) }
  }, [filter, kind, drive])

  useEffect(() => window.api.onTransfer((t) => {
    setTransfers((m) => ({ ...m, [t.id]: t }))
    if (t.kind === 'upload') {
      if (t.state === 'active') activeUp.current.add(t.id); else activeUp.current.delete(t.id)
      if (t.state === 'done' && t.key) batch.current.push({ id: t.key, name: t.name })
      clearTimeout(doneTimer.current)
      doneTimer.current = setTimeout(() => {
        if (activeUp.current.size === 0 && batch.current.length) { setUploaded([...batch.current]); batch.current = []; reload() }
      }, 1200)
    }
    if (t.state === 'error') toast(`${t.name}: ${t.error}`, 'bad')
  }), [conn.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    if (results) return results
    const f = filter.toLowerCase()
    return items.filter((i) => i.name.toLowerCase().includes(f) && (kind === 'all' || (kind === 'folders') === i.isFolder))
  }, [items, results, filter, kind])

  const selItems = shown.filter((i) => sel.has(i.id))
  const hasFolder = selItems.some((i) => i.isFolder)
  const one = selItems.length === 1 ? selItems[0] : null

  const open = (it: DriveItem) => {
    if (it.isFolder) { setStack((s) => [...s, { id: it.id, name: it.name }]); setFilter('') }
    else setPreview(it)
  }
  const pickDrive = (id: string) => {
    const d = drives.find((x) => x.id === id)
    setDrive(id); setStack([{ id, name: d?.name || 'Drive' }])
  }
  const select = (e: React.MouseEvent, i: number) => {
    const k = shown[i].id
    setSel((s) => {
      if (e.shiftKey && s.size) { const last = shown.findIndex((x) => s.has(x.id)); const [a, b] = [Math.min(last, i), Math.max(last, i)]; return new Set(shown.slice(a, b + 1).map((x) => x.id)) }
      if (e.metaKey || e.ctrlKey) { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n }
      return new Set([k])
    })
    setClosedFor(null)
  }
  const copyText = async (t: string, msg: string) => { await window.api.copy(t); toast(msg) }

  const newFolder = () => setAsk({ title: 'New folder', label: 'Folder name', onSubmit: async (v) => { if (v && await guard(window.api.gd.mkdir(conn.id, folder.id, v))) reload() } })
  const rename = (it: DriveItem) => setAsk({ title: 'Rename', label: 'New name', value: it.name, onSubmit: async (v) => { if (v && v !== it.name) { await guard(window.api.gd.rename(conn.id, it.id, v)); reload() } } })
  const del = async () => {
    if (hasFolder) { toast("Folders can't be deleted — select files only", 'bad'); return }
    if (!selItems.length || !confirm(`Move ${selItems.length} file(s) to the Google Drive trash?`)) return
    if (await guard(window.api.gd.trash(conn.id, selItems.map((i) => i.id))) !== undefined) toast('Moved to trash')
    reload()
  }
  const upload = async (paths: string[]) => { if (paths.length) { await guard(window.api.gd.upload(conn.id, folder.id, paths)); toast(`Uploading ${paths.length} item(s)…`, 'info') } }
  const makePublic = async (it: DriveItem) => {
    if (!confirm(`Anyone with the link will be able to view “${it.name}”. Create a public link?`)) return
    const r = await guard(window.api.gd.share(conn.id, it.id))
    if (r) { await window.api.copy(r.view); toast('Public link copied') }
  }

  const tList = Object.values(transfers).reverse()
  const active = tList.filter((t) => t.state === 'active')
  const crumbSel = (i: number) => setStack((s) => s.slice(0, i + 1))

  return (
    <div className="browser fade" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true) } }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); upload([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)) }}>
      <div className="toolbar">
        <button className="icon-btn" title="Back" disabled={stack.length < 2} onClick={() => setStack((s) => s.slice(0, -1))}><Icon name="back" /></button>
        <div className="crumbs">
          {drives.length > 1
            ? <select className="drive-sel" value={drive} onChange={(e) => pickDrive(e.target.value)}>{drives.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
            : <a onClick={() => crumbSel(0)}><Icon name="folder" size={14} /> {stack[0].name}</a>}
          {stack.slice(1).map((c, i) => <span key={c.id}><Icon name="chevR" size={12} className="muted" /><a onClick={() => crumbSel(i + 1)}>{c.name}</a></span>)}
        </div>
        <div className="seg">
          <span className="chip">{conn.email}</span>
        </div>
        <button className="icon-btn" title="Refresh" onClick={reload}><Icon name="refresh" className={loading ? 'spin' : ''} /></button>
      </div>

      <div className="searchbar">
        <div className="search-big">
          <Icon name="search" size={16} />
          <input placeholder={`Search ${drives.find((d) => d.id === drive)?.name || 'Drive'} by name…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {filter && <button className="icon-btn sm" onClick={() => setFilter('')}><Icon name="close" size={14} /></button>}
        </div>
        <div className="seg labeled">
          <button className={kind === 'all' ? 'on' : ''} onClick={() => setKind('all')}>Folders &amp; files</button>
          <button className={kind === 'folders' ? 'on' : ''} onClick={() => setKind('folders')}>Folders only</button>
          <button className={kind === 'files' ? 'on' : ''} onClick={() => setKind('files')}>Files only</button>
        </div>
      </div>
      {results && <div className="search-status">{searching ? <><div className="spinner sm" /> Searching…</> : <>{results.length} result(s) in the whole drive</>}</div>}

      <div className="actions">
        <button className="primary" onClick={() => guard(window.api.gd.pickUpload(conn.id, folder.id, false))}><Icon name="upload" /> Upload</button>
        <button onClick={() => guard(window.api.gd.pickUpload(conn.id, folder.id, true))}><Icon name="folder" /> Upload folder</button>
        <button onClick={newFolder}><Icon name="plus" /> New folder</button>
        <span className="sep" />
        <div className={'sel-actions' + (selItems.length ? ' show' : '')}>
          <span className="chip accent">{selItems.length} selected</span>
          <button onClick={() => guard(window.api.gd.download(conn.id, drive, selItems))}><Icon name="download" /> Download</button>
          {one && !one.isFolder && <button onClick={() => copyText(viewLink(one), 'Drive link copied')}><Icon name="link" /> Copy link</button>}
          {one && <button onClick={() => rename(one)}><Icon name="edit" /> Rename</button>}
          <button className="danger" disabled={hasFolder} title={hasFolder ? "Folders can't be deleted" : undefined} onClick={del}><Icon name="trash" /> Delete</button>
        </div>
      </div>

      <div className="content" onClick={(e) => { if (e.target === e.currentTarget) setSel(new Set()) }}>
        {loading && !shown.length && <div className="skel-list">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skel" style={{ animationDelay: i * 60 + 'ms' }} />)}</div>}
        {error && !loading && <div className="note bad m">{error}</div>}
        {!loading && !shown.length && !error && (!results || !searching) && (
          <div className="empty-state"><div className="drop-ico"><Icon name="upload" size={34} /></div><h3>{filter ? 'No matches' : 'This folder is empty'}</h3><p className="muted">{filter ? 'Try a different search.' : 'Drag files here to upload them to Google Drive.'}</p></div>
        )}
        {shown.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th className="num">Size</th><th className="date">Modified</th><th className="ra-h" /></tr></thead>
            <tbody>
              {shown.map((it, i) => {
                const k = it.isFolder ? 'folder' : kindFor(it)
                return (
                  <tr key={it.id} className={sel.has(it.id) ? 'on' : ''} style={{ animationDelay: Math.min(i, 20) * 12 + 'ms' }} onClick={(e) => select(e, i)} onDoubleClick={() => open(it)}>
                    <td><span className={'fi ' + k}><Icon name={(it.isFolder ? 'folder' : ICON_NAME[k as keyof typeof ICON_NAME] || 'file') as IconName} size={18} /></span>{it.name}</td>
                    <td className="num muted">{it.isFolder || !it.size ? '—' : fmtSize(it.size)}</td>
                    <td className="date muted">{fmtDate(it.modifiedTime)}</td>
                    <td className="ra" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                      {!it.isFolder && <button className="ra-b play" title="Preview" onClick={() => setPreview(it)}><Icon name="play" size={13} /></button>}
                      {!it.isFolder && <button className="ra-b" title="Copy Drive link" onClick={() => copyText(viewLink(it), 'Drive link copied')}><Icon name="link" size={14} /></button>}
                      <button className="ra-b" title="Details" onClick={() => { setSel(new Set([it.id])); setClosedFor(null) }}><Icon name="file" size={14} /></button>
                      <button className="ra-b" title="Rename" onClick={() => rename(it)}><Icon name="edit" size={14} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {next && !loading && <p className="center pad muted">Loading more…</p>}
      </div>

      {one && closedFor !== one.id && (
        <div className="drawer">
          <div className="drawer-head"><span>{one.isFolder ? 'FOLDER DETAILS' : 'FILE DETAILS'}</span><button className="icon-btn" onClick={() => setClosedFor(one.id)}><Icon name="close" /></button></div>
          <div className="drawer-body">
            <div className="dd-f"><label>NAME</label><div className="dd-v">{one.name}</div></div>
            <div className="dd-f wide"><label>GOOGLE DRIVE LINK</label><div className="dd-c"><input readOnly value={viewLink(one)} onFocus={(e) => e.currentTarget.select()} /><button onClick={() => copyText(viewLink(one), 'Drive link copied')}><Icon name="link" size={14} /> Copy</button></div></div>
            <div className="dd-f"><label>FILE ID</label><div className="dd-c"><input readOnly value={one.id} onFocus={(e) => e.currentTarget.select()} /><button onClick={() => copyText(one.id, 'ID copied')}>Copy</button></div></div>
            {!one.isFolder && <div className="dd-f"><label>SIZE</label><div className="dd-v">{one.size ? fmtSize(one.size) : '—'}</div></div>}
            <div className="dd-f"><label>LAST MODIFIED</label><div className="dd-v">{fmtDate(one.modifiedTime)}</div></div>
            <div className="dd-f"><label>TYPE</label><div className="dd-v">{one.mimeType.replace('application/vnd.google-apps.', 'Google ')}</div></div>
            {!one.isFolder && <div className="dd-f"><label>&nbsp;</label><button onClick={() => makePublic(one)}><Icon name="globe" size={14} /> Create public link…</button></div>}
          </div>
        </div>
      )}

      <div className="status muted"><span>{shown.filter((i) => i.isFolder).length} folder(s), {shown.filter((i) => !i.isFolder).length} file(s)</span><span className="hint">Double-click to open · Drop files to upload · Delete moves files to the Drive trash</span></div>
      {drag && <div className="dropzone"><div><Icon name="upload" size={44} /><h3>Drop to upload</h3><p>{folder.name}</p></div></div>}

      {tList.length > 0 && (
        <div className="transfers">
          <div className="t-head"><span>{active.length ? `Transferring ${active.length} file(s)` : 'Transfers'}</span><button className="ghost sm" onClick={() => setTransfers((m) => Object.fromEntries(Object.entries(m).filter(([, t]) => t.state === 'active')))}>Clear</button></div>
          <div className="t-list">
            {tList.slice(0, 8).map((t) => (
              <div key={t.id} className={'t-row ' + t.state}>
                <Icon name={t.kind === 'upload' ? 'upload' : 'download'} size={14} /><span className="ellipsis grow">{t.name}</span>
                {t.state === 'active' && <div className="bar"><i style={{ width: (t.total ? (t.loaded / t.total) * 100 : 0) + '%' }} /></div>}
                {t.state === 'done' && <Icon name="check" size={15} className="ok-t" />}
                {t.state === 'error' && <span className="bad-t" title={t.error}>failed</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview && <DrivePreview conn={conn} item={preview} onClose={() => setPreview(null)} onLink={() => copyText(viewLink(preview), 'Drive link copied')} onDownload={() => guard(window.api.gd.download(conn.id, drive, [preview]))} />}
      {uploaded && (
        <div className="overlay top" onMouseDown={() => setUploaded(null)}>
          <div className="dialog pop wide" onMouseDown={(e) => e.stopPropagation()}>
            <div className="row"><h3 className="grow">Upload complete — {uploaded.length} file(s)</h3><button className="icon-btn" onClick={() => setUploaded(null)}><Icon name="close" /></button></div>
            {uploaded.length > 1 && <div className="row"><button onClick={() => copyText(uploaded.map((u) => viewLink({ id: u.id })).join('\n'), 'All links copied')}>Copy all links</button></div>}
            <div className="lk-list">
              {uploaded.map((u) => (
                <div key={u.id} className="lk-file">
                  <div className="lk-name"><Icon name="check" size={15} className="ok-t" /> {u.name}</div>
                  <div className="lk"><span className="lk-l">Drive link</span><input readOnly value={viewLink({ id: u.id })} onFocus={(e) => e.currentTarget.select()} /><button onClick={() => copyText(viewLink({ id: u.id }), 'Drive link copied')}><Icon name="link" size={14} /> Copy</button></div>
                  <div className="lk"><span className="lk-l">File ID</span><input readOnly value={u.id} onFocus={(e) => e.currentTarget.select()} /><button onClick={() => copyText(u.id, 'ID copied')}>Copy</button></div>
                </div>
              ))}
            </div>
            <p className="muted small">These links open for people who already have access to the file. Use “Create public link…” in the details panel to share with anyone.</p>
            <div className="row end"><button className="primary" onClick={() => setUploaded(null)}>Done</button></div>
          </div>
        </div>
      )}
      {ask && <Prompt req={ask} onClose={() => setAsk(null)} />}
    </div>
  )
}

function DrivePreview({ conn, item, onClose, onLink, onDownload }: { conn: Conn; item: DriveItem; onClose(): void; onLink(): void; onDownload(): void }) {
  const kind = kindFor(item)
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    setUrl(''); setErr('')
    if (kind === 'other' || kind === 'text') { if (kind === 'other') return }
    call(window.api.gd.previewUrl(conn.id, item.id, item.mimeType)).then(setUrl).catch((e) => setErr(e.message))
  }, [item.id])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="viewer pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="v-head">
          <div className="grow ellipsis"><strong>{item.name}</strong> <span className="muted">{item.size ? fmtSize(item.size) : ''}</span></div>
          <button className="primary" onClick={onLink}><Icon name="link" /> Copy link</button>
          <button onClick={onDownload}><Icon name="download" /> Download</button>
          <button className="icon-btn" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="v-body">
          {!url && !err && kind !== 'other' && <div className="spinner" />}
          {err && <div className="note bad">{err}</div>}
          {kind === 'video' && url && <video key={url} src={url} controls autoPlay />}
          {kind === 'audio' && url && <audio key={url} src={url} controls autoPlay />}
          {kind === 'image' && url && <img src={url} alt={item.name} />}
          {kind === 'pdf' && url && <iframe src={url} title={item.name} />}
          {kind === 'text' && url && <iframe src={url} title={item.name} style={{ background: '#fff' }} />}
          {kind === 'other' && <div className="empty-state"><Icon name="file" size={44} /><h3>No preview available</h3><p className="muted">Download the file or copy its link.</p></div>}
        </div>
      </div>
    </div>
  )
}
