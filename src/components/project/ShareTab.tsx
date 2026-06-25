'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, Plus, ChevronDown, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ProjectShare, ShareAccessLevel, ACCESS_LEVEL_DEFAULTS, SharePermissionId } from '@/lib/types'
import AddShareModal from './AddShareModal'

interface Props {
  projectId: string
  projectName: string
  teamId: string | null
}

const LEVEL_META: Record<ShareAccessLevel, { icon: string; label: string; cls: string }> = {
  viewer:   { icon: '👁',  label: 'Viewer',   cls: 'bg-gray-100 text-gray-700' },
  reporter: { icon: '📊', label: 'Reporter', cls: 'bg-blue-100 text-blue-700' },
  editor:   { icon: '✏️', label: 'Editor',   cls: 'bg-green-100 text-green-700' },
}

const PERM_LABELS: Record<SharePermissionId, string> = {
  view_revenue:    'Xem DT',
  view_profit:     'Xem LN',
  view_adspend:    'Xem QC',
  input_revenue:   'Nhập DT',
  input_expense:   'Nhập CP',
  confirm_payment: 'XN TT',
}

const ALL_PERMS = Object.keys(PERM_LABELS) as SharePermissionId[]

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? ''
}

export default function ShareTab({ projectId, projectName, teamId }: Props) {
  const [shares, setShares]           = useState<ProjectShare[]>([])
  const [isLoading, setIsLoading]     = useState(true)
  const [showModal, setShowModal]     = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [changingId, setChangingId]   = useState<string | null>(null)
  const [revokingId, setRevokingId]   = useState<string | null>(null)

  const loadShares = useCallback(async () => {
    setIsLoading(true)
    const token = await getToken()
    const res = await fetch(`/api/projects/${projectId}/shares`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) setShares(await res.json())
    setIsLoading(false)
  }, [projectId])

  useEffect(() => { loadShares() }, [loadShares])

  async function changeLevel(shareId: string, access_level: ShareAccessLevel) {
    setChangingId(shareId)
    const token = await getToken()
    await fetch(`/api/projects/${projectId}/shares/${shareId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_level }),
    })
    setOpenDropdown(null)
    setChangingId(null)
    loadShares()
  }

  async function revokeShare(shareId: string, name: string) {
    if (!confirm(`Thu hồi quyền truy cập của ${name} vào dự án này?`)) return
    setRevokingId(shareId)
    const token = await getToken()
    await fetch(`/api/projects/${projectId}/shares/${shareId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setRevokingId(null)
    loadShares()
  }

  function getEffectivePerms(share: ProjectShare): Record<SharePermissionId, boolean> {
    const defaults = ACCESS_LEVEL_DEFAULTS[share.access_level]
    const overrides = new Map((share.custom_permissions ?? []).map(p => [p.permission_id, p.granted]))
    return ALL_PERMS.reduce((acc, pid) => {
      acc[pid] = overrides.has(pid) ? overrides.get(pid)! : defaults[pid]
      return acc
    }, {} as Record<SharePermissionId, boolean>)
  }

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-slate-400">Đang tải...</div>
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Đang chia sẻ với ({shares.length} người)
          </p>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={14} /> Thêm người
          </button>
        </div>

        {/* Empty state */}
        {shares.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-slate-200 rounded-lg">
            <Users size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="text-sm text-slate-500">Chưa chia sẻ với ai trong team</p>
            <button onClick={() => setShowModal(true)} className="mt-3 text-sm text-blue-600 hover:underline">
              + Thêm người đầu tiên
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {shares.map(share => {
              const meta  = LEVEL_META[share.access_level]
              const perms = getEffectivePerms(share)
              const hasCustom = (share.custom_permissions ?? []).length > 0
              const name  = share.user_profile?.full_name ?? 'Unknown'

              return (
                <div key={share.id} className="bg-white border border-slate-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3">
                    {/* User info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{name}</p>
                      <p className="text-xs text-slate-400 truncate">{share.user_profile?.email}</p>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Level badge + dropdown */}
                      <div className="relative">
                        <button
                          onClick={() => setOpenDropdown(openDropdown === share.id ? null : share.id)}
                          disabled={changingId === share.id}
                          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-opacity hover:opacity-80 ${meta.cls} disabled:opacity-50`}
                        >
                          <span>{meta.icon}</span>
                          <span>{meta.label}</span>
                          {hasCustom && <span className="opacity-60 text-[10px]">✏️</span>}
                          <ChevronDown size={11} />
                        </button>

                        {openDropdown === share.id && (
                          <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-slate-200 rounded-lg shadow-lg z-20 py-1">
                            {(['viewer', 'reporter', 'editor'] as ShareAccessLevel[]).map(level => {
                              const m = LEVEL_META[level]
                              return (
                                <button
                                  key={level}
                                  onClick={() => changeLevel(share.id, level)}
                                  className={`w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-slate-50 ${share.access_level === level ? 'font-semibold text-blue-600' : 'text-slate-700'}`}
                                >
                                  {m.icon} {m.label}
                                </button>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {/* Revoke */}
                      <button
                        onClick={() => revokeShare(share.id, name)}
                        disabled={revokingId === share.id}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors disabled:opacity-40"
                        title="Thu hồi quyền"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {/* Permission chips */}
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {ALL_PERMS.map(pid => (
                      <span
                        key={pid}
                        className={`text-[11px] px-2 py-0.5 rounded-full ${
                          perms[pid]
                            ? 'bg-green-50 text-green-700'
                            : 'bg-slate-100 text-slate-400 line-through'
                        }`}
                      >
                        {PERM_LABELS[pid]}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Đóng dropdown khi click ngoài */}
      {openDropdown && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenDropdown(null)} />
      )}

      {showModal && (
        <AddShareModal
          projectId={projectId}
          projectName={projectName}
          teamId={teamId}
          existingSharedUserIds={shares.map(s => s.user_id)}
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); loadShares() }}
        />
      )}
    </>
  )
}
