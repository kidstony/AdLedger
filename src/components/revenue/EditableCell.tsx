'use client'

import { useState, useRef, KeyboardEvent, ClipboardEvent } from 'react'
import { Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  value: number | undefined
  isDirty?: boolean
  onCommit: (value: number) => void
  onNavigate?: (direction: 'right' | 'left' | 'down' | 'up') => void
  onFocus?: () => void
  onPaste?: (text: string) => void
  onClear?: () => void
  // Cumulative mode: override the displayed number and show a subtitle
  displayValue?: number
  valueSubtitle?: string
  valueColorClass?: string
  // Note indicator (chargeback)
  hasNote?: boolean
  onNoteClick?: (e: React.MouseEvent) => void
  // Billing period indicator (double-click to tag)
  hasPayout?: boolean
  onDoubleClick?: () => void
}

export default function EditableCell({
  value, isDirty, onCommit, onNavigate, onFocus, onPaste, onClear,
  displayValue, valueSubtitle, valueColorClass,
  hasNote, onNoteClick,
  hasPayout, onDoubleClick,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    onFocus?.()
    setDraft(value !== undefined && value !== 0 ? String(value) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commit() {
    if (draft.trim() === '') {
      onClear?.()
      setEditing(false)
      return
    }
    const num = parseFloat(draft.replace(/[^0-9.]/g, ''))
    if (!isNaN(num)) onCommit(Math.round(num * 100) / 100)
    setEditing(false)
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Tab') {
      e.preventDefault()
      commit()
      e.shiftKey ? onNavigate?.('left') : onNavigate?.('right')
    } else if (e.key === 'Enter') {
      commit()
      onNavigate?.('down')
    } else if (e.key === 'Escape') {
      setEditing(false)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); commit(); onNavigate?.('up')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault(); commit(); onNavigate?.('down')
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault(); commit(); onNavigate?.('left')
    } else if (e.key === 'ArrowRight') {
      e.preventDefault(); commit(); onNavigate?.('right')
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const text = e.clipboardData.getData('text')
    const isMulti = text.includes('\t') || text.split('\n').filter(l => l.trim()).length > 1
    if (isMulti) { e.preventDefault(); onPaste?.(text) }
  }

  const isCumulative = displayValue !== undefined
  const mainValue    = isCumulative ? displayValue : value
  const isEmpty      = mainValue === undefined || mainValue === 0
  const mainColorClass = isCumulative
    ? (valueColorClass ?? (displayValue! >= 0 ? 'text-slate-700' : 'text-red-600'))
    : 'text-slate-700'

  function fmt(n: number) {
    return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  return (
    <div className="relative w-full h-full">
      {editing && (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKey}
          onPaste={handlePaste}
          className="absolute inset-0 w-full h-full px-2 text-right font-mono text-xs outline-none border-2 border-blue-400 rounded bg-white z-10"
        />
      )}
    <div
      onClick={startEdit}
      onDoubleClick={onDoubleClick}
      className={cn(
        'relative w-full h-full px-2 cursor-text select-none',
        isCumulative ? 'py-1' : 'py-1.5',
      )}
    >
      {/* Blue dot: has billing period */}
      {hasPayout && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-500" />
      )}

      {/* Main value */}
      <div className={cn('text-right font-mono text-xs font-medium', isEmpty ? 'opacity-25 text-slate-500' : mainColorClass)}>
        {isEmpty
          ? '$0.00'
          : (isCumulative && displayValue! < 0 ? '-' : '') + fmt(mainValue!)}
      </div>

      {/* Subtitle (cumulative total) */}
      {valueSubtitle && (
        <div className="text-right font-mono text-[10px] text-slate-400 leading-none">
          {valueSubtitle}
        </div>
      )}

      {/* Note icon (chargeback) */}
      {isCumulative && displayValue !== undefined && displayValue < 0 && (
        <button
          onClick={e => { e.stopPropagation(); onNoteClick?.(e) }}
          className={cn(
            'absolute bottom-0.5 left-1 p-0.5 rounded transition-colors',
            hasNote ? 'text-amber-500 hover:text-amber-600' : 'text-slate-300 hover:text-slate-500'
          )}
          title={hasNote ? 'Xem/sửa ghi chú' : 'Thêm ghi chú'}
        >
          <Pencil size={9} />
        </button>
      )}
    </div>
    </div>
  )
}
