'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { STATUS_CONFIG, ProjectStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

interface StatusPickerProps {
  value: ProjectStatus[]
  onChange: (statuses: ProjectStatus[]) => void
  disabled?: boolean
  compact?: boolean  // read-only badge display (member view)
  inline?: boolean   // compact badges + click to open dropdown (admin table view)
}

const ALL_STATUSES = Object.keys(STATUS_CONFIG) as ProjectStatus[]

export default function StatusPicker({ value, onChange, disabled, compact, inline }: StatusPickerProps) {
  const [open, setOpen] = useState(false)
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setDropPos(null)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function toggle(status: ProjectStatus) {
    if (disabled) return
    const next = value.includes(status)
      ? value.filter(s => s !== status)
      : [...value, status]
    onChange(next)
  }

  function handleInlineToggle() {
    if (disabled) return
    if (open) {
      setOpen(false)
      setDropPos(null)
    } else {
      if (triggerRef.current) {
        const r = triggerRef.current.getBoundingClientRect()
        setDropPos({ top: r.bottom + 4, left: r.left })
      }
      setOpen(true)
    }
  }

  // Member view: read-only badges only
  if (compact) {
    return (
      <div className="flex flex-wrap gap-1">
        {value.length === 0 ? (
          <span className="text-xs text-slate-400 italic">Chưa chọn</span>
        ) : (
          value.map(s => (
            <span key={s} className={cn('text-[11px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap', STATUS_CONFIG[s]?.badge)}>
              {STATUS_CONFIG[s]?.label}
            </span>
          ))
        )}
      </div>
    )
  }

  // Admin table view: badges + click to open dropdown popover (portal)
  if (inline) {
    return (
      <div ref={ref}>
        <button
          ref={triggerRef}
          type="button"
          onClick={handleInlineToggle}
          className={cn(
            'flex flex-wrap gap-1 items-center min-w-[80px] px-1 py-0.5 rounded hover:bg-slate-50 transition-colors text-left',
            disabled && 'cursor-not-allowed opacity-60'
          )}
        >
          {value.length === 0 ? (
            <span className="text-xs text-slate-400 italic">Chưa chọn</span>
          ) : (
            value.map(s => (
              <span key={s} className={cn('text-[11px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap', STATUS_CONFIG[s]?.badge)}>
                {STATUS_CONFIG[s]?.label}
              </span>
            ))
          )}
          <ChevronDown size={11} className="text-slate-400 ml-auto shrink-0" />
        </button>

        {open && dropPos && createPortal(
          <div
            style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, zIndex: 9999 }}
            className="bg-white border border-slate-200 rounded-lg shadow-lg p-2 flex flex-wrap gap-1.5 w-56"
          >
            {ALL_STATUSES.map(status => {
              const selected = value.includes(status)
              return (
                <button
                  key={status}
                  type="button"
                  onClick={() => toggle(status)}
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium border transition-all',
                    selected
                      ? cn(STATUS_CONFIG[status]?.badge, 'border-current shadow-sm')
                      : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                  )}
                >
                  {STATUS_CONFIG[status]?.label}
                </button>
              )
            })}
          </div>,
          document.body
        )}
      </div>
    )
  }

  // Full mode: all 8 chips always visible (used in drawer/form)
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_STATUSES.map(status => {
        const selected = value.includes(status)
        return (
          <button
            key={status}
            type="button"
            onClick={() => toggle(status)}
            disabled={disabled}
            className={cn(
              'text-xs px-2.5 py-1 rounded-full font-medium border transition-all',
              selected
                ? cn(STATUS_CONFIG[status]?.badge, 'border-current shadow-sm')
                : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300',
              disabled && 'cursor-not-allowed opacity-60'
            )}
          >
            {STATUS_CONFIG[status]?.label}
          </button>
        )
      })}
    </div>
  )
}
