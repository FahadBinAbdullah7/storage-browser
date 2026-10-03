import { useState } from 'react'

// Electron has no window.prompt(), so text input goes through this small modal.
export interface PromptReq { title: string; label?: string; value?: string; onSubmit(v: string): void }

export default function Prompt({ req, onClose }: { req: PromptReq; onClose(): void }) {
  const [v, setV] = useState(req.value || '')
  const go = () => { onClose(); req.onSubmit(v.trim()) }
  return (
    <div className="overlay top" onMouseDown={onClose}>
      <div className="dialog pop" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{req.title}</h3>
        <label>{req.label}<input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} /></label>
        <div className="row end"><button className="ghost" onClick={onClose}>Cancel</button><button className="primary" onClick={go}>OK</button></div>
      </div>
    </div>
  )
}
