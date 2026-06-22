'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Pencil, Trash2, Search, UserCheck } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import ProjectFormDialog from '@/components/projects/ProjectFormDialog'
import { Project } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { useMasterProjectsContext } from '@/context/MasterProjectsContext'

interface UserRow { user_id: string; email: string; full_name: string; role: string }

export default function ProjectsPage() {
  const { projects, isLoading, addProject, updateProject, deleteProject, deleteProjects } = useProjects()
  const { role } = useAuth()
  const { masterProjects } = useMasterProjectsContext()
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; data?: Project } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const [employees, setEmployees] = useState<UserRow[]>([])
  const [employeesLoaded, setEmployeesLoaded] = useState(false)
  const [assigningProjectId, setAssigningProjectId] = useState<string | null>(null)
  const [projectAssignments, setProjectAssignments] = useState<Record<string, string[]>>({})
  const [assignmentLoading, setAssignmentLoading] = useState(false)

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

  async function loadEmployees() {
    if (employeesLoaded) return
    const res = await fetch('/api/admin/list-users')
    const data: UserRow[] = await res.json()
    setEmployees(Array.isArray(data) ? data.filter(u => u.role === 'employee') : [])
    setEmployeesLoaded(true)
  }

  async function openAssignPanel(projectId: string) {
    if (assigningProjectId === projectId) { setAssigningProjectId(null); return }
    setAssignmentLoading(true)
    await loadEmployees()
    if (projectAssignments[projectId] === undefined) {
      const { data } = await supabase.from('project_assignments').select('user_id').eq('project_id', projectId)
      setProjectAssignments(prev => ({ ...prev, [projectId]: (data ?? []).map((a: { user_id: string }) => a.user_id) }))
    }
    setAssigningProjectId(projectId)
    setAssignmentLoading(false)
  }

  async function toggleAssignment(projectId: string, userId: string, currentlyAssigned: boolean) {
    if (currentlyAssigned) {
      await supabase.from('project_assignments').delete().eq('project_id', projectId).eq('user_id', userId)
      setProjectAssignments(prev => ({ ...prev, [projectId]: prev[projectId].filter(uid => uid !== userId) }))
    } else {
      await supabase.from('project_assignments').insert({ project_id: projectId, user_id: userId })
      setProjectAssignments(prev => ({ ...prev, [projectId]: [...(prev[projectId] ?? []), userId] }))
    }
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
              {['Project ID', 'Tên dự án', 'CID', 'MCC', 'Tổng Dự Án', ''].map(h => (
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
                    {p.master_project_id ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium">
                        {masterProjects.find(m => m.id === p.master_project_id)?.name ?? p.master_project_id}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      {role === 'admin' && projectAssignments[p.project_id] !== undefined && (
                        <span className="text-xs text-slate-400 mr-1">
                          {projectAssignments[p.project_id].length} NV
                        </span>
                      )}
                      {role === 'admin' && (
                        <button
                          onClick={() => openAssignPanel(p.project_id)}
                          className={`p-1.5 rounded transition-colors ${
                            assigningProjectId === p.project_id
                              ? 'bg-blue-100 text-blue-600'
                              : 'hover:bg-slate-200 text-slate-500'
                          }`}
                          title="Phân công nhân viên"
                        >
                          <UserCheck size={13} />
                        </button>
                      )}
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

      {assigningProjectId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-800">Phân công nhân viên</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {projects.find(p => p.project_id === assigningProjectId)?.name}
                </p>
              </div>
              <button
                onClick={() => setAssigningProjectId(null)}
                className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
              >
                ✕
              </button>
            </div>
            {assignmentLoading ? (
              <div className="py-6 text-center text-sm text-slate-400">Đang tải...</div>
            ) : employees.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-400">Chưa có nhân viên nào trong hệ thống.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {employees.map(emp => {
                  const assigned = (projectAssignments[assigningProjectId] ?? []).includes(emp.user_id)
                  return (
                    <label
                      key={emp.user_id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${
                        assigned ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={assigned}
                        onChange={() => toggleAssignment(assigningProjectId, emp.user_id, assigned)}
                        className="accent-blue-600"
                      />
                      {emp.full_name || emp.email}
                    </label>
                  )
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={() => setAssigningProjectId(null)}>Xong</Button>
            </div>
          </div>
        </div>
      )}

      {dialog && (
        <ProjectFormDialog
          mode={dialog.mode}
          initialData={dialog.data}
          existingIds={projects.map(p => p.project_id)}
          masterProjects={masterProjects}
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
