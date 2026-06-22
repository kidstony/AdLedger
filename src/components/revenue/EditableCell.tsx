'use client'

import { useState, useRef, KeyboardEvent, ClipboardEvent } from 'react'
import { cn } from '@/lib/utils'

interface Props {
  value: number | undefined
  isDirty: boolean
  onCommit: (value: number) => void
  onNavigate?: (direction: 'right' | 'left' | 'down' | 'up') => void
  onFocus?: () => void
  onPaste?: (text: string) => void
}

export default function EditableCell({ value, isDirty, onCommit, onNavigate, onFocus, onPaste }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    onFocus?.()
    setDraft(value !== undefined ? String(value) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commit() {
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
      e.preventDefault()
      commit()
      onNavigate?.('up')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      commit()
      onNavigate?.('down')
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      commit()
      onNavigate?.('left')
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      commit()
      onNavigate?.('right')
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const text = e.clipboardData.getData('text')
    const isMulti = text.includes('\t') || text.split('\n').filter(l => l.trim()).length > 1
    if (isMulti) {
      e.preventDefault()
      onPaste?.(text)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        onPaste={handlePaste}
        className="w-full h-full px-2 py-1.5 text-right font-mono text-xs outline-none border-2 border-blue-400 rounded bg-white"
      />
    )
  }

  return (
    <div
      onClick={startEdit}
      className={cn(
        'w-full h-full px-2 py-1.5 text-right font-mono text-xs cursor-text select-none',
        isDirty ? 'bg-amber-50' : '',
        value === undefined ? 'text-slate-300' : 'text-slate-700'
      )}
    >
      {value !== undefined ? '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
    </div>
  )
}
