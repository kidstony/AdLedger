'use client'

import { useState, useEffect } from 'react'
import { X, Search, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ShareAccessLevel, SharePermissionId, ACCESS_LEVEL_DEFAULTS, SharePermissions } from '@/lib/types'

interface TeamMember {
  user_id: string
  full_name: string
  email: string
}

interface Props {
  projectId:             string
  projectName:           string
  teamId:                string | null
  existingSharedUserIds: string[]
  onClose:               () => void
  onSuccess:             () => void
}

const LEVEL_OPTIONS: { value: ShareAccessLevel; icon: string; label: string; desc: string }[] = [
  { value: 'viewer',   icon: '👁',  label: 'Viewer',   desc: 'Chỉ xem thông tin, không thấy số tiền' },
  { value: 'reporter', icon: '📊', label: 'Reporter', desc: 'Xem thông tin + thấy số tiền' },
  { value: 'editor',   icon: '✏️', label: 'Editor',   desc: 'Xem tất cả + nhập doanh thu, chi phí' },
]

const PERM_GROUPS: { group: string; items: { id: SharePermissionId; label: string }[] }[] = [
  {
    group: 'Xem số liệu',
    items: [
      { id: 'view_revenue',  label: 'Xem doanh thu' },
      { id: 'view_profit',   label: 'Xem lợi nhuận / ROI' },
      { id: 'view_adspend',  label: 'Xem chi phí quảng cáo' },
    ],
  },
  {
    group: 'Nhập liệu',
    items: [
      { id: 'input_revenue',   label: 'Nhập doanh thu' },
      { id: 'input_expense',   label: 'Nhập chi phí' },
      { id: 'confirm_payment', label: 'Xác nhận thanh toán' },
    ],
  },
]

export default function AddShareModal({
  projectId, projectName, teamId, existingSharedUserIds, onClose, onSuccess,
}: Props) {
  const [members, setMembers]         = useState<TeamMember[]>([])
  const [isLoadingMembers, setLoading] = useState(true)
  const [search, setSearch]           = useState('')
  const [selected, setSelected]       = useState<Set<string>>(new Set())
  const [accessLevel, setAccessLevel] = useState<ShareAccessLevel>('reporter')
  const [showCustom, setShowCustom]   = useState(false)
  const [customPerms, setCustomPerms] = useState<SharePermissions>({ ...ACCESS_LEVEL_DEFAULTS.reporter })
  const [isSubmitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function load() {
      if (!teamId) { setLoading(false); return }
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token ?? ''
      const res = await fetch('/api/admin/list-users', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const allUsers = await res.json()
      const teamMembers = (Array.isArray(allUsers) ? allUsers : [])
        .filter((u: { role: string; team_id: string | null }) =>
          u.role === 'member' && u.team_id === teamId
        )
        .map((u: { user_id: string; full_name: string; email: string }) => ({
          user_id: u.user_id,
          full_name: u.full_name,
          email: u.email,
        }))
        .sort((a: TeamMember, b: TeamMember) => a.full_name.localeCompare(b.full_name))
      setMembers(teamMembers)
      setLoading(false)
    }
    load()
  }, [teamId])

  function handleLevelChange(level: ShareAccessLevel) {
    setAccessLevel(level)
    setCustomPerms({ ...ACCESS_LEVEL_DEFAULTS[level] })
  }

  function toggleUser(userId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(userId) ? next.delete(userId) : next.add(userId)
      return next
    })
  }

  function togglePerm(id: SharePermissionId) {
    setCustomPerms(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const hasCustom = PERM_GROUPS.flatMap(g => g.items).some(
    p => customPerms[p.id] !== ACCESS_LEVEL_DEFAULTS[accessLevel][p.id]
  )

  const existingSet = new Set(existingSharedUserIds)
  const filtered    = members.filter(m =>
    !search ||
    m.full_name.toLowerCase().includes(search.toLowerCase()) ||
    m.email.toLowerCase().includes(search.toLowerCase())
  )

  async function handleSubmit() {
    if (selected.size === 0 || isSubmitting) return
    setSubmitting(true)

    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token ?? ''

    const body: {
      user_ids: string[]
      access_level: ShareAccessLevel
      custom_permissions?: Record<SharePermissionId, boolean>
    } = {
      user_ids: [...selected],
      access_level: accessLevel,
    }
    if (hasCustom) body.custom_permissions = customPerms as Record<SharePermissionId, boolean>

    const res = await fetch(`/api/projects/${projectId}/shares`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setSubmitting(false)
    if (res.ok) onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">Chia sẻ dự án</h3>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{projectName}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5">

          {/* BƯỚC 1: Chọn thành viên */}
          <div>
            <p className="text-xs font-medium text-slate-600 mb-2">Chọn thành viên trong team</p>
            <div className="relative mb-2">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm tên hoặc email..."
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-44 overflow-y-auto">
              {isLoadingMembers ? (
                <p className="text-xs text-slate-400 text-center py-6">Đang tải...</p>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">
                  {members.length === 0 ? 'Team chưa có member nào' : 'Không tìm thấy thành viên'}
                </p>
              ) : (
                filtered.map(m => {
                  const alreadyShared = existingSet.has(m.user_id)
                  return (
                    <label
                      key={m.user_id}
                      className={`flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 ${alreadyShared ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(m.user_id) || alreadyShared}
                        disabled={alreadyShared}
                        onChange={() => !alreadyShared && toggleUser(m.user_id)}
                        className="rounded border-slate-300"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700 truncate">{m.full_name}</p>
                        <p className="text-[11px] text-slate-400 truncate">{m.email}</p>
                      </div>
                      {alreadyShared && (
                        <span className="text-[10px] font-medium text-blue-500 shrink-0">Đã chia sẻ</span>
                      )}
                    </label>
                  )
                })
              )}
            </div>
          </div>

          {/* BƯỚC 2: Chọn cấp độ */}
          <div>
            <p className="text-xs font-medium text-slate-600 mb-2">Cấp độ truy cập</p>
            <div className="space-y-2">
              {LEVEL_OPTIONS.map(opt => (
                <label
                  key={opt.value}
                  className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors"
                  style={{
                    borderColor: accessLevel === opt.value ? '#2563eb' : '#e2e8f0',
                    backgroundColor: accessLevel === opt.value ? '#eff6ff' : undefined,
                  }}
                >
                  <input
                    type="radio"
                    name="access_level"
                    value={opt.value}
                    checked={accessLevel === opt.value}
                    onChange={() => handleLevelChange(opt.value)}
                    className="mt-0.5 shrink-0"
                  />
                  <div>
                    <p className="text-xs font-medium text-slate-700">{opt.icon} {opt.label}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* BƯỚC 3: Tùy chỉnh quyền (expandable) */}
          <div>
            <button
              type="button"
              onClick={() => setShowCustom(v => !v)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              {showCustom ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              ⚙️ Tùy chỉnh quyền chi tiết
              {hasCustom && (
                <span className="ml-1 text-blue-500 font-medium">✏️ Đã tùy chỉnh</span>
              )}
            </button>

            {showCustom && (
              <div className="mt-3 border border-slate-200 rounded-lg p-4 space-y-4">
                {PERM_GROUPS.map(({ group, items }) => (
                  <div key={group}>
                    <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      📊 {group}
                    </p>
                    <div className="space-y-2">
                      {items.map(({ id, label }) => (
                        <label key={id} className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={customPerms[id]}
                            onChange={() => togglePerm(id)}
                            className="rounded border-slate-300"
                          />
                          <span className="text-xs text-slate-600">{label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 rounded-lg hover:bg-slate-100"
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={selected.size === 0 || isSubmitting}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSubmitting
              ? 'Đang lưu...'
              : selected.size > 0
                ? `Chia sẻ với ${selected.size} người →`
                : 'Chia sẻ →'}
          </button>
        </div>
      </div>
    </div>
  )
}
