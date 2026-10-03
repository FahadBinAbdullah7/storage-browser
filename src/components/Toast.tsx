import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import Icon from './Icon'

type Kind = 'ok' | 'bad' | 'info'
interface T { id: number; text: string; kind: Kind }
const Ctx = createContext<(text: string, kind?: Kind) => void>(() => {})
export const useToast = () => useContext(Ctx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<T[]>([])
  const push = useCallback((text: string, kind: Kind = 'ok') => {
    const id = Date.now() + Math.random()
    setList((l) => [...l.slice(-3), { id, text, kind }])
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), kind === 'bad' ? 6000 : 2600)
  }, [])
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts">
        {list.map((t) => (
          <div key={t.id} className={'toast ' + t.kind}>
            <Icon name={t.kind === 'bad' ? 'close' : 'check'} size={15} /> <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
