'use client'

import { useState } from 'react'
import { X, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ShareAccessLevel, SharePermissions, SharePermissionId, ACCESS_LEVEL_DEFAULTS } from '@/lib/types'
import { cn } from '@/lib/utils'

const LEVEL_META: Record<ShareAccessLevel, { icon: string; label: string; desc: string; cls: string }> = {
  viewer:   { icon: '👁',  label: 'Viewer',   desc: 'Không xem được số liệu',  cls: 'border-gray-300 bg-gray-50 text-gray-700' },
  reporter: { icon: '📊', label: 'Reporter', desc: 'Chỉ xem, không nhập liệu', cls: 'border-blue-300 bg-blue-50 text-blue-700' },
  editor:   { icon: '✏️', label: 'Editor',   desc: 'Toàn quyền xem và nhập',   cls: 'border-green-300 bg-green-50 text-green-700' },
}

const PERM_LABELS: Record<SharePermissionId, { short: string; full: string }> = {
  view_revenue:    { short: 'Xem DT',  full: 'Xem doanh thu' },
  view_profit:     { short: 'Xem LN',  full: 'Xem lợi nhuận' },
  view_adspend:    { short: 'Xem QC',  full: 'Xem chi phí QC' },
  input_revenue:   { short: 'Nhập DT', full: 'Nhập doanh thu' },
  input_expense:   { short: 'Nhập CP', full: 'Nhập chi phí' },
  confirm_payment: { short: 'XN TT',   full: 'Xác nhận thanh toán' },
}

const ALL_PERMS = Object.keys(PERM_LABELS) as SharePermissionId[]

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? ''
}

interface Props {
  userId: string
  projectId: string
  shareId?: string
  initialLevel?: ShareAccessLevel
  initialPerms?: SharePermissions
  memberName: string
  projectName: string
  onClose: () => void
  onSaved: () => void
  onRevoked: () => void
}

export default function CellPermissionPopover({
  userId, projectId, shareId, initialLevel, initialPerms,
  memberName, projectName, onClose, onSaved, onRevoked,
}: Props) {
  const isNew = !shareId
  const [level, setLevel] = useState<ShareAccessLevel>(initialLevel ?? 'reporter')
  const [perms, setPerms] = useState<SharePermissions>(
    initialPerms ?? ACCESS_LEVEL_DEFAULTS[initialLevel ?? 'reporter']
  )
  const [saving, setSaving] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [showCustom, setShowCustom] = useState(false)

  function handleLevelChange(newLevel: ShareAccessLevel) {
    setLevel(newLevel)
    setPerms(ACCESS_LEVEL_DEFAULTS[newLevel])
  }

  function isCustomized(): boolean {
    const defaults = ACCESS_LEVEL_DEFAULTS[level]
    return ALL_PERMS.some(pid => perms[pid] !== defaults[pid])
  }

  async function handleSave() {
    setSaving(true)
    const token = await getToken()

    if (isNew) {
      const customized = isCustomized()
      await fetch(`/api/projects/${projectId}/shares`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_ids: [userId],
          access_level: level,
          ...(customized ? { custom_permissions: perms } : {}),
        }),
      })
    } else {
      await fetch(`/api/projects/${projectId}/shares/${shareId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_level: level, custom_permissions: perms }),
      })
    }

    setSaving(false)
    onSaved()
  }

  async function handleRevoke() {
    if (!shareId) return
    if (!confirm(`Thu hồi quyền truy cập của ${memberName} vào dự án ${projectName}?`)) return
    setRevoking(true)
    const token = await getToken()
    await fetch(`/api/projects/${projectId}/shares/${shareId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    setRevoking(false)
    onRevoked()
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Card */}
      <div className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm bg-white rounded-xl shadow-xl border border-slate-200">
        {/* Header */}
        <div className="flex items-start justify-between px-4 py-3 border-b border-slate-100">
          <div>
            <p className="text-sm font-semibold text-slate-800">{memberName}</p>
            <p className="text-xs text-slate-400">{projectName}</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Access Level */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Mức quyền</p>
            <div className="grid grid-cols-3 gap-2">
              {(['viewer', 'reporter', 'editor'] as ShareAccessLevel[]).map(lv => {
                const m = LEVEL_META[lv]
                return (
                  <button
                    key={lv}
                    onClick={() => handleLevelChange(lv)}
                    className={cn(
                      'flex flex-col items-center gap-1 p-2.5 rounded-lg border-2 transition-all text-xs',
                      level === lv ? m.cls + ' border-opacity-100' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                    )}
                  >
                    <span className="text-base">{m.icon}</span>
                    <span className="font-semibold">{m.label}</span>
                    <span className="text-[10px] leading-tight text-center opacity-70">{m.desc}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Custom permissions toggle */}
          <button
            onClick={() => setShowCustom(v => !v)}
            className="w-full flex items-center justify-between text-xs text-slate-500 hover:text-slate-700 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <span>⚙️</span>
              <span>Tùy chỉnh quyền chi tiết</span>
              {isCustomized() && <span className="text-blue-600 font-medium">· Đã tùy chỉnh</span>}
            </span>
            <span className="text-slate-300">{showCustom ? '▲' : '▼'}</span>
          </button>

          {showCustom && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-0 bg-slate-50 rounded-lg p-3">
              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Xem số liệu</p>
                {(['view_revenue', 'view_profit', 'view_adspend'] as SharePermissionId[]).map(pid => (
                  <label key={pid} className="flex items-center gap-2 py-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={perms[pid]}
                      onChange={e => setPerms(p => ({ ...p, [pid]: e.target.checked }))}
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
                      checked={perms[pid]}
                      onChange={e => setPerms(p => ({ ...p, [pid]: e.target.checked }))}
                      className="accent-blue-600"
                    />
                    <span className="text-xs text-slate-600">{PERM_LABELS[pid].full}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
          {!isNew ? (
            <button
              onClick={handleRevoke}
              disabled={revoking}
              className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded transition-colors disabled:opacity-40"
            >
              <Trash2 size={12} /> Xóa quyền
            </button>
          ) : <div />}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded transition-colors"
            >
              Hủy
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {saving ? 'Đang lưu...' : isNew ? 'Gán quyền' : 'Lưu'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
