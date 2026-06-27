'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Check, ChevronDown } from 'lucide-react'
import { ProjectCategory } from '@/lib/types'
import { cn } from '@/lib/utils'

const COLOR_PRESETS = [
  '#ef4444','#f97316','#eab308','#22c55e',
  '#3b82f6','#8b5cf6','#ec4899','#6b7280',
]

interface CategorySelectProps {
  value: string | null
  categories: ProjectCategory[]
  canManage: boolean
  onChange: (id: string | null) => void
  onCategoryCreated: (cat: ProjectCategory) => void
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
}

export default function CategorySelect({
  value, categories, canManage, onChange, onCategoryCreated, authFetch,
}: CategorySelectProps) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLOR_PRESETS[4])
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Click outside — check both trigger and portal dropdown
  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (
        triggerRef.current?.contains(target) ||
        dropdownRef.current?.contains(target)
      ) return
      setOpen(false)
      setAdding(false)
      setSearch('')
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  // Close on scroll (dropdown is fixed so it'd detach from trigger)
  useEffect(() => {
    if (!open) return
    function onScroll() { setOpen(false); setSearch('') }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open])

  function handleToggle() {
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setDropdownPos({ top: r.bottom + 4, left: r.left })
    }
    setOpen(v => !v)
  }

  const selected = categories.find(c => c.id === value)
  const filtered = search
    ? categories.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    : categories

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    const res = await authFetch('/api/projects/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    })
    if (res.ok) {
      const cat: ProjectCategory = await res.json()
      onCategoryCreated(cat)
      onChange(cat.id)
      setNewName('')
      setAdding(false)
      setOpen(false)
    }
    setSaving(false)
  }

  const dropdown = open && dropdownPos ? createPortal(
    <div
      ref={dropdownRef}
      style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999 }}
      className="bg-white border border-slate-200 rounded-lg shadow-lg min-w-[180px] text-sm"
    >
      {categories.length > 0 && (
        <div className="px-2 py-1.5 border-b border-slate-100">
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.stopPropagation()}
            placeholder="Tìm category..."
            className="w-full px-2 py-1 text-xs border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-300"
          />
        </div>
      )}
      <div className="py-1">
        <button
          type="button"
          onClick={() => { onChange(null); setOpen(false); setSearch('') }}
          className={cn(
            'w-full text-left px-3 py-1.5 text-slate-400 hover:bg-slate-50 text-xs flex items-center gap-2',
            !value && 'bg-slate-50'
          )}
        >
          {!value && <Check size={12} />}
          <span className={value ? 'pl-4' : ''}>Không có</span>
        </button>

        {filtered.map(cat => (
          <button
            key={cat.id}
            type="button"
            onClick={() => { onChange(cat.id); setOpen(false); setSearch('') }}
            className={cn(
              'w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center gap-2',
              value === cat.id && 'bg-slate-50'
            )}
          >
            {value === cat.id ? <Check size={12} className="shrink-0" /> : <span className="w-3" />}
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color }} />
            <span className="text-slate-700 text-xs">{cat.name}</span>
          </button>
        ))}
      </div>

      {canManage && (
        <div className="border-t border-slate-100 mt-1 pt-1">
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-full text-left px-3 py-1.5 text-blue-600 hover:bg-blue-50 flex items-center gap-1.5 text-xs"
            >
              <Plus size={12} /> Thêm category
            </button>
          ) : (
            <div className="px-3 py-2 space-y-2">
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
                placeholder="Tên category..."
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-300"
              />
              <div className="flex gap-1 flex-wrap">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={cn('w-4 h-4 rounded-full transition-transform', newColor === c && 'ring-2 ring-offset-1 ring-slate-400 scale-110')}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setAdding(false)}
                  className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={saving || !newName.trim()}
                  className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '...' : 'Thêm'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  ) : null

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border border-transparent hover:border-slate-200 hover:bg-slate-50 transition-colors"
      >
        {selected ? (
          <>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selected.color }} />
            <span className="text-slate-700">{selected.name}</span>
          </>
        ) : (
          <span className="text-slate-400">— Chọn —</span>
        )}
        <ChevronDown size={11} className="text-slate-400" />
      </button>

      {dropdown}
    </div>
  )
}
