'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const AVATAR_COLORS = [
  'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-cyan-500', 'bg-orange-500', 'bg-teal-500',
]

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function getAvatarBg(id: string) {
  let n = 0
  for (const c of id) n += c.charCodeAt(0)
  return AVATAR_COLORS[n % AVATAR_COLORS.length]
}

interface User { user_id: string; full_name: string }

interface UserSelectProps {
  value: string | null
  users: User[]
  disabled?: boolean
  onChange: (id: string | null) => void
  size?: 'sm' | 'md'
}

export function UserAvatar({ userId, name, size = 'sm' }: { userId: string; name: string; size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? 'w-5 h-5 text-[9px]' : 'w-6 h-6 text-[10px]'
  return (
    <span className={cn('rounded-full flex items-center justify-center text-white font-bold shrink-0', dim, getAvatarBg(userId))}>
      {getInitials(name)}
    </span>
  )
}

export default function UserSelect({ value, users, disabled, onChange, size = 'sm' }: UserSelectProps) {
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selected = users.find(u => u.user_id === value)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (triggerRef.current?.contains(target) || dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onScroll() { setOpen(false) }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open])

  function handleToggle() {
    if (disabled) return
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setDropdownPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(v => !v)
  }

  const dropdown = open && dropdownPos ? createPortal(
    <div
      ref={dropdownRef}
      style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999 }}
      className="bg-white border border-slate-200 rounded-lg shadow-lg min-w-[180px] py-1 text-sm"
    >
      {users.map(u => (
        <button
          key={u.user_id}
          type="button"
          onClick={() => { onChange(u.user_id); setOpen(false) }}
          className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50 text-left"
        >
          <UserAvatar userId={u.user_id} name={u.full_name} size="md" />
          <span className="text-xs text-slate-700 flex-1">{u.full_name}</span>
          {value === u.user_id && <Check size={12} className="text-blue-600 shrink-0" />}
        </button>
      ))}
      <div className="border-t border-slate-100 mt-1 pt-1">
        <button
          type="button"
          onClick={() => { onChange(null); setOpen(false) }}
          className="w-full text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-50"
        >
          — Chưa giao
        </button>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        disabled={disabled}
        className={cn(
          'flex items-center gap-1.5 px-1.5 py-0.5 rounded-md transition-colors text-left',
          disabled
            ? 'cursor-default'
            : 'hover:bg-slate-100 cursor-pointer'
        )}
      >
        {selected ? (
          <>
            <UserAvatar userId={selected.user_id} name={selected.full_name} size={size} />
            <span className="text-xs text-slate-700 max-w-[80px] truncate">{selected.full_name}</span>
            {!disabled && <ChevronDown size={10} className="text-slate-400 shrink-0" />}
          </>
        ) : (
          <>
            <span className="text-xs text-slate-400">— Chưa giao</span>
            {!disabled && <ChevronDown size={10} className="text-slate-400 shrink-0" />}
          </>
        )}
      </button>
      {dropdown}
    </div>
  )
}
