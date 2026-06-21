'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import ProjectFormDialog from '@/components/projects/ProjectFormDialog'
import { Project } from '@/lib/types'
import { Button } from '@/components/ui/button'

export default function ProjectsPage() {
  const { projects, isLoading, addProject, updateProject, deleteProject, deleteProjects } = useProjects()
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; data?: Project } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.project_id.includes(search) ||
    p.cid.includes(search)
  )

  // Clear selection when filter changes
  useEffect(() => {
    setSelectedIds(new Set())
  }, [search])

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.project_id))
  const someSelected = filtered.some(p => selectedIds.has(p.project_id))
  const selectedCount = [...selectedIds].filter(id => filtered.some(p => p.project_id === id)).length

  // Sync indeterminate state on header checkbox
  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected && !allFilteredSelected
    }
  }, [someSelected, allFilteredSelected])

  function toggleAll() {
    if (allFilteredSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filtered.forEach(p => next.delete(p.project_id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        filtered.forEach(p => next.add(p.project_id))
        return next
      })
    }
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  function handleBulkDelete() {
    deleteProjects([...selectedIds])
    setSelectedIds(new Set())
    setConfirmBulkDelete(false)
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Quản lý dự án</h2>
          <p className="text-sm text-slate-500 mt-0.5">{projects.length} dự án · Thêm/sửa/xóa mapping CID</p>
        </div>
        <Button onClick={() => setDialog({ mode: 'add' })} className="gap-1.5">
          <Plus size={14} /> Thêm dự án
        </Button>
      </div>

      <div className="relative w-64">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          placeholder="Tìm theo tên, ID, CID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-8 pr-3 py-1.5 w-full text-sm border border-slate-200 rounded-md bg-white outline-none focus:ring-2 focus:ring-slate-300"
        />
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800 rounded-lg text-white text-sm">
          <span className="font-medium">{selectedCount} dự án đã chọn</span>
          <button
            onClick={clearSelection}
            className="text-slate-400 hover:text-white text-xs underline underline-offset-2"
          >
            Bỏ chọn
          </button>
          <div className="flex-1" />
          <button
            onClick={() => setConfirmBulkDelete(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-md text-white text-xs font-medium transition-colors"
          >
            <Trash2 size={13} /> Xóa {selectedCount} dự án
          </button>
        </div>
      )}

      {isLoading && (
        <div className="border border-slate-200 rounded-lg">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-slate-100">
              <div className="w-4 h-4 rounded bg-slate-200 animate-pulse" />
              <div className="w-20 h-3 rounded bg-slate-200 animate-pulse" />
              <div className="w-40 h-3 rounded bg-slate-200 animate-pulse" />
              <div className="w-28 h-3 rounded bg-slate-200 animate-pulse" />
            </div>
          ))}
        </div>
      )}

      {!isLoading && (
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  ref={headerCheckboxRef}
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={toggleAll}
                  className="rounded border-slate-300 cursor-pointer accent-slate-700"
                  title="Chọn tất cả"
                />
              </th>
              {['Project ID', 'Tên dự án', 'CID', 'MCC', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const isSelected = selectedIds.has(p.project_id)
              return (
                <tr
                  key={p.project_id}
                  className={`border-b border-slate-100 transition-colors ${isSelected ? 'bg-slate-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(p.project_id)}
                      className="rounded border-slate-300 cursor-pointer accent-slate-700"
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.project_id}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">{p.cid}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{p.mcc_id}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => setDialog({ mode: 'edit', data: p })}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(p)}
                        className="p-1.5 rounded hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-500">Không tìm thấy dự án.</div>
        )}
      </div>
      )}

      {dialog && (
        <ProjectFormDialog
          mode={dialog.mode}
          initialData={dialog.data}
          existingIds={projects.map(p => p.project_id)}
          onSave={dialog.mode === 'add' ? addProject : updateProject}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Single delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa dự án?</h3>
            <p className="text-sm text-slate-600 mb-5">
              Bạn chắc chắn muốn xóa <strong>{confirmDelete.name}</strong>? Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Hủy</Button>
              <Button
                variant="destructive"
                onClick={() => { deleteProject(confirmDelete.project_id); setConfirmDelete(null) }}
              >
                Xóa
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk delete confirm */}
      {confirmBulkDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa {selectedCount} dự án?</h3>
            <p className="text-sm text-slate-600 mb-5">
              Bạn chắc chắn muốn xóa <strong>{selectedCount} dự án</strong> đã chọn? Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmBulkDelete(false)}>Hủy</Button>
              <Button variant="destructive" onClick={handleBulkDelete}>
                Xóa {selectedCount} dự án
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
