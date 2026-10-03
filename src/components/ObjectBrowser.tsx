import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Conn, FileItem, Folder, SearchProgress, Transfer } from '../types'
import { call, fmtDate, fmtSize, ICON_NAME, kindOf } from '../util'
import Icon, { type IconName } from './Icon'
import Preview from './Preview'
import LinkDialog from './LinkDialog'
import Prompt, { type PromptReq } from './Prompt'
import Thumb from './Thumb'
import InfoPanel from './InfoPanel'
import { useToast } from './Toast'

interface Entry { type: 'folder' | 'file'; key: string; name: string; size: number; date: string }
type SortBy = 'name' | 'size' | 'date'

const lsGet = (k: string, d: string) => { try { return localStorage.getItem(k) || d } catch { return d } }
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } }

export default function ObjectBrowser({ conn, onChanged }: { conn: Conn; onChanged(): void }) {
  const toast = useToast()
  const [buckets, setBuckets] = useState<{ name: string; created?: string }[] | null>(null)
  const [bucketQ, setBucketQ] = useState('')
  const [bucket, setBucket] = useState<string | null>(null)
  const [prefix, setPrefix] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [files, setFiles] = useState<FileItem[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<FileItem | null>(null)
  const [info, setInfo] = useState(false)
  const [clip, setClip] = useState<{ keys: string[]; cut: boolean } | null>(null)
  const [scope, setScope] = useState<'here' | 'sub' | 'bucket'>('sub')
  const [search, setSearch] = useState<{ scanned: number; done: boolean; capped: boolean } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const searchSeq = useRef(0)
  const deep = scope !== 'here'
  const [deepRes, setDeepRes] = useState<{ files: FileItem[]; folders: Folder[] } | null>(null)
  const [hoverDir, setHoverDir] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)
  const [linkFor, setLinkFor] = useState<string | null>(null)
  const [transfers, setTransfers] = useState<Record<string, Transfer>>({})
  const [drag, setDrag] = useState(false)
  const [ask, setAsk] = useState<PromptReq | null>(null)
  const [view, setView] = useState<'list' | 'grid'>(lsGet('view', 'list') as 'list' | 'grid')
  const [sort, setSort] = useState<{ by: SortBy; dir: 1 | -1 }>({ by: 'name', dir: 1 })
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const reqId = useRef(0)
  const lastIdx = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const guard = async <T,>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>) => {
    try { setError(''); return await call(p) } catch (e) { setError((e as Error).message); toast((e as Error).message, 'bad'); return undefined }
  }

  useEffect(() => {
    (async () => {
      setLoading(true)
      const b = await guard(window.api.obj.buckets(conn.id))
      setLoading(false)
      if (!b) return
      setBuckets(b)
      if (b.length === 1) setBucket(b[0].name)
    })()
  }, [conn.id])

  // Keys limited to certain folders can't list the bucket root: show only the path leading to them.
  const allowed = useMemo(() => (conn.folders || '').split('\n').map((x) => x.trim().replace(/^\/+/, '')).filter(Boolean).map((x) => (x.endsWith('/') ? x : x + '/')), [conn.folders])
  const outsideAllowed = (p: string) => allowed.length > 0 && !allowed.some((f) => p.startsWith(f))

  // Loads the first page right away, then keeps fetching the rest in the background so every folder shows up.
  const load = useCallback(async (more = false) => {
    if (!bucket) return
    const id = ++reqId.current
    if (outsideAllowed(prefix)) {
      const segs = [...new Set(allowed.filter((f) => f.startsWith(prefix) && f !== prefix).map((f) => f.slice(prefix.length).split('/')[0]))]
      setFolders(segs.map((n) => ({ prefix: prefix + n + '/', name: n }))); setFiles([]); setNext(null); setLoading(false); setLoadingMore(false); setSel(new Set())
      return
    }
    setLoading(true)
    let token: string | null = more ? next : null
    let first = !more
    let pages = 0
    do {
      const r = await guard(window.api.obj.list(conn.id, bucket, prefix, token))
      if (id !== reqId.current) return
      setLoading(false)
      if (!r) { setLoadingMore(false); return }
      const f0 = first
      setFolders((f) => (f0 ? r.folders : [...f, ...r.folders]))
      setFiles((f) => (f0 ? r.files : [...f, ...r.files]))
      if (f0) setSel(new Set())
      first = false
      token = r.nextToken
      setNext(token)
      pages++
      setLoadingMore(!!token && pages < 60)
    } while (token && pages < 60)
    setLoadingMore(false)
  }, [bucket, prefix, conn.id, next, allowed])

  useEffect(() => { setFolders([]); setFiles([]); load(false) }, [bucket, prefix]) // eslint-disable-line react-hooks/exhaustive-deps

  // Streaming search: results appear as they are found; typing again cancels the previous scan.
  useEffect(() => {
    const q = filter.trim()
    if (!deep || q.length < 2 || !bucket) { setDeepRes(null); setSearch(null); return }
    const sid = `s${++searchSeq.current}`
    const root = scope === 'bucket' ? '' : prefix
    setDeepRes({ files: [], folders: [] }); setSearch({ scanned: 0, done: false, capped: false })
    const off = window.api.onSearch((r: SearchProgress) => {
      if (r.id !== sid) return
      setDeepRes({ files: r.files, folders: r.folders })
      setSearch({ scanned: r.scanned, done: r.done, capped: r.capped })
    })
    const t = setTimeout(() => {
      guard(window.api.obj.search(conn.id, bucket, root, q, sid)).then(() => setSearch((x) => x && { ...x, done: true }))
    }, 250)
    return () => { clearTimeout(t); off(); window.api.obj.searchCancel(sid) }
  }, [scope, filter, bucket, prefix])

  useEffect(() => window.api.onTransfer((t) => {
    setTransfers((m) => ({ ...m, [t.id]: t }))
    if (t.kind === 'upload' && t.state === 'done') { clearTimeout(timer.current); timer.current = setTimeout(() => load(false), 600) }
    if (t.state === 'error') toast(`${t.name}: ${t.error}`, 'bad')
  }), [load])

  const entries = useMemo<Entry[]>(() => {
    const f = filter.toLowerCase()
    const cmp = (a: Entry, b: Entry) => {
      const v = sort.by === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true }) : sort.by === 'size' ? a.size - b.size : a.date.localeCompare(b.date)
      return v * sort.dir
    }
    const pool = deepRes ? deepRes.files : files
    const fo = (deepRes ? deepRes.folders : folders).filter((x) => x.name.toLowerCase().includes(f)).map<Entry>((x) => ({ type: 'folder', key: x.prefix, name: x.name, size: 0, date: '' }))
    const fi = pool.filter((x) => x.name.toLowerCase().includes(f)).map<Entry>((x) => ({ type: 'file', key: x.key, name: x.name, size: x.size, date: x.lastModified || '' }))
    return [...fo.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), ...fi.sort(cmp)]
  }, [folders, files, deepRes, filter, sort])

  const crumbs = prefix.split('/').filter(Boolean)
  const publicBase = (bucket && conn.publicUrls?.[bucket]) || conn.publicBase || undefined
  const selKeys = [...sel]
  const hasFolder = selKeys.some((k) => k.endsWith('/'))
  const oneFile = selKeys.length === 1 && !selKeys[0].endsWith('/')
  const previewable = entries.filter((e) => e.type === 'file')
  const fileOf = (k: string) => (deepRes ? deepRes.files : files).find((x) => x.key === k)
  const totalSize = files.reduce((n, f) => n + f.size, 0)

  const select = (e: React.MouseEvent, i: number) => {
    const k = entries[i].key
    setSel((s) => {
      if (e.shiftKey) { const [a, b] = [Math.min(lastIdx.current, i), Math.max(lastIdx.current, i)]; return new Set(entries.slice(a, b + 1).map((x) => x.key)) }
      if (e.metaKey || e.ctrlKey) { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n }
      return new Set([k])
    })
    lastIdx.current = i
  }

  const openEntry = (e: Entry) => (e.type === 'folder' ? (setFilter(''), setPrefix(e.key)) : setPreview(fileOf(e.key) || null))

  const copyLink = async (key: string) => {
    if (!publicBase) { setLinkFor(key); return }
    const url = `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}`
    await window.api.copy(url)
    toast('Link copied — ' + url.replace(/^https?:\/\//, ''))
  }

  const cdnUrl = (key: string) => (publicBase ? `${publicBase}/${key.split('/').map(encodeURIComponent).join('/')}` : '')
  const copyText = async (text: string, msg: string) => { await window.api.copy(text); toast(msg) }
  const openInBrowser = async (key: string) => {
    const u = cdnUrl(key) || (bucket ? await guard(window.api.obj.presign(conn.id, bucket, key, 3600)) : '')
    if (u) window.api.openExternal(u)
  }
  const copySel = (cut: boolean) => { if (selKeys.length) { setClip({ keys: selKeys, cut }); toast(`${cut ? 'Cut' : 'Copied'} ${selKeys.length} item(s) — open a folder and paste`, 'info') } }
  const pasteTo = async (dest: string) => {
    if (!clip || !bucket) return
    for (const k of clip.keys) {
      const isDir = k.endsWith('/')
      const base = k.replace(/\/$/, '').split('/').pop()!
      const to = dest + base + (isDir ? '/' : '')
      if (to === k) { if (clip.cut) continue }
      if (isDir && dest.startsWith(k)) { toast("Can't paste a folder into itself", 'bad'); continue }
      const final = to === k ? dest + base.replace(/(\.[^.]*)?$/, (m) => ' copy' + m) + (isDir ? '/' : '') : to
      await guard(clip.cut ? window.api.obj.move(conn.id, bucket, k, final) : window.api.obj.copy(conn.id, bucket, k, final))
    }
    if (clip.cut) setClip(null)
    toast('Done'); load(false)
  }
  const duplicate = async () => {
    if (!bucket || selKeys.length !== 1) return
    const k = selKeys[0]
    const isDir = k.endsWith('/')
    const base = k.replace(/\/$/, '')
    const to = isDir ? base + ' copy/' : base.replace(/(\.[^./]*)?$/, (m) => ' copy' + m)
    await guard(window.api.obj.copy(conn.id, bucket, k, to)); toast('Duplicated'); load(false)
  }
  const dropOnFolder = async (e: React.DragEvent, dest: string) => {
    const raw = e.dataTransfer.getData('application/x-cloudpeek')
    setHoverDir('')
    if (!raw || !bucket) return
    e.preventDefault(); e.stopPropagation()
    const keys: string[] = JSON.parse(raw)
    for (const k of keys) {
      if (k === dest || (k.endsWith('/') && dest.startsWith(k))) continue
      await guard(window.api.obj.move(conn.id, bucket, k, dest + k.replace(/\/$/, '').split('/').pop() + (k.endsWith('/') ? '/' : '')))
    }
    toast('Moved'); load(false)
  }
  const dragProps = (e: Entry) => ({
    draggable: true,
    onDragStart: (ev: React.DragEvent) => {
      const keys = sel.has(e.key) ? [...sel] : [e.key]
      ev.dataTransfer.setData('application/x-cloudpeek', JSON.stringify(keys)); ev.dataTransfer.effectAllowed = 'move'
    },
    ...(e.type === 'folder' ? {
      onDragOver: (ev: React.DragEvent) => { if (ev.dataTransfer.types.includes('application/x-cloudpeek')) { ev.preventDefault(); setHoverDir(e.key) } },
      onDragLeave: () => setHoverDir(''),
      onDrop: (ev: React.DragEvent) => dropOnFolder(ev, e.key),
    } : {}),
  })

  const upload = async (paths: string[]) => {
    if (bucket && paths.length) { await guard(window.api.obj.upload(conn.id, bucket, prefix, paths)); toast(`Uploading ${paths.length} item(s)…`, 'info') }
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false)
    upload([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean))
  }

  const newFolder = () => setAsk({
    title: 'New folder', label: 'Folder name',
    onSubmit: async (v) => {
      const n = v.replace(/^\/+|\/+$/g, '')
      if (n && bucket) { await guard(window.api.obj.mkdir(conn.id, bucket, prefix + n + '/')); load(false) }
    },
  })
  const del = async () => {
    if (selKeys.some((k) => k.endsWith('/'))) { toast("Folders can't be deleted — select files only", 'bad'); return }
    if (!bucket || !selKeys.length || !confirm(`Delete ${selKeys.length} file(s)? This can't be undone.`)) return
    if (await guard(window.api.obj.remove(conn.id, bucket, selKeys)) !== undefined) toast('Deleted'); load(false)
  }
  const rename = () => {
    if (!bucket || selKeys.length !== 1) return
    const from = selKeys[0]
    const isDir = from.endsWith('/')
    const old = from.slice(prefix.length).replace(/\/$/, '')
    setAsk({
      title: 'Rename', label: 'New name', value: old,
      onSubmit: async (v) => {
        const n = v.replace(/\/+$/, '')
        if (!n || n === old) return
        await guard(window.api.obj.move(conn.id, bucket, from, prefix + n + (isDir ? '/' : ''))); load(false)
      },
    })
  }
  const setPublic = () => {
    if (!bucket) return
    setAsk({
      title: 'CDN / public URL', label: 'Domain for this bucket, e.g. https://cdn.example.com (empty to clear)', value: publicBase || 'https://',
      onSubmit: async (v) => {
        const urls = { ...(conn.publicUrls || {}) }
        if (v && v !== 'https://') urls[bucket] = v.replace(/\/+$/, ''); else delete urls[bucket]
        await guard(window.api.conn.save({ id: conn.id, publicUrls: urls })); onChanged()
      },
    })
  }
  const download = () => bucket && guard(window.api.obj.download(conn.id, bucket, selKeys))

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (preview || linkFor || ask || (e.target as HTMLElement).matches('input,textarea,select')) return
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.preventDefault(); setSel(new Set(entries.map((x) => x.key))) }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'c') { e.preventDefault(); copySel(false) }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'x') { e.preventDefault(); copySel(true) }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'v') { e.preventDefault(); pasteTo(prefix) }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'd') { e.preventDefault(); duplicate() }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); setInfo((v) => !v) }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); filterRef.current?.focus() }
      else if (e.key === 'Escape') { setSel(new Set()); setMenu(null); setFilter('') }
      else if (e.key === 'Delete' || (e.key === 'Backspace' && e.metaKey)) del()
      else if (e.key === 'Enter' && selKeys.length === 1) { const en = entries.find((x) => x.key === selKeys[0]); en && openEntry(en) }
      else if (e.key === 'Backspace' && prefix) setPrefix(crumbs.slice(0, -1).map((c) => c + '/').join(''))
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })
  useEffect(() => { const c = () => setMenu(null); window.addEventListener('click', c); return () => window.removeEventListener('click', c) }, [])

  const toggleSort = (by: SortBy) => setSort((s) => (s.by === by ? { by, dir: (s.dir * -1) as 1 | -1 } : { by, dir: 1 }))
  const SortHead = ({ by, label, cls = '' }: { by: SortBy; label: string; cls?: string }) => (
    <th className={cls + ' sortable'} onClick={() => toggleSort(by)}>{label}{sort.by === by && <Icon name={sort.dir === 1 ? 'sortUp' : 'sortDown'} size={12} />}</th>
  )

  const tList = Object.values(transfers).reverse()
  const active = tList.filter((t) => t.state === 'active')
  const pct = active.length ? Math.round((active.reduce((n, t) => n + t.loaded, 0) / Math.max(1, active.reduce((n, t) => n + t.total, 0))) * 100) : 0

  // --- bucket picker
  if (!bucket) return (
    <div className="browser fade">
      <div className="toolbar"><h2 className="title">{conn.name}</h2><span className="chip">Buckets</span><span className="grow" />
        <button className="primary" onClick={() => setAsk({ title: 'New bucket', label: 'Bucket name (lowercase letters, numbers, hyphens)', onSubmit: async (v) => { if (v && await guard(window.api.obj.createBucket(conn.id, v)) !== undefined) { toast('Bucket created'); setBuckets((b) => [...(b || []), { name: v }]) } } })}><Icon name="plus" /> New bucket</button></div>
      {loading && <div className="skel-list">{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ animationDelay: i * 60 + 'ms' }} />)}</div>}
      {error && <div className="empty-state"><Icon name="cloud" size={42} /><h3>Couldn't connect</h3><p className="muted">{error}</p><button className="primary" onClick={() => location.reload()}>Retry</button></div>}
      {buckets && buckets.length > 0 && (() => {
        const q = bucketQ.trim().toLowerCase()
        const shown = buckets.filter((x) => x.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
        return (
          <div className="bucket-list fade">
            <div className="search-box wide"><Icon name="search" size={14} /><input autoFocus placeholder={`Search ${buckets.length} bucket(s)…`} value={bucketQ} onChange={(e) => setBucketQ(e.target.value)} onKeyDown={(e) => { if (e.key !== 'Enter') return; if (shown.length) { setBucket(shown[0].name); setPrefix('') } else if (bucketQ.trim()) { setBucket(bucketQ.trim()); setPrefix('') } }} /></div>
            <table>
              <thead><tr><th>Bucket</th><th className="date">Created</th><th className="num" /></tr></thead>
              <tbody>
                {shown.map((x, i) => (
                  <tr key={x.name} style={{ animationDelay: Math.min(i, 20) * 12 + 'ms' }} onClick={() => { setBucket(x.name); setPrefix('') }}>
                    <td><span className="fi folder"><Icon name="bucket" size={18} /></span>{x.name}</td>
                    <td className="date muted">{x.created ? fmtDate(x.created) : '—'}</td>
                    <td className="num"><Icon name="chevR" size={15} className="muted" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && <div className="empty-state"><Icon name="search" size={38} /><h3>No bucket matches “{bucketQ}”</h3><p className="muted">Press Enter to try opening a bucket named “{bucketQ.trim()}” anyway.</p></div>}
          </div>
        )
      })()}
      {buckets && !buckets.length && <div className="empty-state"><Icon name="bucket" size={42} /><h3>No buckets listed</h3><p className="muted">Keys limited to one bucket can't list buckets. Type the bucket name to open it:</p><div className="search-box wide"><Icon name="bucket" size={14} /><input autoFocus placeholder="bucket name, then Enter" value={bucketQ} onChange={(e) => setBucketQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && bucketQ.trim()) { setBucket(bucketQ.trim()); setPrefix('') } }} /></div></div>}
    </div>
  )

  const menuItems: { icon: IconName; label: string; fn(): void; danger?: boolean; hide?: boolean }[] = [
    { icon: 'play', label: 'Open', fn: () => { const e = entries.find((x) => x.key === selKeys[0]); e && openEntry(e) }, hide: selKeys.length !== 1 },
    { icon: 'link', label: 'Copy link', fn: () => copyLink(selKeys[0]), hide: !oneFile },
    { icon: 'clock', label: 'Signed link…', fn: () => setLinkFor(selKeys[0]), hide: !oneFile },
    { icon: 'link', label: 'Copy S3 URI', fn: () => copyText(`s3://${bucket}/${selKeys[0]}`, 'S3 URI copied'), hide: selKeys.length !== 1 },
    { icon: 'file', label: 'Copy path', fn: () => copyText(selKeys[0], 'Path copied'), hide: selKeys.length !== 1 },
    { icon: 'globe', label: 'Open in browser', fn: () => openInBrowser(selKeys[0]), hide: !oneFile },
    { icon: 'download', label: 'Download', fn: download },
    { icon: 'file', label: 'Copy', fn: () => copySel(false) },
    { icon: 'file', label: 'Cut', fn: () => copySel(true) },
    { icon: 'plus', label: 'Paste here', fn: () => pasteTo(selKeys.length === 1 && selKeys[0].endsWith('/') ? selKeys[0] : prefix), hide: !clip },
    { icon: 'file', label: 'Duplicate', fn: duplicate, hide: selKeys.length !== 1 },
    { icon: 'settings', label: 'Get info', fn: () => setInfo(true), hide: selKeys.length !== 1 },
    { icon: 'edit', label: 'Rename', fn: rename, hide: selKeys.length !== 1 },
    { icon: 'trash', label: 'Delete', fn: del, danger: true, hide: hasFolder },
  ]

  return (
    <div className="browser fade" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrag(true) } }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDrag(false) }} onDrop={onDrop}>
      <div className="toolbar">
        <button className="icon-btn" title="Back" onClick={() => (prefix ? setPrefix(crumbs.slice(0, -1).map((c) => c + '/').join('')) : setBucket(null))} disabled={!prefix && !(buckets && buckets.length > 1)}><Icon name="back" /></button>
        <div className="crumbs">
          <a onClick={() => setPrefix('')}><Icon name="bucket" size={14} /> {bucket}</a>
          {crumbs.map((c, i) => <span key={i}><Icon name="chevR" size={12} className="muted" /><a onClick={() => setPrefix(crumbs.slice(0, i + 1).join('/') + '/')}>{c}</a></span>)}
        </div>
        <div className="seg">
          <button className={view === 'list' ? 'on' : ''} title="List" onClick={() => { setView('list'); lsSet('view', 'list') }}><Icon name="list" /></button>
          <button className={view === 'grid' ? 'on' : ''} title="Grid" onClick={() => { setView('grid'); lsSet('view', 'grid') }}><Icon name="grid" /></button>
        </div>
        <button className={'icon-btn' + (info ? ' on' : '')} title="Info (Ctrl/⌘+I)" onClick={() => setInfo((v) => !v)}><Icon name="settings" /></button>
        <button className="icon-btn" title="Refresh" onClick={() => load(false)}><Icon name="refresh" className={loading ? 'spin' : ''} /></button>
      </div>

      <div className="searchbar">
        <div className="search-big">
          <Icon name="search" size={16} />
          <input ref={filterRef} placeholder={scope === 'here' ? 'Filter files and folders in this folder…' : scope === 'sub' ? 'Search folders & files in this folder and everything inside…' : `Search the whole “${bucket}” bucket…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
          {filter && <button className="icon-btn sm" title="Clear (Esc)" onClick={() => setFilter('')}><Icon name="close" size={14} /></button>}
        </div>
        <div className="seg labeled" title="Where to search">
          <button className={scope === 'here' ? 'on' : ''} onClick={() => setScope('here')}>This folder</button>
          <button className={scope === 'sub' ? 'on' : ''} onClick={() => setScope('sub')}>Include subfolders</button>
          <button className={scope === 'bucket' ? 'on' : ''} onClick={() => setScope('bucket')}>Whole bucket</button>
        </div>
      </div>
      {search && (
        <div className="search-status">
          {!search.done ? <><div className="spinner sm" /> Searching… {search.scanned.toLocaleString()} items checked · {(deepRes?.files.length || 0) + (deepRes?.folders.length || 0)} found</>
            : <>{(deepRes?.files.length || 0) + (deepRes?.folders.length || 0)} result(s){search.capped ? ' (showing the first 500 — type more letters to narrow down)' : ''} · {search.scanned.toLocaleString()} items checked</>}
          {!search.done && <button className="ghost sm" onClick={() => { setFilter('') }}>Stop</button>}
        </div>
      )}
      <div className="actions">
        <button className="primary" onClick={() => guard(window.api.obj.pickUpload(conn.id, bucket, prefix, false))}><Icon name="upload" /> Upload</button>
        <button onClick={() => guard(window.api.obj.pickUpload(conn.id, bucket, prefix, true))}><Icon name="folder" /> Upload folder</button>
        <button onClick={newFolder}><Icon name="plus" /> New folder</button>
        {clip && <button onClick={() => pasteTo(prefix)}><Icon name="plus" /> Paste {clip.keys.length}</button>}
        <span className="sep" />
        <div className={'sel-actions' + (selKeys.length ? ' show' : '')}>
          <span className="chip accent">{selKeys.length} selected</span>
          <button onClick={download}><Icon name="download" /> Download</button>
          {oneFile && <button onClick={() => copyLink(selKeys[0])}><Icon name="link" /> Copy link</button>}
          {oneFile && <button className="ghost" onClick={() => setLinkFor(selKeys[0])}><Icon name="clock" /> Signed</button>}
          {selKeys.length === 1 && <button onClick={rename}><Icon name="edit" /> Rename</button>}
          <button className="danger" disabled={hasFolder} title={hasFolder ? "Folders can't be deleted" : undefined} onClick={del}><Icon name="trash" /> Delete</button>
        </div>
        <span className="grow" />
        <button className={'ghost cdn' + (publicBase ? ' set' : '')} onClick={setPublic} title="Links you copy use this domain"><Icon name="globe" /> {publicBase ? publicBase.replace(/^https?:\/\//, '') : 'Set CDN URL'}</button>
      </div>

      <div className="split">
      <div className="content" onClick={(e) => { if (e.target === e.currentTarget) setSel(new Set()) }}>
        {loading && !entries.length && <div className="skel-list">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="skel" style={{ animationDelay: i * 60 + 'ms' }} />)}</div>}

        {!loading && !entries.length && (!search || search.done) && (
          <div className="empty-state">
            <div className="drop-ico"><Icon name="upload" size={34} /></div>
            <h3>{filter ? 'No matches' : 'Nothing here yet'}</h3>
            <p className="muted">{filter ? 'Try a different search.' : prefix === '' ? 'Nothing found at the top of this bucket. If you expected files, check that this is the right bucket, and whether your key is limited to certain folders (edit the connection and add them under “Allowed folders”). You can also drag files here to upload.' : 'Drag files or folders here to upload, or use the Upload button.'}</p>
          </div>
        )}

        {entries.length > 0 && view === 'list' && (
          <table>
            <thead><tr><SortHead by="name" label="Name" /><SortHead by="size" label="Size" cls="num" /><SortHead by="date" label="Modified" cls="date" /></tr></thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.key} {...dragProps(e)} className={(sel.has(e.key) ? 'on' : '') + (hoverDir === e.key ? ' drop' : '')} style={{ animationDelay: Math.min(i, 20) * 12 + 'ms' }}
                  onClick={(ev) => select(ev, i)} onDoubleClick={() => openEntry(e)}
                  onContextMenu={(ev) => { ev.preventDefault(); if (!sel.has(e.key)) setSel(new Set([e.key])); setMenu({ x: ev.clientX, y: ev.clientY }) }}>
                  <td><span className={'fi ' + (e.type === 'folder' ? 'folder' : kindOf(e.name))}><Icon name={(e.type === 'folder' ? 'folder' : ICON_NAME[kindOf(e.name)]) as IconName} size={18} /></span>{e.name}</td>
                  <td className="num muted">{e.type === 'folder' ? '—' : fmtSize(e.size)}</td>
                  <td className="date muted">{e.type === 'folder' ? '—' : fmtDate(e.date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {entries.length > 0 && view === 'grid' && (
          <div className="tiles">
            {entries.map((e, i) => (
              <div key={e.key} {...dragProps(e)} className={'tile' + (sel.has(e.key) ? ' on' : '') + (hoverDir === e.key ? ' drop' : '')} style={{ animationDelay: Math.min(i, 24) * 16 + 'ms' }}
                onClick={(ev) => select(ev, i)} onDoubleClick={() => openEntry(e)}
                onContextMenu={(ev) => { ev.preventDefault(); if (!sel.has(e.key)) setSel(new Set([e.key])); setMenu({ x: ev.clientX, y: ev.clientY }) }}>
                {e.type === 'folder'
                  ? <div className="thumb folder"><Icon name="folder" size={40} /></div>
                  : <Thumb conn={conn} bucket={bucket} name={e.name} k={e.key} size={e.size} />}
                <div className="t-name" title={e.name}>{e.name}</div>
                <div className="t-meta muted">{e.type === 'folder' ? 'Folder' : fmtSize(e.size)}</div>
              </div>
            ))}
          </div>
        )}
        {next && !loading && <p className="center pad"><button onClick={() => load(true)}>Load more</button></p>}
      </div>

      {info && <InfoPanel conn={conn} bucket={bucket} k={selKeys.length === 1 ? selKeys[0] : null} onClose={() => setInfo(false)} />}
      </div>

      <div className="status muted">
        <span>{loadingMore && <span className="spinner sm inl" />}{folders.length} folder(s), {files.length} file(s){files.length ? ` · ${fmtSize(totalSize)}` : ''}{loadingMore ? ' · loading more…' : next ? ' · more available' : ''}</span>
        <span className="hint">Double-click to open · Right-click for more · Drop files to upload</span>
      </div>

      {drag && <div className="dropzone"><div><Icon name="upload" size={44} /><h3>Drop to upload</h3><p>/{prefix}</p></div></div>}

      {menu && (
        <div className="menu" style={{ left: Math.min(menu.x, innerWidth - 190), top: Math.min(menu.y, innerHeight - 240) }} onClick={(e) => e.stopPropagation()}>
          {menuItems.filter((m) => !m.hide).map((m) => <button key={m.label} className={m.danger ? 'danger' : ''} onClick={() => { setMenu(null); m.fn() }}><Icon name={m.icon} size={15} /> {m.label}</button>)}
        </div>
      )}

      {tList.length > 0 && (
        <div className="transfers">
          <div className="t-head">
            <span>{active.length ? `Transferring ${active.length} file(s) · ${pct}%` : 'Transfers'}</span>
            <button className="ghost sm" onClick={() => setTransfers((m) => Object.fromEntries(Object.entries(m).filter(([, t]) => t.state === 'active')))}>Clear</button>
          </div>
          <div className="t-list">
            {tList.slice(0, 8).map((t) => (
              <div key={t.id} className={'t-row ' + t.state}>
                <Icon name={t.kind === 'upload' ? 'upload' : 'download'} size={14} />
                <span className="ellipsis grow">{t.name}</span>
                {t.state === 'active' && <div className="bar"><i style={{ width: (t.total ? (t.loaded / t.total) * 100 : 0) + '%' }} /></div>}
                {t.state === 'done' && <Icon name="check" size={15} className="ok-t" />}
                {t.state === 'error' && <span className="bad-t" title={t.error}>failed</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {preview && (() => {
        const f = preview
        const idx = previewable.findIndex((e) => e.key === f.key)
        const go = (d: number) => { const n = previewable[idx + d]; const nf = n && fileOf(n.key); if (nf) setPreview(nf) }
        return <Preview conn={conn} bucket={bucket} file={f} onClose={() => setPreview(null)} onLink={() => copyLink(f.key)} onDownload={() => guard(window.api.obj.download(conn.id, bucket, [f.key]))}
          onPrev={idx > 0 ? () => go(-1) : undefined} onNext={idx >= 0 && idx < previewable.length - 1 ? () => go(1) : undefined} />
      })()}
      {ask && <Prompt req={ask} onClose={() => setAsk(null)} />}
      {linkFor && <LinkDialog conn={conn} bucket={bucket} keyName={linkFor} publicBase={publicBase} onClose={() => setLinkFor(null)} />}
    </div>
  )
}
