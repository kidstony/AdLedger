'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users, Plus, ChevronDown, Trash2, Settings } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ProjectShare, ShareAccessLevel, ACCESS_LEVEL_DEFAULTS, SharePermissionId } from '@/lib/types'
import AddShareModal from './AddShareModal'
import { useConfirm } from '@/components/ui/ConfirmDialog'

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

const PERM_LABELS: Record<SharePermissionId, { short: string; full: string }> = {
  view_revenue:    { short: 'Xem DT',  full: 'Xem doanh thu' },
  view_profit:     { short: 'Xem LN',  full: 'Xem lợi nhuận' },
  view_adspend:    { short: 'Xem QC',  full: 'Xem chi phí QC' },
  input_revenue:   { short: 'Nhập DT', full: 'Nhập doanh thu' },
  input_expense:   { short: 'Nhập CP', full: 'Nhập chi phí' },
  confirm_payment: { short: 'XN TT',   full: 'Xác nhận thanh toán' },
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function avatarColor(userId: string): string {
  const colors = ['bg-blue-500','bg-violet-500','bg-emerald-500','bg-orange-500','bg-rose-500','bg-cyan-500']
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return colors[hash % colors.length]
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'hôm nay'
  if (days === 1) return 'hôm qua'
  if (days < 30) return `${days} ngày trước`
  const months = Math.floor(days / 30)
  return `${months} tháng trước`
}

const ALL_PERMS = Object.keys(PERM_LABELS) as SharePermissionId[]

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? ''
}

export default function ShareTab({ projectId, projectName, teamId }: Props) {
  const confirmDlg = useConfirm()
  const [shares, setShares]           = useState<ProjectShare[]>([])
  const [isLoading, setIsLoading]     = useState(true)
  const [showModal, setShowModal]     = useState(false)
  const [openDropdown, setOpenDropdown]     = useState<string | null>(null)
  const [changingId, setChangingId]         = useState<string | null>(null)
  const [revokingId, setRevokingId]         = useState<string | null>(null)
  const [expandedShareId, setExpandedShareId] = useState<string | null>(null)
  const [localPerms, setLocalPerms]         = useState<Record<SharePermissionId, boolean> | null>(null)
  const [savingPerms, setSavingPerms]       = useState(false)

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
    setExpandedShareId(null)
    setLocalPerms(null)
    const token = await getToken()
    // Gửi kèm default permissions để xóa sạch custom permissions cũ
    await fetch(`/api/projects/${projectId}/shares/${shareId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_level, custom_permissions: ACCESS_LEVEL_DEFAULTS[access_level] }),
    })
    setOpenDropdown(null)
    setChangingId(null)
    loadShares()
  }

  function openPermEdit(share: ProjectShare) {
    if (expandedShareId === share.id) {
      setExpandedShareId(null)
      setLocalPerms(null)
      return
    }
    setExpandedShareId(share.id)
    setLocalPerms(getEffectivePerms(share))
  }

  async function savePerms(shareId: string) {
    if (!localPerms) return
    setSavingPerms(true)
    const token = await getToken()
    await fetch(`/api/projects/${projectId}/shares/${shareId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ custom_permissions: localPerms }),
    })
    setSavingPerms(false)
    setExpandedShareId(null)
    setLocalPerms(null)
    loadShares()
  }

  async function revokeShare(shareId: string, name: string) {
    if (!(await confirmDlg({ title: `Thu hồi quyền truy cập của ${name}?`, description: 'Người này sẽ không xem được dự án nữa.', confirmLabel: 'Thu hồi' }))) return
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

              const initials = name !== 'Unknown' ? getInitials(name) : '?'
              const email = share.user_profile?.email ?? ''

              return (
                <div key={share.id} className="bg-white border border-slate-200 rounded-lg p-4">
                  <div className="flex items-center justify-between gap-3">
                    {/* Avatar + User info */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-full ${avatarColor(share.user_id)} flex items-center justify-center text-white text-xs font-semibold shrink-0`}>
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{name}</p>
                        <p className="text-xs text-slate-400 truncate">
                          {email}
                          {share.created_at && (
                            <span className="ml-1.5 text-slate-300">· {timeAgo(share.created_at)}</span>
                          )}
                        </p>
                      </div>
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

                      {/* Custom permissions toggle */}
                      <button
                        onClick={() => openPermEdit(share)}
                        className={`p-1.5 rounded transition-colors ${expandedShareId === share.id ? 'bg-blue-100 text-blue-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                        title="Tùy chỉnh quyền chi tiết"
                      >
                        <Settings size={14} />
                      </button>

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
                  <div className="mt-2.5 ml-11 flex flex-wrap gap-1.5">
                    {ALL_PERMS.map(pid => (
                      <span
                        key={pid}
                        title={PERM_LABELS[pid].full}
                        className={`text-[11px] px-2 py-0.5 rounded-full cursor-default ${
                          perms[pid]
                            ? 'bg-green-50 text-green-700'
                            : 'bg-slate-100 text-slate-400 line-through'
                        }`}
                      >
                        {PERM_LABELS[pid].short}
                      </span>
                    ))}
                  </div>

                  {/* Inline permission editor */}
                  {expandedShareId === share.id && localPerms && (
                    <div className="mt-3 ml-11 pt-3 border-t border-slate-100">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-0 max-w-sm">
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Xem số liệu</p>
                          {(['view_revenue', 'view_profit', 'view_adspend'] as SharePermissionId[]).map(pid => (
                            <label key={pid} className="flex items-center gap-2 py-1 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={localPerms[pid]}
                                onChange={e => setLocalPerms(prev => prev ? { ...prev, [pid]: e.target.checked } : prev)}
                                className="accent-blue-600"
                              />
                              <span className="text-xs text-slate-600">{PERM_LABELS[pid].full}</span>
                            </label>
                          ))}
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Nhập liệu</p>
                          {(['input_revenue', 'input_expense', 'confirm_payment'] as SharePermissionId[]).map(pid => (
                            <label key={pid} className="flex items-center gap-2 py-1 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={localPerms[pid]}
                                onChange={e => setLocalPerms(prev => prev ? { ...prev, [pid]: e.target.checked } : prev)}
                                className="accent-blue-600"
                              />
                              <span className="text-xs text-slate-600">{PERM_LABELS[pid].full}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-start gap-2 mt-3">
                        <button
                          onClick={() => savePerms(share.id)}
                          disabled={savingPerms}
                          className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                          {savingPerms ? 'Đang lưu...' : 'Lưu quyền'}
                        </button>
                        <button
                          onClick={() => { setExpandedShareId(null); setLocalPerms(null) }}
                          className="text-xs px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded transition-colors"
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                  )}
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
