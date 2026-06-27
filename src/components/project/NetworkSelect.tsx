'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Check, Search, X, Plus, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AffiliateNetwork } from '@/lib/types'

const COLOR_PRESETS = [
  '#ef4444','#f97316','#eab308','#22c55e',
  '#3b82f6','#8b5cf6','#ec4899','#6b7280',
]

interface NetworkSelectProps {
  value: string | null
  networks: AffiliateNetwork[]
  canManage: boolean
  disabled?: boolean
  onChange: (name: string | null) => void
  onNetworkCreated: (n: AffiliateNetwork) => void
  onNetworkUpdated: (n: AffiliateNetwork) => void
  onNetworkDeleted: (id: string) => void
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
}

export default function NetworkSelect({
  value, networks, canManage, disabled,
  onChange, onNetworkCreated, onNetworkUpdated, onNetworkDeleted, authFetch,
}: NetworkSelectProps) {
  const [open, setOpen] = useState(false)
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null)
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(COLOR_PRESETS[4])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [saving, setSaving] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t) || dropdownRef.current?.contains(t)) return
      closeDropdown()
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onScroll() { closeDropdown() }
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [open])

  function closeDropdown() {
    setOpen(false)
    setSearch('')
    setAdding(false)
    setNewName('')
    setEditingId(null)
  }

  function handleToggle() {
    if (disabled) return
    if (!open && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setDropdownPos({ top: r.bottom + 4, left: r.left })
    }
    if (open) closeDropdown()
    else setOpen(true)
  }

  function select(name: string | null) {
    onChange(name)
    closeDropdown()
  }

  async function handleAdd() {
    if (!newName.trim() || saving) return
    setSaving(true)
    const res = await authFetch('/api/projects/networks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    })
    if (res.ok) {
      const n: AffiliateNetwork = await res.json()
      onNetworkCreated(n)
      onChange(n.name)
      closeDropdown()
    }
    setSaving(false)
  }

  async function handleUpdate(id: string) {
    if (!editName.trim() || saving) return
    setSaving(true)
    const res = await authFetch('/api/projects/networks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: editName.trim(), color: editColor }),
    })
    if (res.ok) {
      const n: AffiliateNetwork = await res.json()
      onNetworkUpdated(n)
      if (value?.toLowerCase() === networks.find(x => x.id === id)?.name.toLowerCase()) {
        onChange(n.name)
      }
    }
    setEditingId(null)
    setSaving(false)
  }

  async function handleDelete(n: AffiliateNetwork, e: React.MouseEvent) {
    e.stopPropagation()
    const res = await authFetch('/api/projects/networks', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: n.id }),
    })
    if (res.ok) {
      onNetworkDeleted(n.id)
      if (value?.toLowerCase() === n.name.toLowerCase()) onChange(null)
    }
  }

  const filtered = networks.filter(n =>
    n.name.toLowerCase().includes(search.toLowerCase())
  )
  const selected = networks.find(n => n.name.toLowerCase() === (value ?? '').toLowerCase())

  const dropdown = open && dropdownPos ? createPortal(
    <div
      ref={dropdownRef}
      style={{ position: 'fixed', top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999 }}
      className="bg-white border border-slate-200 rounded-lg shadow-lg w-64 overflow-hidden"
    >
      {/* Search */}
      <div className="px-2 py-1.5 border-b border-slate-100 flex items-center gap-1.5">
        <Search size={11} className="text-slate-400 shrink-0" />
        <input
          autoFocus={!editingId && !adding}
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') closeDropdown() }}
          placeholder="Tìm affiliate network..."
          className="flex-1 text-xs outline-none bg-transparent text-slate-700 placeholder:text-slate-400"
        />
      </div>

      {/* Network list */}
      <div className="py-1 max-h-52 overflow-y-auto">
        {filtered.map(n => (
          <div key={n.id}>
            {editingId === n.id ? (
              /* Inline edit form */
              <div className="px-3 py-2 space-y-2 bg-slate-50">
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => {
                    e.stopPropagation()
                    if (e.key === 'Enter') handleUpdate(n.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="w-full px-2 py-1 text-xs border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-300"
                />
                <div className="flex gap-1 flex-wrap">
                  {COLOR_PRESETS.map(c => (
                    <button key={c} type="button" onClick={() => setEditColor(c)}
                      className={cn('w-4 h-4 rounded-full transition-transform', editColor === c && 'ring-2 ring-offset-1 ring-slate-400 scale-110')}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setEditingId(null)}
                    className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-100">Hủy</button>
                  <button type="button" onClick={() => handleUpdate(n.id)} disabled={saving || !editName.trim()}
                    className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                    {saving ? '...' : 'Lưu'}
                  </button>
                </div>
              </div>
            ) : (
              /* Normal row */
              <div className="group flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
                onClick={() => select(n.name)}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: n.color }} />
                <span className="text-xs text-slate-700 flex-1 truncate">{n.name}</span>
                {value?.toLowerCase() === n.name.toLowerCase() && <Check size={11} className="text-blue-600 shrink-0" />}
                {canManage && (
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 ml-1">
                    <button type="button"
                      onClick={e => { e.stopPropagation(); setEditingId(n.id); setEditName(n.name); setEditColor(n.color) }}
                      className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700">
                      <Pencil size={10} />
                    </button>
                    <button type="button" onClick={e => handleDelete(n, e)}
                      className="p-0.5 rounded hover:bg-red-100 text-slate-400 hover:text-red-600">
                      <Trash2 size={10} />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {filtered.length === 0 && !adding && (
          <p className="px-3 py-2 text-xs text-slate-400 italic">Chưa có network nào</p>
        )}
      </div>

      {/* Add new */}
      {canManage && (
        <div className="border-t border-slate-100">
          {!adding ? (
            <button type="button" onClick={() => { setAdding(true); setSearch('') }}
              className="w-full text-left px-3 py-1.5 text-blue-600 hover:bg-blue-50 flex items-center gap-1.5 text-xs">
              <Plus size={11} /> Thêm network
            </button>
          ) : (
            <div className="px-3 py-2 space-y-2">
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false) }}
                placeholder="Tên network..."
                className="w-full px-2 py-1 text-xs border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-300" />
              <div className="flex gap-1 flex-wrap">
                {COLOR_PRESETS.map(c => (
                  <button key={c} type="button" onClick={() => setNewColor(c)}
                    className={cn('w-4 h-4 rounded-full transition-transform', newColor === c && 'ring-2 ring-offset-1 ring-slate-400 scale-110')}
                    style={{ backgroundColor: c }} />
                ))}
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => setAdding(false)}
                  className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded hover:bg-slate-50">Hủy</button>
                <button type="button" onClick={handleAdd} disabled={saving || !newName.trim()}
                  className="flex-1 px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
                  {saving ? '...' : 'Thêm'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Clear */}
      {value && (
        <div className={cn('border-t border-slate-100', canManage ? '' : '')}>
          <button type="button" onClick={() => select(null)}
            className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 text-left">
            <X size={11} className="text-slate-400" />
            <span className="text-xs text-slate-400">Xóa lựa chọn</span>
          </button>
        </div>
      )}
    </div>,
    document.body
  ) : null

  return (
    <div className="relative">
      <button ref={triggerRef} type="button" onClick={handleToggle} disabled={disabled}
        className={cn('flex items-center gap-1.5 px-1.5 py-0.5 rounded-md text-left transition-colors',
          disabled ? 'cursor-default' : 'hover:bg-slate-100 cursor-pointer')}>
        {selected ? (
          <>
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selected.color }} />
            <span className="text-xs text-slate-700 max-w-[100px] truncate">{selected.name}</span>
          </>
        ) : value ? (
          /* Has value but not found in networks list */
          <span className="text-xs text-slate-500 max-w-[100px] truncate">{value}</span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </button>
      {dropdown}
    </div>
  )
}
