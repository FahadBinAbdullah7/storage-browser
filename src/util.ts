export async function call<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error)
  return r.data
}

export function fmtSize(n: number) {
  if (!n) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}

export function fmtDate(s?: string) {
  return s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—'
}

export type Kind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'other'
const EXT: Record<Kind, string[]> = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'],
  pdf: ['pdf'],
  text: ['txt', 'md', 'json', 'csv', 'log', 'xml', 'yml', 'yaml', 'html', 'css', 'js', 'ts', 'sql', 'toml', 'ini', 'srt', 'vtt'],
  other: [],
}
export function kindOf(name: string): Kind {
  const e = name.split('.').pop()?.toLowerCase() || ''
  return (Object.keys(EXT) as Kind[]).find((k) => EXT[k].includes(e)) || 'other'
}
export const ICON_NAME = { folder: 'folder', image: 'image', video: 'video', audio: 'audio', pdf: 'pdf', text: 'text', other: 'file' } as const
