'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Check, X, FolderOpen } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { ProjectCategory } from '@/lib/types'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/ui/PageHeader'

const COLOR_PRESETS = [
  '#ef4444','#f97316','#eab308','#22c55e',
  '#3b82f6','#8b5cf6','#ec4899','#6b7280',
  '#14b8a6','#f43f5e','#0ea5e9','#a3e635',
]

async function authFetch(url: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, {
    ...opts,
    headers: { ...opts?.headers, 'Authorization': `Bearer ${session?.access_token ?? ''}` },
  })
}

interface CategoryWithCount extends ProjectCategory {
  project_count?: number
}

export default function AdminCategoriesPage() {
  const { role } = useAuth()
  const router = useRouter()
  const [categories, setCategories] = useState<CategoryWithCount[]>([])
  const [projectCounts, setProjectCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<CategoryWithCount | null>(null)

  // New category form
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3b82f6')
  const [addSaving, setAddSaving] = useState(false)

  // Guard: admin/manager only
  useEffect(() => {
    if (role && role !== 'super_admin' && role !== 'manager') {
      router.push('/projects')
    }
  }, [role, router])

  useEffect(() => {
    loadCategories()
  }, [])

  async function loadCategories() {
    setLoading(true)
    const res = await authFetch('/api/projects/categories')
    const data: ProjectCategory[] = await res.json()
    setCategories(Array.isArray(data) ? data : [])

    // Load project counts
    if (Array.isArray(data) && data.length > 0) {
      const ids = data.map(c => c.id)
      const { data: projects } = await supabase
        .from('projects')
        .select('category_id')
        .in('category_id', ids)
      const counts = new Map<string, number>()
      ;(projects ?? []).forEach((p: { category_id: string | null }) => {
        if (p.category_id) counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1)
      })
      setProjectCounts(counts)
    }
    setLoading(false)
  }

  async function handleAdd() {
    if (!newName.trim()) return
    setAddSaving(true)
    const res = await authFetch('/api/projects/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), color: newColor }),
    })
    if (res.ok) {
      const created = await res.json()
      setCategories(prev => [...prev, created])
      setNewName(''); setShowAdd(false)
      toast.success('Đã thêm category')
    } else {
      const err = await res.json()
      toast.error(err.error ?? 'Lỗi thêm category')
    }
    setAddSaving(false)
  }

  function startEdit(cat: CategoryWithCount) {
    setEditId(cat.id); setEditName(cat.name); setEditColor(cat.color)
  }

  async function handleSaveEdit() {
    if (!editId || !editName.trim()) return
    setSaving(true)
    const res = await authFetch('/api/projects/categories', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editId, name: editName.trim(), color: editColor }),
    })
    if (res.ok) {
      const updated = await res.json()
      setCategories(prev => prev.map(c => c.id === editId ? { ...updated, project_count: projectCounts.get(editId) } : c))
      setEditId(null)
      toast.success('Đã cập nhật category')
    } else {
      toast.error('Không thể cập nhật')
    }
    setSaving(false)
  }

  async function handleDelete(cat: CategoryWithCount) {
    const res = await authFetch('/api/projects/categories', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cat.id }),
    })
    if (res.ok) {
      setCategories(prev => prev.filter(c => c.id !== cat.id))
      setConfirmDelete(null)
      toast.success('Đã xóa category')
    } else {
      toast.error('Không thể xóa — category có thể đang được dùng')
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      {/* Header */}
      <PageHeader
        title="Quản lý Category"
        subtitle="Phân loại dự án Affiliate"
        actions={
          <Button onClick={() => { setShowAdd(true); setNewName(''); setNewColor('#3b82f6') }} className="gap-1.5">
            <Plus size={14} /> Thêm category
          </Button>
        }
      />

      {/* Add form */}
      {showAdd && (
        <div className="border border-blue-200 bg-blue-50 rounded-lg p-4 space-y-3">
          <p className="text-sm font-medium text-slate-700">Category mới</p>
          <div className="flex gap-3">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setShowAdd(false) }}
              placeholder="Tên category (vd: Nutra, Finance, Game...)"
              className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-blue-300 bg-white"
            />
            <div
              className="w-8 h-8 rounded-md border-2 border-white shadow-md shrink-0 cursor-default"
              style={{ backgroundColor: newColor }}
              title="Màu được chọn"
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {COLOR_PRESETS.map(c => (
              <button key={c} type="button" onClick={() => setNewColor(c)}
                className={cn('w-6 h-6 rounded-full transition-transform hover:scale-110', newColor === c && 'ring-2 ring-offset-2 ring-slate-500 scale-110')}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm border border-slate-200 rounded-md hover:bg-slate-100 transition-colors">Hủy</button>
            <Button onClick={handleAdd} disabled={addSaving || !newName.trim()} size="sm">
              {addSaving ? 'Đang thêm...' : 'Thêm'}
            </Button>
          </div>
        </div>
      )}

      {/* Category list */}
      {loading ? (
        <div className="text-sm text-slate-400 py-6 text-center">Đang tải...</div>
      ) : categories.length === 0 ? (
        <div className="border-2 border-dashed border-slate-200 rounded-lg py-12 text-center">
          <FolderOpen size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-400">Chưa có category nào</p>
          <p className="text-xs text-slate-400 mt-1">Thêm category để phân loại dự án</p>
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide w-8">Màu</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Tên Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Số Dự Án</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">Ngày tạo</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {categories.map(cat => (
                <tr key={cat.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <span className="w-4 h-4 rounded-full block" style={{ backgroundColor: cat.color }} />
                  </td>
                  <td className="px-4 py-3">
                    {editId === cat.id ? (
                      <div className="space-y-2">
                        <input
                          autoFocus
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditId(null) }}
                          className="px-2 py-1 text-xs border border-blue-300 rounded-md outline-none focus:ring-1 focus:ring-blue-400 w-full"
                        />
                        <div className="flex gap-1.5 flex-wrap">
                          {COLOR_PRESETS.map(c => (
                            <button key={c} type="button" onClick={() => setEditColor(c)}
                              className={cn('w-4 h-4 rounded-full transition-transform hover:scale-110', editColor === c && 'ring-2 ring-offset-1 ring-slate-500')}
                              style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: cat.color + '20', color: cat.color }}>
                          {cat.name}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-xs px-2 py-0.5 rounded-full font-medium',
                      (projectCounts.get(cat.id) ?? 0) > 0
                        ? 'bg-indigo-50 text-indigo-600'
                        : 'text-slate-400'
                    )}>
                      {projectCounts.get(cat.id) ?? 0} dự án
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {cat.created_at ? new Date(cat.created_at).toLocaleDateString('vi-VN') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {editId === cat.id ? (
                        <>
                          <button onClick={handleSaveEdit} disabled={saving}
                            className="p-1.5 rounded hover:bg-green-100 text-green-600 transition-colors disabled:opacity-50">
                            <Check size={13} />
                          </button>
                          <button onClick={() => setEditId(null)}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-400 transition-colors">
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(cat)}
                            className="p-1.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => setConfirmDelete(cat)}
                            className="p-1.5 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa category?</h3>
            <p className="text-sm text-slate-600 mb-2">
              Bạn chắc chắn muốn xóa <strong style={{ color: confirmDelete.color }}>{confirmDelete.name}</strong>?
            </p>
            {(projectCounts.get(confirmDelete.id) ?? 0) > 0 && (
              <p className="text-sm text-amber-600 mb-3 flex items-center gap-1.5">
                ⚠️ Category này đang được dùng bởi <strong>{projectCounts.get(confirmDelete.id)} dự án</strong>.
                Xóa sẽ gỡ category khỏi các dự án đó.
              </p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Hủy</Button>
              <Button variant="destructive" onClick={() => handleDelete(confirmDelete)}>Xóa</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
