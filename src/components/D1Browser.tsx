import { useEffect, useState } from 'react'
import type { Conn, D1Result } from '../types'
import { call } from '../util'
import Icon from './Icon'

const PAGE = 100
const csv = (d: D1Result) => {
  const q = (v: unknown) => (v === null || v === undefined ? '' : /[",\n]/.test(String(typeof v === 'object' ? JSON.stringify(v) : v)) ? '"' + String(typeof v === 'object' ? JSON.stringify(v) : v).replace(/"/g, '""') + '"' : String(typeof v === 'object' ? JSON.stringify(v) : v))
  return [d.columns.join(','), ...d.rows.map((r) => d.columns.map((c) => q(r[c])).join(','))].join('\n')
}
const exportCsv = (d: D1Result, name: string) => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv(d)], { type: 'text/csv' }))
  a.download = name + '.csv'; a.click()
}
const cell = (v: unknown) => (v === null ? <i className="muted">NULL</i> : typeof v === 'object' ? JSON.stringify(v) : String(v))

export default function D1Browser({ conn }: { conn: Conn }) {
  const [dbs, setDbs] = useState<{ id: string; name: string }[]>([])
  const [db, setDb] = useState('')
  const [tables, setTables] = useState<string[]>([])
  const [table, setTable] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<(D1Result & { total?: number }) | null>(null)
  const [sql, setSql] = useState('')
  const [mode, setMode] = useState<'browse' | 'sql'>('browse')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async <T,>(fn: () => Promise<T>) => {
    setBusy(true); setError('')
    try { return await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  useEffect(() => { run(async () => setDbs(await call(window.api.d1.databases(conn.id)))) }, [conn.id])
  useEffect(() => {
    if (!db) return
    setTable(''); setData(null)
    run(async () => setTables(await call(window.api.d1.tables(conn.id, db))))
  }, [db])
  useEffect(() => {
    if (!db || !table || mode !== 'browse') return
    run(async () => setData(await call(window.api.d1.browse(conn.id, db, table, PAGE, offset))))
  }, [table, offset, mode])

  const exec = () => run(async () => setData(await call(window.api.d1.query(conn.id, db, sql))))

  return (
    <div className="browser d1 fade">
      <div className="toolbar">
        <h2 className="title">{conn.name}</h2>
        <select value={db} onChange={(e) => { setDb(e.target.value); setOffset(0) }}>
          <option value="">Select database…</option>
          {dbs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <div className="tabs inline">
          <button className={mode === 'browse' ? 'on' : ''} onClick={() => setMode('browse')}>Tables</button>
          <button className={mode === 'sql' ? 'on' : ''} onClick={() => setMode('sql')}>SQL</button>
        </div>
        {busy && <div className="spinner sm" />}
        {data && data.rows.length > 0 && <button onClick={() => exportCsv(data, table || 'query')}><Icon name="download" size={14} /> Export CSV</button>}
      </div>
      {error && <div className="note bad m">{error}</div>}
      {!db && !busy && !error && <div className="empty-state"><Icon name="db" size={42} /><h3>Choose a database</h3><p className="muted">Pick one from the dropdown above to browse its tables.</p></div>}
      <div className="d1-body">
        {mode === 'browse' && (
          <div className="tables">
            {tables.map((t) => <div key={t} className={'conn' + (t === table ? ' on' : '')} onClick={() => { setTable(t); setOffset(0) }}><Icon name="table" size={15} /> {t}</div>)}
            {db && !tables.length && !busy && <p className="muted pad">No tables.</p>}
          </div>
        )}
        <div className="d1-main">
          {mode === 'sql' && (
            <div className="sql">
              <textarea value={sql} onChange={(e) => setSql(e.target.value)} placeholder="SELECT * FROM my_table LIMIT 50;" onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') exec() }} />
              <div className="row end"><span className="muted small grow">⌘/Ctrl + Enter to run. Statements run against the live database.</span><button className="primary" disabled={!db || !sql.trim() || busy} onClick={exec}><Icon name="play" size={13} /> Run</button></div>
            </div>
          )}
          {data && (
            <div className="table-wrap">
              <table>
                <thead><tr>{data.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>{data.rows.map((r, i) => <tr key={i}>{data.columns.map((c) => <td key={c} className="mono">{cell(r[c])}</td>)}</tr>)}</tbody>
              </table>
              {!data.rows.length && <p className="muted pad center">No rows{data.meta?.changes ? ` — ${data.meta.changes} row(s) changed` : ''}.</p>}
            </div>
          )}
          {data && mode === 'browse' && data.total !== undefined && (
            <div className="toolbar sub">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>‹ Prev</button>
              <span className="muted">{data.total ? `${offset + 1}–${Math.min(offset + PAGE, data.total)} of ${data.total}` : '0 rows'}</span>
              <button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next ›</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
