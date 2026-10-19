import { useEffect, useRef, useState } from 'react'
import type { SortBy } from '../sort'
import Icon from './Icon'

export interface SortState { by: SortBy; dir: 1 | -1 }
const LABEL: Record<SortBy, string> = { name: 'Name', size: 'Size', date: 'Last modified' }

// "Sort: Name ↑" button with a small menu: choose the column and the direction. Folders always stay first.
export default function SortMenu({ value, onChange }: { value: SortState; onChange(v: SortState): void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [open])
  const choose = (v: SortState) => { onChange(v); setOpen(false) }
  const pick = (by: SortBy) => choose({ by, dir: value.by === by ? value.dir : by === 'name' ? 1 : -1 })
  return (
    <div className="sort-wrap" ref={ref}>
      <button className={'sort-btn' + (open ? ' on' : '')} title="Sort files" onClick={() => setOpen((v) => !v)}>
        <Icon name="list" size={14} /> {LABEL[value.by]} <Icon name={value.dir === 1 ? 'sortUp' : 'sortDown'} size={12} />
      </button>
      {open && (
        <div className="pop-menu">
          <div className="pm-h">Sort by</div>
          {(['name', 'size', 'date'] as SortBy[]).map((b) => (
            <button key={b} className={value.by === b ? 'on' : ''} onClick={() => pick(b)}>
              <span className="pm-c">{value.by === b && <Icon name="check" size={14} />}</span>{LABEL[b]}
            </button>
          ))}
          <div className="pm-sep" />
          <button className={value.dir === 1 ? 'on' : ''} onClick={() => choose({ ...value, dir: 1 })}>
            <span className="pm-c">{value.dir === 1 && <Icon name="check" size={14} />}</span>{value.by === 'name' ? 'A → Z' : value.by === 'size' ? 'Smallest first' : 'Oldest first'}
          </button>
          <button className={value.dir === -1 ? 'on' : ''} onClick={() => choose({ ...value, dir: -1 })}>
            <span className="pm-c">{value.dir === -1 && <Icon name="check" size={14} />}</span>{value.by === 'name' ? 'Z → A' : value.by === 'size' ? 'Largest first' : 'Newest first'}
          </button>
          <div className="pm-note muted">Folders always come first</div>
        </div>
      )}
    </div>
  )
}
