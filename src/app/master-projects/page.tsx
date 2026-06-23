'use client'

import { useState, useMemo } from 'react'
import { Plus, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { useMasterProjectsContext } from '@/context/MasterProjectsContext'
import { useProjectsContext } from '@/context/ProjectsContext'
import { usePnlData } from '@/hooks/usePnlData'
import { Button } from '@/components/ui/button'
import { MasterProject } from '@/lib/types'
import { formatVND, formatCid } from '@/lib/utils'
import DateRangePicker from '@/components/ui/DateRangePicker'

function formatRoi(roi: number) {
  return `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`
}

export default function MasterProjectsPage() {
  const { masterProjects, isLoading, addMasterProject, updateMasterProject, deleteMasterProject } = useMasterProjectsContext()
  const { projects } = useProjectsContext()
  const { data: summaries, dateRange, setDateRange } = usePnlData()

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showForm, setShowForm] = useState(false)
  const [editTarget, setEditTarget] = useState<MasterProject | null>(null)
  const [formData, setFormData] = useState({ id: '', name: '', description: '' })
  const [confirmDelete, setConfirmDelete] = useState<MasterProject | null>(null)

  // Map project_id → master_project_id
  const projectMasterMap = useMemo(
    () => new Map(projects.map(p => [p.project_id, p.master_project_id ?? null])),
    [projects]
  )

  // Group PnL summaries by master_project_id
  const summaryByMaster = useMemo(() => {
    const groups = new Map<string, typeof summaries>()
    summaries.forEach(s => {
      const masterId = projectMasterMap.get(s.project_id)
      if (!masterId) return
      if (!groups.has(masterId)) groups.set(masterId, [])
      groups.get(masterId)!.push(s)
    })
    return groups
  }, [summaries, projectMasterMap])

  // Aggregate per master project
  const masterRows = useMemo(() =>
    masterProjects.map(mp => {
      const children = summaryByMaster.get(mp.id) ?? []
      const total_spend          = children.reduce((s, c) => s + c.total_spend, 0)
      const total_rental         = children.reduce((s, c) => s + (c.total_rental ?? 0), 0)
      const total_other          = children.reduce((s, c) => s + (c.total_other ?? 0), 0)
      const total_cost           = total_spend + total_rental + total_other
      const total_revenue        = children.reduce((s, c) => s + c.total_revenue, 0)
      const total_profit         = children.reduce((s, c) => s + c.total_profit, 0)
      const total_screen         = children.reduce((s, c) => s + (c.total_screen_revenue ?? 0), 0)
      const total_pending        = total_screen - total_revenue
      const avg_roi              = total_cost > 0 ? (total_profit / total_cost) * 100 : 0
      return { ...mp, children, total_spend, total_rental, total_other, total_cost, total_revenue, total_profit, avg_roi, total_screen, total_pending }
    })
  , [masterProjects, summaryByMaster])

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function openAdd() {
    setFormData({ id: '', name: '', description: '' })
    setEditTarget(null)
    setShowForm(true)
  }

  function openEdit(mp: MasterProject) {
    setFormData({ id: mp.id, name: mp.name, description: mp.description ?? '' })
    setEditTarget(mp)
    setShowForm(true)
  }

  async function handleSave() {
    if (!formData.name.trim() || !formData.id.trim()) return
    if (editTarget) {
      await updateMasterProject({ ...editTarget, name: formData.name, description: formData.description || null })
    } else {
      await addMasterProject({ id: formData.id.toLowerCase().replace(/\s+/g, '-'), name: formData.name, description: formData.description || null })
    }
    setShowForm(false)
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Tổng Dự Án</h2>
          <p className="text-sm text-slate-500 mt-0.5">{masterProjects.length} thương hiệu · Tổng hợp P&L theo nhóm</p>
        </div>
        <Button onClick={openAdd} className="gap-1.5"><Plus size={14} /> Tạo Tổng Dự Án</Button>
      </div>

      <DateRangePicker
        from={dateRange.from.toISOString().split('T')[0]}
        to={dateRange.to.toISOString().split('T')[0]}
        onApply={(f, t) => setDateRange({ from: new Date(f + 'T00:00:00Z'), to: new Date(t + 'T00:00:00Z') })}
      />

      {/* Create/Edit modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-4">
              {editTarget ? 'Chỉnh sửa Tổng Dự Án' : 'Tạo Tổng Dự Án mới'}
            </h3>
            <div className="space-y-3">
              {!editTarget && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">ID (slug)</label>
                  <input value={formData.id} onChange={e => setFormData(f => ({ ...f, id: e.target.value }))}
                    placeholder="fitcamx" className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300" />
                  <p className="text-xs text-slate-400 mt-0.5">Chữ thường, không dấu, dùng dấu gạch ngang</p>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Tên thương hiệu</label>
                <input value={formData.name} onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                  placeholder="Fitcamx.com" className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mô tả (tuỳ chọn)</label>
                <input value={formData.description} onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                  placeholder="Camera hành trình..." className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowForm(false)}>Hủy</Button>
              <Button onClick={handleSave}>Lưu</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa Tổng Dự Án?</h3>
            <p className="text-sm text-slate-600 mb-5">
              <strong>{confirmDelete.name}</strong> sẽ bị xóa. Các dự án con sẽ không bị xóa nhưng sẽ không còn thuộc nhóm này nữa.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Hủy</Button>
              <Button variant="destructive" onClick={() => { deleteMasterProject(confirmDelete.id); setConfirmDelete(null) }}>Xóa</Button>
            </div>
          </div>
        </div>
      )}

      {/* Main table */}
      {isLoading ? (
        <div className="border border-slate-200 rounded-lg">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 border-b border-slate-100">
              <div className="w-32 h-3 rounded bg-slate-200 animate-pulse" />
              <div className="w-20 h-3 rounded bg-slate-200 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Thương hiệu', 'Chiến dịch', 'Chi phí QC', 'Thuê TK', 'CP Khác', 'Doanh thu', 'Màn hình', 'Chờ TT', 'Lợi nhuận', 'ROI', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {masterRows.length === 0 && (
                <tr>
                  <td colSpan={11} className="py-10 text-center text-sm text-slate-400">
                    Chưa có Tổng Dự Án nào. Tạo mới và gán chiến dịch vào.
                  </td>
                </tr>
              )}
              {masterRows.map(row => {
                const expanded = expandedIds.has(row.id)
                const isProfit = row.total_profit >= 0
                return (
                  <>
                    {/* Parent row */}
                    <tr key={row.id} className={`border-b border-slate-100 font-medium cursor-pointer ${isProfit ? 'hover:bg-slate-50' : 'bg-red-50 hover:bg-red-100'}`}
                      onClick={() => toggleExpand(row.id)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {expanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                          <span className="text-slate-800">{row.name}</span>
                          {row.description && <span className="text-xs text-slate-400 font-normal">{row.description}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">{row.children.length} CID</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{formatVND(row.total_spend)}</td>
                      <td className="px-4 py-3 text-slate-500">{row.total_rental > 0 ? formatVND(row.total_rental) : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 text-slate-500">{row.total_other > 0 ? formatVND(row.total_other) : <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3 text-slate-700">{formatVND(row.total_revenue)}</td>
                      <td className="px-4 py-3 text-blue-600">{row.total_screen > 0 ? formatVND(row.total_screen) : <span className="text-slate-300">—</span>}</td>
                      <td className={`px-4 py-3 ${row.total_pending > 0 ? 'text-amber-600' : 'text-slate-300'}`}>
                        {row.total_pending > 0 ? formatVND(row.total_pending) : '—'}
                      </td>
                      <td className={`px-4 py-3 font-semibold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                        {isProfit ? '+' : ''}{formatVND(row.total_profit)}
                      </td>
                      <td className={`px-4 py-3 font-semibold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                        {formatRoi(row.avg_roi)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                          <button onClick={() => openEdit(row)} className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors"><Pencil size={13} /></button>
                          <button onClick={() => setConfirmDelete(row)} className="p-1.5 rounded hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors"><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>

                    {/* Child rows */}
                    {expanded && row.children.map(child => {
                      const childProfit = child.total_profit >= 0
                      return (
                        <tr key={child.project_id} className={`border-b border-slate-50 text-xs ${childProfit ? 'bg-slate-50/50' : 'bg-red-50/50'}`}>
                          <td className="px-4 py-2.5 pl-10 text-slate-600">{child.name}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-400">{formatCid(child.cid)}</td>
                          <td className="px-4 py-2.5 text-slate-500">{formatVND(child.total_spend)}</td>
                          <td className="px-4 py-2.5 text-slate-400">
                            {(child.total_rental ?? 0) > 0 ? formatVND(child.total_rental) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-400">
                            {(child.total_other ?? 0) > 0 ? formatVND(child.total_other) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{formatVND(child.total_revenue)}</td>
                          <td className="px-4 py-2.5 text-blue-500">
                            {(child.total_screen_revenue ?? 0) > 0 ? formatVND(child.total_screen_revenue) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className={`px-4 py-2.5 ${(child.total_pending ?? 0) > 0 ? 'text-amber-500' : 'text-slate-300'}`}>
                            {(child.total_pending ?? 0) > 0 ? formatVND(child.total_pending) : '—'}
                          </td>
                          <td className={`px-4 py-2.5 ${childProfit ? 'text-green-600' : 'text-red-600'}`}>
                            {childProfit ? '+' : ''}{formatVND(child.total_profit)}
                          </td>
                          <td className={`px-4 py-2.5 ${childProfit ? 'text-green-600' : 'text-red-600'}`}>
                            {formatRoi(child.avg_roi)}
                          </td>
                          <td />
                        </tr>
                      )
                    })}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
