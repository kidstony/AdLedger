'use client'

import React, { useState, useMemo } from 'react'
import { Plus, ChevronDown, ChevronRight, Pencil, Trash2, Check, X, Loader2 } from 'lucide-react'
import TableSkeleton from '@/components/ui/TableSkeleton'
import { useMasterProjectsContext } from '@/context/MasterProjectsContext'
import { useProjectsContext } from '@/context/ProjectsContext'
import { useAuth } from '@/context/AuthContext'
import { usePnlData } from '@/hooks/usePnlData'
import { Button } from '@/components/ui/button'
import { MasterProject, PnlSummary } from '@/lib/types'
import { formatVND, formatCid } from '@/lib/utils'
import DateRangePicker from '@/components/ui/DateRangePicker'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

function formatRoi(roi: number) {
  return `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`
}

// Gộp 3 chi phí (QC / Thuê TK / CP khác) → 1 số Tổng CP, hover xem tách chi tiết
function CostBreakdown({ spend, rental, other }: { spend: number; rental: number; other: number }) {
  const total = spend + rental + other
  if (total <= 0) return <span className="text-slate-300">—</span>
  return (
    <Tooltip>
      <TooltipTrigger className="border-b border-dotted border-slate-300 cursor-help">
        {formatVND(total)}
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-col gap-0.5 text-left min-w-[120px]">
          <div className="flex justify-between gap-4"><span>QC</span><span className="font-mono">{formatVND(spend)}</span></div>
          <div className="flex justify-between gap-4"><span>Thuê TK</span><span className="font-mono">{rental > 0 ? formatVND(rental) : '—'}</span></div>
          <div className="flex justify-between gap-4"><span>CP khác</span><span className="font-mono">{other > 0 ? formatVND(other) : '—'}</span></div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export default function MasterProjectsTab() {
  const { masterProjects, isLoading, addMasterProject, updateMasterProject, deleteMasterProject } = useMasterProjectsContext()
  const { projects, isLoading: projectsLoading } = useProjectsContext()
  const { role, user } = useAuth()
  const { data: summaries, dateRange, setDateRange } = usePnlData()

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [showInlineCreate, setShowInlineCreate] = useState(false)
  const [inlineName, setInlineName] = useState('')
  const [creating, setCreating] = useState(false)
  const [editTarget, setEditTarget] = useState<MasterProject | null>(null)
  const [editName, setEditName] = useState('')
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
      const pnlChildren = summaryByMaster.get(mp.id) ?? []
      const pnlIds = new Set(pnlChildren.map(c => c.project_id))
      const zeroPnlChildren: PnlSummary[] = projects
        .filter(p => p.master_project_id === mp.id && !pnlIds.has(p.project_id))
        .map(p => ({
          project_id: p.project_id,
          cid: p.cid ?? '',
          name: p.name,
          mcc_id: p.mcc_id ?? '',
          total_spend: 0,
          total_rental: 0,
          total_other: 0,
          total_revenue: 0,
          total_profit: 0,
          avg_roi: 0,
          total_screen_revenue: 0,
          screen_profit: 0,
          screen_roi: 0,
          total_pending: 0,
        }))
      const children = [...pnlChildren, ...zeroPnlChildren]
      const total_spend          = children.reduce((s, c) => s + c.total_spend, 0)
      const total_rental         = children.reduce((s, c) => s + (c.total_rental ?? 0), 0)
      const total_other          = children.reduce((s, c) => s + (c.total_other ?? 0), 0)
      const total_cost           = total_spend + total_rental + total_other
      const total_revenue        = children.reduce((s, c) => s + c.total_revenue, 0)
      const total_profit         = children.reduce((s, c) => s + c.total_profit, 0)
      const total_screen         = children.reduce((s, c) => s + (c.total_screen_revenue ?? 0), 0)
      const total_pending        = children.reduce((s, c) => s + (c.total_pending ?? 0), 0)
      const avg_roi              = total_cost > 0 ? (total_profit / total_cost) * 100 : 0
      return { ...mp, children, total_spend, total_rental, total_other, total_cost, total_revenue, total_profit, avg_roi, total_screen, total_pending }
    })
  , [masterProjects, summaryByMaster, projects])

  const visibleMasterRows = useMemo(
    () => {
      if (isLoading || projectsLoading) return []
      return masterRows
    },
    [masterRows, isLoading, projectsLoading]
  )

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleInlineCreate() {
    if (!inlineName.trim()) return
    setCreating(true)
    const slug = inlineName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const id = slug + '-' + Date.now().toString(36)
    await addMasterProject({ id, name: inlineName.trim(), description: null })
    setInlineName('')
    setShowInlineCreate(false)
    setCreating(false)
  }

  async function handleEditSave() {
    if (!editTarget || !editName.trim()) return
    await updateMasterProject({ ...editTarget, name: editName.trim() })
    setEditTarget(null)
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-slate-500">{visibleMasterRows.length} thương hiệu · Tổng hợp P&L theo nhóm</p>
        </div>
        {showInlineCreate ? (
          <div className="flex items-center gap-1">
            <input autoFocus value={inlineName} onChange={e => setInlineName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handleInlineCreate() }
                if (e.key === 'Escape') { setShowInlineCreate(false); setInlineName('') }
              }}
              placeholder="Tên thương hiệu..."
              className="border border-slate-200 rounded-md px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-slate-300 w-52" />
            <button onClick={handleInlineCreate} disabled={creating || !inlineName.trim()}
              className="p-1.5 rounded-md bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50">
              {creating ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            </button>
            <button onClick={() => { setShowInlineCreate(false); setInlineName('') }}
              className="p-1.5 rounded-md border border-slate-200 text-slate-400 hover:text-slate-600">
              <X size={13} />
            </button>
          </div>
        ) : (
          <Button onClick={() => setShowInlineCreate(true)} className="gap-1.5"><Plus size={14} /> Tạo Tổng Dự Án</Button>
        )}
      </div>

      <DateRangePicker
        from={dateRange.from.toISOString().split('T')[0]}
        to={dateRange.to.toISOString().split('T')[0]}
        onApply={(f, t) => setDateRange({ from: new Date(f + 'T00:00:00Z'), to: new Date(t + 'T00:00:00Z') })}
      />

      {/* Edit modal — tên thương hiệu only */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-4">Chỉnh sửa Tổng Dự Án</h3>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">Tên thương hiệu</label>
              <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleEditSave() }}
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300" />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setEditTarget(null)}>Hủy</Button>
              <Button onClick={handleEditSave}>Lưu</Button>
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
      {(isLoading || projectsLoading) ? <TableSkeleton rows={3} cols={10} /> : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Thương hiệu', 'Chiến dịch', 'Tổng CP', 'Doanh thu', 'DT màn hình', 'Lợi nhuận', 'ROI', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMasterRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-sm text-slate-400">
                    Chưa có Tổng Dự Án nào. Tạo mới và gán chiến dịch vào.
                  </td>
                </tr>
              )}
              {visibleMasterRows.map(row => {
                const expanded = expandedIds.has(row.id)
                const isProfit = row.total_profit >= 0
                return (
                  <React.Fragment key={row.id}>
                    <tr className={`border-b border-slate-100 font-medium cursor-pointer ${isProfit ? 'hover:bg-slate-50' : 'bg-red-50 hover:bg-red-100'}`}
                      onClick={() => toggleExpand(row.id)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {expanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                          <span className="text-slate-800">{row.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">{row.children.length} CID</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        <CostBreakdown spend={row.total_spend} rental={row.total_rental} other={row.total_other} />
                      </td>
                      <td className="px-4 py-3 text-slate-700">{formatVND(row.total_revenue)}</td>
                      <td className={`px-4 py-3 ${row.total_pending > 0 ? 'text-amber-500' : 'text-slate-300'}`}>
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
                          {(role !== 'member' || row.created_by === user?.id) && (
                            <>
                              <button onClick={() => { setEditTarget(row); setEditName(row.name) }}
                                className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors"><Pencil size={13} /></button>
                              <button onClick={() => setConfirmDelete(row)}
                                className="p-1.5 rounded hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors"><Trash2 size={13} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {expanded && row.children.map(child => {
                      const childProfit = child.total_profit >= 0
                      return (
                        <tr key={child.project_id} className={`border-b border-slate-50 text-xs ${childProfit ? 'bg-slate-50/50' : 'bg-red-50/50'}`}>
                          <td className="px-4 py-2.5 pl-10 text-slate-600">{child.name}</td>
                          <td className="px-4 py-2.5 font-mono text-slate-400">{formatCid(child.cid)}</td>
                          <td className="px-4 py-2.5 text-slate-500">
                            <CostBreakdown spend={child.total_spend} rental={child.total_rental ?? 0} other={child.total_other ?? 0} />
                          </td>
                          <td className="px-4 py-2.5 text-slate-500">{formatVND(child.total_revenue)}</td>
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
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
