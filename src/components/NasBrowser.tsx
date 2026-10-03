import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Conn, NasItem, SearchProgress, Transfer } from '../types'
import { call, fmtDate, fmtSize, kindOf, ICON_NAME } from '../util'
import Icon, { type IconName } from './Icon'
import Prompt, { type PromptReq } from './Prompt'
import { useToast } from './Toast'

const parentOf = (p: string) => '/' + p.split('/').filter(Boolean).slice(0, -1).join('/')
const joinP = (d: string, n: string) => (d === '/' ? '' : d) + '/' + n

// Where this item lives on the network, in the form other tools understand.
function networkPath(c: Conn, p: string) {
  const e = (x: string) => x.split('/').map(encodeURIComponent).join('/')
  if (c.protocol === 'smb') return `smb://${c.host}/${c.share}${e(p)}`
  if (c.protocol === 'sftp') return `sftp://${c.host}${c.port && Number(c.port) !== 22 ? ':' + c.port : ''}${e(p)}`
  return `${c.secure ? 'https' : 'http'}://${c.host}:${c.port || (c.secure ? 5006 : 5005)}${(c.basePath ? '/' + c.basePath.replace(/^\/+|\/+$/g, '') : '')}${e(p)}`
}

export default function NasBrowser({ conn }: { conn: Conn }) {
  const toast = useToast()
  const [cwd, setCwd] = useState('/')
  const [items, setItems] = useState<NasItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const kind = 'all' as 'all' | 'folders' | 'files'
  const [found, setFound] = useState<NasItem[] | null>(null)
  const [search, setSearch] = useState<{ scanned: number; done: boolean; capped: boolean } | null>(null)
  const [preview, setPreview] = useState<NasItem | null>(null)
  const [closedFor, setClosedFor] = useState<string | null>(null)
  const [ask, setAsk] = useState<PromptReq | null>(null)
  const [transfers, setTransfers] = useState<Record<string, Transfer>>({})
  const [drag, setDrag] = useState(false)
  const cache = useRef(new Map<string, NasItem[]>())
  const reqId = useRef(0)
  const sidRef = useRef('')
  const seq = useRef(0)
  const doneTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const activeUp = useRef(new Set<string>())

  const guard = async <T,>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>) => {
    try { return await call(p) } catch (e) { setError((e as Error).message); toast((e as Error).message, 'bad'); return undefined }
  }

  const load = useCallback(async () => {
    const id = ++reqId.current
    if (!cache.current.has(cwd)) setLoading(true)
    setError('')
    const r = await guard(window.api.nas.list(conn.id, cwd))
    if (id !== reqId.current) return
    setLoading(false)
    if (r) { setItems(r); cache.current.set(cwd, r) }
  }, [conn.id, cwd])

  useEffect(() => {
    setFilter(''); setFound(null); setSel(new Set())
    const c = cache.current.get(cwd)
    if (c) { setItems(c); setLoading(false) } else setItems([])
    load()
  }, [cwd]) // eslint-disable-line react-hooks/exhaustive-deps

  const reload = () => { cache.current.clear(); load() }

  // Searches everything below the current folder; results stream in while it works.
  useEffect(() => {
    const q = filter.trim()
    if (true || q.length < 2) { setFound(null); setSearch(null); return } // this folder only: no recursive search
    const sid = `n${++seq.current}`
    sidRef.current = sid
    setFound([]); setSearch({ scanned: 0, done: false, capped: false })
    const off = window.api.onSearch((r: SearchProgress) => {
      if (r.id !== sid) return
      setFound([
        ...r.folders.map((f) => ({ name: f.name, path: f.prefix, isFolder: true, size: 0, mtime: null })),
        ...r.files.map((f) => ({ name: f.name, path: f.key, isFolder: false, size: f.size, mtime: f.lastModified || null })),
      ])
      setSearch({ scanned: r.scanned, done: r.done, capped: r.capped })
    })
    const t = setTimeout(() => {
      guard(window.api.nas.search(conn.id, cwd, q, kind, sid)).then(() => setSearch((x) => x && { ...x, done: true }))
    }, 300)
    return () => { clearTimeout(t); off(); window.api.nas.searchCancel(sid) }
  }, [filter, kind, cwd]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => window.api.onTransfer((t) => {
    setTransfers((m) => ({ ...m, [t.id]: t }))
    if (t.kind === 'upload') {
      if (t.state === 'active') activeUp.current.add(t.id); else activeUp.current.delete(t.id)
      clearTimeout(doneTimer.current)
      doneTimer.current = setTimeout(() => { if (activeUp.current.size === 0) { reload(); toast('Upload finished') } }, 1200)
    }
    if (t.state === 'error') toast(`${t.name}: ${t.error}`, 'bad')
  }), [conn.id, cwd]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    if (found) {
      const local = items.filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()) && (kind === 'all' || (kind === 'folders') === i.isFolder))
      return [...new Map([...local, ...found].map((i) => [i.path, i])).values()]
    }
    return [...items].filter((i) => i.name.toLowerCase().includes(filter.toLowerCase()) && (kind === 'all' || (kind === 'folders') === i.isFolder))
      .sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  }, [items, found, filter, kind])

  const selItems = shown.filter((i) => sel.has(i.path))
  const hasFolder = selItems.some((i) => i.isFolder)
  const one = selItems.length === 1 ? selItems[0] : null
  const crumbs = cwd.split('/').filter(Boolean)

  const open = (it: NasItem) => (it.isFolder ? (setFilter(''), setCwd(it.path)) : kindOf(it.name) === 'other' ? toast('No preview for this file type — use Download', 'info') : setPreview(it))
  const select = (e: React.MouseEvent, i: number) => {
    const k = shown[i].path
    setSel((s) => {
      if (e.shiftKey && s.size) { const last = shown.findIndex((x) => s.has(x.path)); const [a, b] = [Math.min(last, i), Math.max(last, i)]; return new Set(shown.slice(a, b + 1).map((x) => x.path)) }
      if (e.metaKey || e.ctrlKey) { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n }
      return new Set([k])
    })
    setClosedFor(null)
  }
  const copyText = async (t: string, msg: string) => { await window.api.copy(t); toast(msg) }

  const newFolder = () => setAsk({ title: 'New folder', label: 'Folder name', onSubmit: async (v) => { if (v && await guard(window.api.nas.mkdir(conn.id, cwd, v)) !== undefined) reload() } })
  const rename = (it: NasItem) => setAsk({ title: 'Rename', label: 'New name', value: it.name, onSubmit: async (v) => { if (v && v !== it.name) { await guard(window.api.nas.rename(conn.id, it.path, v)); reload() } } })
  const del = async () => {
    if (hasFolder) { toast("Folders can't be deleted — select files only", 'bad'); return }
    if (!selItems.length || !confirm(`Delete ${selItems.length} file(s) from the NAS? This can't be undone.`)) return
    if (await guard(window.api.nas.remove(conn.id, selItems.map((i) => i.path))) !== undefined) toast('Deleted')
    reload()
  }
  const upload = async (paths: string[]) => { if (paths.length) { await guard(window.api.nas.upload(conn.id, cwd, paths)); toast(`Uploading ${paths.length} item(s)…`, 'info') } }

  const tList = Object.values(transfers).reverse()
  const active = tList.filter((t) => t.state === 'active')

  return (
    <div className="browser fade" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true) } }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); upload([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean)) }}>
      <div className="toolbar">
        <button className="icon-btn" title="Up" disabled={cwd === '/'} onClick={() => setCwd(parentOf(cwd))}><Icon name="back" /></button>
        <div className="crumbs">
          <a onClick={() => setCwd('/')}><Icon name="db" size={14} /> {conn.name}</a>
          {crumbs.map((c, i) => <span key={i}><Icon name="chevR" size={12} className="muted" /><a onClick={() => setCwd('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</a></span>)}
        </div>
        <span className="chip">{(conn.protocol || '').toUpperCase()} · {conn.host}</span>
        <button className="icon-btn" title="Refresh" onClick={reload}><Icon name="refresh" className={loading ? 'spin' : ''} /></button>
      </div>

      <div className="searchbar">
        <div className="search-big">
          <Icon name="search" size={16} />
          <input placeholder={`Search in ${cwd === '/' ? conn.name : cwd} (this folder only)…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {filter && <button className="icon-btn sm" onClick={() => setFilter('')}><Icon name="close" size={14} /></button>}
        </div>
      </div>
      {search && (
        <div className="search-status">
          {!search.done ? <><div className="spinner sm" /> Searching… {search.scanned.toLocaleString()} items checked · {found?.length || 0} found<button className="ghost sm" onClick={() => { window.api.nas.searchCancel(sidRef.current); setSearch((x) => x && { ...x, done: true }) }}>Stop</button></>
            : <>{found?.length || 0} result(s){search.capped ? ' (showing the first 500)' : ''} · {search.scanned.toLocaleString()} items checked</>}
        </div>
      )}

      <div className="actions">
        <button className="primary" onClick={() => guard(window.api.nas.pickUpload(conn.id, cwd, false))}><Icon name="upload" /> Upload</button>
        <button onClick={() => guard(window.api.nas.pickUpload(conn.id, cwd, true))}><Icon name="folder" /> Upload folder</button>
        <button onClick={newFolder}><Icon name="plus" /> New folder</button>
        <span className="sep" />
        <div className={'sel-actions' + (selItems.length ? ' show' : '')}>
          <span className="chip accent">{selItems.length} selected</span>
          <button onClick={() => guard(window.api.nas.download(conn.id, selItems))}><Icon name="download" /> Download</button>
          {one && <button onClick={() => rename(one)}><Icon name="edit" /> Rename</button>}
          <button className="danger" disabled={hasFolder} title={hasFolder ? "Folders can't be deleted" : undefined} onClick={del}><Icon name="trash" /> Delete</button>
        </div>
      </div>

      <div className="content" onClick={(e) => { if (e.target === e.currentTarget) setSel(new Set()) }}>
        {loading && !shown.length && <div className="skel-list">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skel" style={{ animationDelay: i * 60 + 'ms' }} />)}</div>}
        {error && !loading && (
          <div className="empty-state"><Icon name="cloud" size={42} /><h3>Couldn't open this folder</h3><p className="muted">{error}</p><button className="primary" onClick={reload}>Try again</button></div>
        )}
        {!loading && !error && !shown.length && (!search || search.done) && (
          <div className="empty-state"><div className="drop-ico"><Icon name="upload" size={34} /></div><h3>{filter ? 'No matches' : 'This folder is empty'}</h3><p className="muted">{filter ? 'Try a different search.' : 'Drag files here to upload them to the NAS.'}</p></div>
        )}
        {shown.length > 0 && (
          <table>
            <thead><tr><th>Name</th><th className="num">Size</th><th className="date">Modified</th><th className="ra-h" /></tr></thead>
            <tbody>
              {shown.map((it, i) => {
                const k = it.isFolder ? 'folder' : kindOf(it.name)
                return (
                  <tr key={it.path} className={sel.has(it.path) ? 'on' : ''} style={{ animationDelay: Math.min(i, 20) * 12 + 'ms' }} onClick={(e) => select(e, i)} onDoubleClick={() => open(it)}>
                    <td><span className={'fi ' + k}><Icon name={(it.isFolder ? 'folder' : ICON_NAME[k as keyof typeof ICON_NAME] || 'file') as IconName} size={18} /></span>{it.name}</td>
                    <td className="num muted">{it.isFolder ? '—' : fmtSize(it.size)}</td>
                    <td className="date muted">{it.isFolder ? '—' : fmtDate(it.mtime || undefined)}</td>
                    <td className="ra" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                      {!it.isFolder && kindOf(it.name) !== 'other' && <button className="ra-b play" title="Preview" onClick={() => setPreview(it)}><Icon name="play" size={13} /></button>}
                      <button className="ra-b" title="Details" onClick={() => { setSel(new Set([it.path])); setClosedFor(null) }}><Icon name="file" size={14} /></button>
                      <button className="ra-b" title="Rename" onClick={() => rename(it)}><Icon name="edit" size={14} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {one && closedFor !== one.path && (
        <div className="drawer">
          <div className="drawer-head"><span>{one.isFolder ? 'FOLDER DETAILS' : 'FILE DETAILS'}</span><button className="icon-btn" onClick={() => setClosedFor(one.path)}><Icon name="close" /></button></div>
          <div className="drawer-body">
            <div className="dd-f"><label>NAME</label><div className="dd-v">{one.name}</div></div>
            <div className="dd-f wide"><label>PATH ON THE NAS</label><div className="dd-c"><input readOnly value={one.path} onFocus={(e) => e.currentTarget.select()} /><button onClick={() => copyText(one.path, 'Path copied')}><Icon name="link" size={14} /> Copy</button></div></div>
            <div className="dd-f wide"><label>NETWORK ADDRESS</label><div className="dd-c"><input readOnly value={networkPath(conn, one.path)} onFocus={(e) => e.currentTarget.select()} /><button onClick={() => copyText(networkPath(conn, one.path), 'Address copied')}><Icon name="link" size={14} /> Copy</button></div></div>
            {!one.isFolder && <div className="dd-f"><label>SIZE</label><div className="dd-v">{fmtSize(one.size)}</div></div>}
            {!one.isFolder && <div className="dd-f"><label>LAST MODIFIED</label><div className="dd-v">{fmtDate(one.mtime || undefined)}</div></div>}
            <div className="dd-f"><label>FOLDER</label><div className="dd-v">{parentOf(one.path)}</div></div>
          </div>
        </div>
      )}

      <div className="status muted"><span>{shown.filter((i) => i.isFolder).length} folder(s), {shown.filter((i) => !i.isFolder).length} file(s)</span><span className="hint">Double-click to open · Drop files to upload · Folders can't be deleted</span></div>
      {drag && <div className="dropzone"><div><Icon name="upload" size={44} /><h3>Drop to upload</h3><p>{cwd}</p></div></div>}

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

      {preview && <NasPreview conn={conn} item={preview} onClose={() => setPreview(null)} onDownload={() => guard(window.api.nas.download(conn.id, [preview]))} onCopy={() => copyText(networkPath(conn, preview.path), 'Address copied')} />}
      {ask && <Prompt req={ask} onClose={() => setAsk(null)} />}
    </div>
  )
}

function NasPreview({ conn, item, onClose, onDownload, onCopy }: { conn: Conn; item: NasItem; onClose(): void; onDownload(): void; onCopy(): void }) {
  const kind = kindOf(item.name)
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    setUrl(''); setErr('')
    call(window.api.nas.previewUrl(conn.id, item.path)).then(setUrl).catch((e) => setErr(e.message))
  }, [item.path])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="viewer pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="v-head">
          <div className="grow ellipsis"><strong>{item.name}</strong> <span className="muted">{fmtSize(item.size)}</span></div>
          <button onClick={onCopy}><Icon name="link" /> Copy address</button>
          <button className="primary" onClick={onDownload}><Icon name="download" /> Download</button>
          <button className="icon-btn" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="v-body">
          {!url && !err && <div className="spinner" />}
          {err && <div className="note bad">{err}</div>}
          {kind === 'video' && url && <video key={url} src={url} controls autoPlay />}
          {kind === 'audio' && url && <audio key={url} src={url} controls autoPlay />}
          {kind === 'image' && url && <img src={url} alt={item.name} />}
          {(kind === 'pdf' || kind === 'text') && url && <iframe src={url} title={item.name} style={{ background: '#fff' }} />}
        </div>
      </div>
    </div>
  )
}
