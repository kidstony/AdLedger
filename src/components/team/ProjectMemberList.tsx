'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, Trash2, ChevronDown } from 'lucide-react'
import { ShareAccessLevel, SharePermissions } from '@/lib/types'
import { cn } from '@/lib/utils'
import CellPermissionPopover from './CellPermissionPopover'
import { MatrixMember, MatrixProject, MatrixShare } from './MemberProjectList'

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
  project:       MatrixProject
  members:       MatrixMember[]
  projectShares: MatrixShare[]
  getToken:      () => Promise<string>
  onRefresh:     () => void
}

interface PopoverState {
  userId: string; shareId?: string
  access_level?: ShareAccessLevel; effective_permissions?: SharePermissions
}

export default function ProjectMemberList({ project, members, projectShares, getToken, onRefresh }: Props) {
  const [search, setSearch]             = useState('')
  const [filter, setFilter]             = useState<FilterKey>('all')
  const [filterOpen, setFilterOpen]     = useState(false)
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkLevelOpen, setBulkLevelOpen] = useState(false)
  const [saving, setSaving]             = useState(false)
  const [revoking, setRevoking]         = useState(false)
  const [popover, setPopover]           = useState<PopoverState | null>(null)
  const headerRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setSelectedIds(new Set()); setSearch(''); setFilter('all') }, [project.project_id])

  const shareMap = useMemo(
    () => new Map(projectShares.map(s => [s.user_id, s])),
    [projectShares]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return members.filter(m => {
      const matchSearch = !q || m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
      const share = shareMap.get(m.user_id)
      const matchFilter =
        filter === 'all'     ? true
        : filter === 'granted' ? !!share
        : filter === 'none'    ? !share
        : share?.access_level === filter
      return matchSearch && matchFilter
    })
  }, [members, shareMap, search, filter])

  const allSelected  = filtered.length > 0 && filtered.every(m => selectedIds.has(m.user_id))
  const someSelected = filtered.some(m => selectedIds.has(m.user_id))
  const selectedCount = [...selectedIds].filter(id => filtered.some(m => m.user_id === id)).length

  useEffect(() => {
    if (headerRef.current) headerRef.current.indeterminate = someSelected && !allSelected
  }, [someSelected, allSelected])

  function toggleAll() {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allSelected) filtered.forEach(m => next.delete(m.user_id))
      else filtered.forEach(m => next.add(m.user_id))
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

  const selectedWithAccess = [...selectedIds]
    .map(uid => shareMap.get(uid))
    .filter(Boolean) as MatrixShare[]
  const allSelectedHaveAccess = selectedCount > 0 && selectedCount === selectedWithAccess.length

  async function bulkAssign(level: ShareAccessLevel) {
    const ids = [...selectedIds]
    if (!ids.length) return
    setSaving(true)
    setBulkLevelOpen(false)
    const token = await getToken()
    await fetch(`/api/projects/${project.project_id}/shares`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_ids: ids, access_level: level }),
    })
    setSaving(false)
    setSelectedIds(new Set())
    onRefresh()
  }

  async function bulkRevoke() {
    if (!selectedWithAccess.length) return
    const names = selectedWithAccess
      .map(s => members.find(m => m.user_id === s.user_id)?.full_name ?? s.user_id)
      .join(', ')
    if (!confirm(`Thu hồi quyền của ${selectedWithAccess.length} thành viên khỏi "${project.name}"?\n${names}`)) return
    setRevoking(true)
    const token = await getToken()
    await Promise.all(selectedWithAccess.map(s =>
      fetch(`/api/projects/${project.project_id}/shares/${s.share_id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    ))
    setRevoking(false)
    setSelectedIds(new Set())
    onRefresh()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-baseline gap-2">
          <p className="font-semibold text-slate-800">{project.name}</p>
          <p className="text-xs font-mono text-slate-400">{project.project_id}</p>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">
          <span className="font-semibold text-slate-700">{projectShares.length}</span>/{members.length} thành viên có quyền
        </p>
      </div>

      {/* Toolbar */}
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[160px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm thành viên..."
            className="w-full pl-7 pr-3 py-1.5 text-xs border border-slate-200 rounded-md outline-none focus:ring-1 focus:ring-blue-300 bg-white"
          />
        </div>

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
          {filtered.length !== members.length ? `${filtered.length}/${members.length}` : `${members.length}`} thành viên
        </span>
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="px-4 py-2 bg-slate-800 text-white flex items-center gap-3 text-xs">
          <span className="font-medium">{selectedCount} thành viên đã chọn</span>
          <button onClick={() => setSelectedIds(new Set())} className="underline opacity-70 hover:opacity-100">Bỏ chọn</button>
          <div className="flex-1" />

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
                      <button key={lv} onClick={() => bulkAssign(lv)}
                        className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                        {m.icon} {m.label}
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>

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

      {/* Member list */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            {search ? `Không tìm thấy "${search}"` : 'Không có thành viên phù hợp.'}
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input ref={headerRef} type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-blue-600" />
                </th>
                <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Thành viên</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">Quyền</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m, idx) => {
                const share = shareMap.get(m.user_id)
                const meta  = share ? LEVEL_META[share.access_level] : null
                const selected = selectedIds.has(m.user_id)
                return (
                  <tr key={m.user_id} className={cn(
                    'border-b border-slate-100 transition-colors',
                    selected ? 'bg-blue-50/60' : idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
                  )}>
                    <td className="px-3 py-2.5 text-center">
                      <input type="checkbox" checked={selected} onChange={() => toggleOne(m.user_id)} className="accent-blue-600" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-sm text-slate-800 font-medium">{m.full_name}</div>
                      {m.email && <div className="text-xs text-slate-400">{m.email}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {share && meta ? (
                        <button
                          onClick={() => setPopover({ userId: m.user_id, shareId: share.share_id, access_level: share.access_level, effective_permissions: share.effective_permissions })}
                          className={cn('inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full border transition-all hover:shadow-sm', meta.cls)}
                        >
                          {meta.icon} {meta.label}
                        </button>
                      ) : (
                        <button
                          onClick={() => setPopover({ userId: m.user_id })}
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

      {popover && (
        <CellPermissionPopover
          userId={popover.userId}
          projectId={project.project_id}
          shareId={popover.shareId}
          initialLevel={popover.access_level}
          initialPerms={popover.effective_permissions}
          memberName={members.find(m => m.user_id === popover.userId)?.full_name ?? ''}
          projectName={project.name}
          onClose={() => setPopover(null)}
          onSaved={() => { setPopover(null); onRefresh() }}
          onRevoked={() => { setPopover(null); onRefresh() }}
        />
      )}
    </div>
  )
}
