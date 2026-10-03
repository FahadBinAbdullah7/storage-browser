import { useEffect, useRef, useState } from 'react'
import type { Conn } from '../types'
import { call, kindOf } from '../util'
import Icon, { type IconName } from './Icon'
import { ICON_NAME } from '../util'

const cache = new Map<string, string>()

// Lazily signs and loads a thumbnail only once the tile scrolls into view.
export default function Thumb({ conn, bucket, name, k, size }: { conn: Conn; bucket: string; name: string; k: string; size: number }) {
  const kind = kindOf(name)
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState(cache.get(conn.id + bucket + k) || '')
  const [bad, setBad] = useState(false)
  const media = (kind === 'image' && size < 15e6) || kind === 'video'

  useEffect(() => {
    if (!media || url || !ref.current) return
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      call(window.api.obj.presign(conn.id, bucket, k, 3600)).then((u) => { cache.set(conn.id + bucket + k, u); setUrl(u) }).catch(() => setBad(true))
    }, { rootMargin: '120px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [k, media, url])

  return (
    <div ref={ref} className={'thumb ' + kind}>
      {url && !bad && kind === 'image' && <img src={url} loading="lazy" onError={() => setBad(true)} alt="" />}
      {url && !bad && kind === 'video' && <><video src={url + '#t=0.5'} preload="metadata" muted onError={() => setBad(true)} /><span className="play"><Icon name="play" size={14} /></span></>}
      {(!url || bad) && <Icon name={ICON_NAME[kind] as IconName} size={34} />}
    </div>
  )
}
