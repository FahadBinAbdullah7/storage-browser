export type SortBy = 'name' | 'size' | 'date'
export interface Sortable { type: 'folder' | 'file'; name: string; size: number; date: string }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
// Above this many entries the natural-number collator is too slow, so a plain case-insensitive order is used.
export const NATURAL_LIMIT = 40000

// Folders first, then files. Name order ignores case and orders numbers naturally (file2 before file10).
// Size and date apply to files; folders have neither, so they stay in name order.
export function sortEntries<T extends Sortable>(list: T[], by: SortBy, dir: 1 | -1): T[] {
  const folders: T[] = []
  const files: T[] = []
  for (const e of list) (e.type === 'folder' ? folders : files).push(e)

  const natural = list.length <= NATURAL_LIMIT
  let byName: (a: T, b: T) => number
  if (natural) {
    byName = (a, b) => collator.compare(a.name, b.name)
  } else {
    const key = new Map<T, string>()
    const k = (e: T) => { let v = key.get(e); if (v === undefined) { v = e.name.toLowerCase(); key.set(e, v) } return v }
    byName = (a, b) => { const x = k(a), y = k(b); return x < y ? -1 : x > y ? 1 : 0 }
  }

  folders.sort((a, b) => byName(a, b) * (by === 'name' ? dir : 1))
  if (by === 'name') files.sort((a, b) => byName(a, b) * dir)
  else if (by === 'size') files.sort((a, b) => (a.size - b.size) * dir || byName(a, b))
  else files.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * dir || byName(a, b))
  return folders.concat(files)
}
