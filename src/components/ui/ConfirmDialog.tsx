'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

// Thay thế window.confirm(): const confirm = useConfirm();
// if (!(await confirm({ title: 'Xóa X?' }))) return
export interface ConfirmOptions {
  title: string
  description?: ReactNode
  confirmLabel?: string // default: destructive ? 'Xóa' : 'Xác nhận'
  cancelLabel?: string
  destructive?: boolean // default true
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolverRef = useRef<((v: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((o) => {
    return new Promise<boolean>((resolve) => {
      // Nếu còn dialog cũ chưa trả lời (hiếm) → coi như hủy.
      resolverRef.current?.(false)
      resolverRef.current = resolve
      setOpts(o)
    })
  }, [])

  const finish = (v: boolean) => {
    resolverRef.current?.(v)
    resolverRef.current = null
    setOpts(null)
  }

  const destructive = opts?.destructive ?? true

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={opts !== null} onOpenChange={(open) => { if (!open) finish(false) }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{opts?.title}</DialogTitle>
            {opts?.description ? <DialogDescription>{opts.description}</DialogDescription> : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => finish(false)}>
              {opts?.cancelLabel ?? 'Hủy'}
            </Button>
            <Button variant={destructive ? 'destructive' : 'default'} onClick={() => finish(true)}>
              {opts?.confirmLabel ?? (destructive ? 'Xóa' : 'Xác nhận')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm phải được dùng bên trong <ConfirmProvider>')
  return ctx
}
