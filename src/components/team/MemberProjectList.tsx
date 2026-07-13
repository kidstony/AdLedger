'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, Trash2, ChevronDown } from 'lucide-react'
import { ShareAccessLevel, SharePermissions } from '@/lib/types'
import { cn } from '@/lib/utils'
import CellPermissionPopover from './CellPermissionPopover'
import { useConfirm } from '@/components/ui/ConfirmDialog'

export type MatrixMember  = { user_id: string; full_name: string; email: string; role: string }
export type MatrixProject = { project_id: string; name: string }
export type MatrixShare   = {
  user_id: string; project_id: string; share_id: string
  access_level: ShareAccessLevel; effective_permissions: SharePermissions
}

type FilterKey = 'all' | 'granted' | 'none' | ShareAccessLevel

const LEVEL_META: Record<ShareAccessLevel, { icon: string; label: string; cls: string }> = {
  viewer:   { icon: '👁',  label: 'Viewer',   cls: 'bg-gray-100 text-gray-700 border-gray-200' },
  reporter: { icon: '📊', label: 'Reporter', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  editor:   { icon: '✏️', label: 'Editor',   cls: 'bg-green-50 text-green-700 border-green-200' },
}

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'all',      label: 'Tất cả' },
  { key: 'granted',  label: 'Có quyền' },
  { key: 'none',     label: 'Chưa có quyền' },
  { key: 'editor',   label: '✏️ Editor' },
  { key: 'reporter', label: '📊 Reporter' },
  { key: 'viewer',   label: '👁 Viewer' },
]

interface Props {
  member: MatrixMember
  projects: MatrixProject[]
  memberShares: MatrixShare[]   // shares only for this member
  getToken: () => Promise<string>
  onRefresh: () => void
}

interface PopoverState {
  projectId: string; shareId?: string
  access_level?: ShareAccessLevel; effective_permissions?: SharePermissions
}

export default function MemberProjectList({ member, projects, memberShares, getToken, onRefresh }: Props) {
  const confirmDlg = useConfirm()
  const [search, setSearch]             = useState('')
  const [filter, setFilter]             = useState<FilterKey>('all')
  const [filterOpen, setFilterOpen]     = useState(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkLevelOpen, setBulkLevelOpen] = useState(false)
  const [saving, setSaving]             = useState(false)
  const [revoking, setRevoking]         = useState(false)
  const [popover, setPopover]           = useState<PopoverState | null>(null)
  const headerRef = useRef<HTMLInputElement>(null)

  // Reset selection on member change
  useEffect(() => { setSelectedIds(new Set()); setSearch(''); setFilter('all') }, [member.user_id])

  const shareMap = useMemo(
    () => new Map(memberShares.map(s => [s.project_id, s])),
    [memberShares]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return projects.filter(p => {
      const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.project_id.toLowerCase().includes(q)
      const share = shareMap.get(p.project_id)
      const matchesFilter =
        filter === 'all' ? true
        : filter === 'granted' ? !!share
        : filter === 'none' ? !share
        : share?.access_level === filter
      return matchesSearch && matchesFilter
    })
  }, [projects, shareMap, search, filter])

  const allSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.project_id))
  const someSelected = filtered.some(p => selectedIds.has(p.project_id))
  const selectedCount = [...selectedIds].filter(id => filtered.some(p => p.project_id === id)).length

  // Sync indeterminate state
  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = someSelected && !allSelected
  }, [someSelected, allSelected])

  function toggleAll() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allSelected) filtered.forEach(p => next.delete(p.project_id))
      else filtered.forEach(p => next.add(p.project_id))
      return next
    })
  }
  function toggleOne(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Selected shares (only for rows that have access)
  const selectedWithAccess = [...selectedIds]
    .map(pid => shareMap.get(pid))
    .filter(Boolean) as MatrixShare[]
  const allSelectedHaveAccess = selectedCount > 0 && selectedCount === selectedWithAccess.length

  async function bulkAssign(level: ShareAccessLevel) {
    const ids = [...selectedIds]
    if (!ids.length) return
    setSaving(true)
    setBulkLevelOpen(false)
    const token = await getToken()
    await Promise.all(ids.map(pid =>
      fetch(`/api/projects/${pid}/shares`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ids: [member.user_id], access_level: level }),
      })
    ))
    setSaving(false)
    setSelectedIds(new Set())
    onRefresh()
  }

  async function bulkRevoke() {
    if (!selectedWithAccess.length) return
    const names = selectedWithAccess.map(s => shareMap.get(s.project_id)?.project_id ?? s.project_id).join(', ')
    if (!(await confirmDlg({ title: `Thu hồi quyền của ${member.full_name} khỏi ${selectedWithAccess.length} dự án?`, description: names, confirmLabel: 'Thu hồi' }))) return
    setRevoking(true)
    const token = await getToken()
    await Promise.all(selectedWithAccess.map(s =>
      fetch(`/api/projects/${s.project_id}/shares/${s.share_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    ))
    setRevoking(false)
    setSelectedIds(new Set())
    onRefresh()
  }

  const grantedCount = memberShares.length

  return (
    <div className="flex flex-col h-full">
      {/* Panel header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-baseline gap-2">
          <p className="font-semibold text-slate-800">{member.full_name}</p>
          {member.email && <p className="text-xs text-slate-400">{member.email}</p>}
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          <span className="font-semibold text-slate-700">{grantedCount}</span>/{projects.length} dự án có quyền
        </p>
      </div>

      {/* Toolbar */}
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm dự án..."
            className="w-full pl-7 pr-3 py-1.5 text-xs border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-blue-300 bg-white"
          />
        </div>

        {/* Filter dropdown */}
        <div className="relative">
          <button
            onClick={() => setFilterOpen(v => !v)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-slate-200 rounded-md bg-white hover:bg-slate-50 transition-colors"
          >
            {FILTER_OPTIONS.find(o => o.key === filter)?.label ?? 'Tất cả'}
            <ChevronDown size={11} className="text-slate-400" />
          </button>
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setFilterOpen(false)} />
              <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
                {FILTER_OPTIONS.map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => { setFilter(opt.key); setFilterOpen(false) }}
                    className={cn('w-full text-left px-3 py-1.5 text-xs transition-colors hover:bg-slate-50', filter === opt.key ? 'font-semibold text-blue-600' : 'text-slate-700')}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <span className="text-xs text-slate-400 ml-auto">
          {filtered.length !== projects.length ? `${filtered.length}/${projects.length}` : `${projects.length}`} dự án
        </span>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="px-4 py-2 bg-slate-800 text-white flex items-center gap-3 text-xs">
          <span className="font-medium">{selectedCount} dự án đã chọn</span>
          <button onClick={() => setSelectedIds(new Set())} className="underline opacity-70 hover:opacity-100">Bỏ chọn</button>
          <div className="flex-1" />

          {/* Bulk assign */}
          <div className="relative">
            <button
              onClick={() => setBulkLevelOpen(v => !v)}
              disabled={saving}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
            >
              {saving ? 'Đang gán...' : 'Gán loạt'} <ChevronDown size={11} />
            </button>
            {bulkLevelOpen && !saving && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBulkLevelOpen(false)} />
                <div className="absolute right-0 bottom-full mb-1 w-36 bg-white border border-slate-200 rounded-lg shadow-xl z-20 py-1">
                  {(['viewer', 'reporter', 'editor'] as ShareAccessLevel[]).map(lv => {
                    const m = LEVEL_META[lv]
                    return (
                      <button
                        key={lv}
                        onClick={() => bulkAssign(lv)}
                        className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                      >
                        {m.icon} {m.label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {/* Bulk revoke — only when all selected have access */}
          {allSelectedHaveAccess && (
            <button
              onClick={bulkRevoke}
              disabled={revoking}
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 px-3 py-1.5 rounded text-xs font-medium transition-colors disabled:opacity-50"
            >
              <Trash2 size={11} /> {revoking ? 'Đang thu hồi...' : 'Thu hồi'}
            </button>
          )}
        </div>
      )}

      {/* Project list */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            {search ? `Không tìm thấy dự án "${search}"` : 'Không có dự án phù hợp với bộ lọc.'}
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input
                    ref={headerRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="accent-blue-600"
                  />
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Dự án</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Quyền</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, idx) => {
                const share = shareMap.get(p.project_id)
                const meta = share ? LEVEL_META[share.access_level] : null
                const selected = selectedIds.has(p.project_id)
                return (
                  <tr
                    key={p.project_id}
                    className={cn(
                      'border-b border-slate-100 transition-colors',
                      selected ? 'bg-blue-50/60' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
                    )}
                  >
                    <td className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleOne(p.project_id)}
                        className="accent-blue-600"
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-[11px] text-slate-400">{p.project_id}</div>
                      <div className="text-sm text-slate-700 font-medium">{p.name}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {share && meta ? (
                        <button
                          onClick={() => setPopover({
                            projectId: p.project_id,
                            shareId: share.share_id,
                            access_level: share.access_level,
                            effective_permissions: share.effective_permissions,
                          })}
                          className={cn(
                            'inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-all hover:shadow-sm',
                            meta.cls
                          )}
                        >
                          {meta.icon} {meta.label}
                        </button>
                      ) : (
                        <button
                          onClick={() => setPopover({ projectId: p.project_id })}
                          className="text-xs text-blue-600 hover:text-blue-800 hover:underline px-2 py-1"
                        >
                          + Gán
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Single-cell permission edit */}
      {popover && (
        <CellPermissionPopover
          userId={member.user_id}
          projectId={popover.projectId}
          shareId={popover.shareId}
          initialLevel={popover.access_level}
          initialPerms={popover.effective_permissions}
          memberName={member.full_name}
          projectName={projects.find(p => p.project_id === popover.projectId)?.name ?? ''}
          onClose={() => setPopover(null)}
          onSaved={() => { setPopover(null); onRefresh() }}
          onRevoked={() => { setPopover(null); onRefresh() }}
        />
      )}
    </div>
  )
}
