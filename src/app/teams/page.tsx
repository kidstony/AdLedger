'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Users, FolderOpen, ChevronRight } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Team } from '@/lib/types'

interface TeamWithCounts extends Team {
  member_count: number
  project_count: number
  manager_name: string | null
}

const COLOR_PRESETS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#6b7280']

const BLANK = { name: '', color: '#3b82f6', manager_id: '' }

export default function TeamsPage() {
  const { role } = useAuth()
  const router = useRouter()

  const [teams, setTeams] = useState<TeamWithCounts[]>([])
  const [managers, setManagers] = useState<{ user_id: string; full_name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<TeamWithCounts | null>(null)
  const [form, setForm] = useState({ ...BLANK })
  const [saving, setSaving] = useState(false)

  async function adminFetch(url: string, options?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    return fetch(url, {
      ...options,
      headers: { ...options?.headers, 'Authorization': `Bearer ${session?.access_token ?? ''}` },
    })
  }

  useEffect(() => {
    if (role && role !== 'super_admin') router.replace('/dashboard')
  }, [role, router])

  useEffect(() => {
    if (role !== 'super_admin') return
    loadTeams()
    loadManagers()
  }, [role])

  async function loadTeams() {
    setLoading(true)
    const res = await adminFetch('/api/teams')
    const data = await res.json()
    setTeams(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  async function loadManagers() {
    const { data } = await supabase
      .from('user_profiles')
      .select('user_id, full_name, role')
      .in('role', ['manager', 'member'])
    setManagers((data ?? []).map((p: { user_id: string; full_name: string }) => ({ user_id: p.user_id, full_name: p.full_name })))
  }

  function openCreate() {
    setEditing(null)
    setForm({ ...BLANK })
    setShowModal(true)
  }

  function openEdit(t: TeamWithCounts) {
    setEditing(t)
    setForm({ name: t.name, color: t.color, manager_id: '' })
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Tên team không được để trống'); return }
    setSaving(true)

    if (editing) {
      const res = await adminFetch(`/api/teams/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, color: form.color }),
      })
      if (res.ok) {
        const updated = await res.json()
        setTeams(prev => prev.map(t => t.id === editing.id ? { ...t, ...updated } : t))
        toast.success('Đã cập nhật team')
      } else {
        toast.error('Không thể cập nhật')
      }
    } else {
      const res = await adminFetch('/api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, color: form.color, manager_id: form.manager_id || null }),
      })
      if (res.ok) {
        const data = await res.json()
        setTeams(prev => [...prev, data])
        toast.success('Đã tạo team')
      } else {
        toast.error('Không thể tạo team')
      }
    }

    setSaving(false)
    setShowModal(false)
  }

  async function handleDelete(t: TeamWithCounts) {
    if (t.member_count > 0 || t.project_count > 0) {
      toast.error('Vui lòng xóa hết thành viên và dự án trước khi xóa team')
      return
    }
    if (!confirm(`Xóa team "${t.name}"?`)) return
    const res = await adminFetch(`/api/teams/${t.id}`, { method: 'DELETE' })
    if (res.ok) {
      setTeams(prev => prev.filter(x => x.id !== t.id))
      toast.success('Đã xóa team')
    } else {
      const err = await res.json()
      toast.error(err.error ?? 'Không thể xóa')
    }
  }

  const totalMembers = teams.reduce((s, t) => s + t.member_count, 0)
  const totalProjects = teams.reduce((s, t) => s + t.project_count, 0)

  if (role !== 'super_admin') return null

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Quản lý Team</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {teams.length} team · {totalMembers} thành viên · {totalProjects} dự án
          </p>
        </div>
        <Button onClick={openCreate} className="gap-1.5">
          <Plus size={14} /> Tạo team mới
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-36 bg-slate-100 rounded-lg animate-pulse" />)}
        </div>
      ) : teams.length === 0 ? (
        <div className="py-16 text-center text-slate-400">
          <Users size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Chưa có team nào. Tạo team đầu tiên!</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teams.map(t => (
            <div key={t.id} className="border border-slate-200 rounded-lg p-4 bg-white hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                  <h3 className="font-semibold text-slate-800 text-sm">{t.name}</h3>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(t)} className="p-1 text-slate-400 hover:text-slate-700 transition-colors">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => handleDelete(t)} className="p-1 text-slate-400 hover:text-red-500 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <p>👑 Manager: <span className="text-slate-700">{t.manager_name ?? '— Chưa có —'}</span></p>
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1"><Users size={11} /> {t.member_count} thành viên</span>
                  <span className="flex items-center gap-1"><FolderOpen size={11} /> {t.project_count} dự án</span>
                </div>
              </div>
              <button
                onClick={() => router.push(`/teams/${t.id}`)}
                className="mt-3 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
              >
                Xem chi tiết <ChevronRight size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-slate-800">{editing ? 'Sửa team' : 'Tạo team mới'}</h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tên team</label>
              <input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300"
                placeholder="Team A" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-2">Màu team</label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_PRESETS.map(c => (
                  <button key={c} type="button"
                    onClick={() => setForm(f => ({ ...f, color: c }))}
                    className={cn('w-7 h-7 rounded-full transition-all', form.color === c ? 'ring-2 ring-offset-2 ring-slate-600 scale-110' : 'hover:scale-110')}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
            {!editing && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Manager (tuỳ chọn)</label>
                <select value={form.manager_id} onChange={e => setForm(f => ({ ...f, manager_id: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none">
                  <option value="">— Chưa gán —</option>
                  {managers.map(m => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setShowModal(false)}>Hủy</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? 'Đang lưu...' : editing ? 'Cập nhật' : 'Tạo team'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
