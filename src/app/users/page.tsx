'use client'

import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, Pencil, CheckCircle2, Clock, Search, ChevronDown } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { UserProfile, UserRole, Team } from '@/lib/types'

const ROLE_BADGE: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-700',
  manager:     'bg-blue-100 text-blue-700',
  member:      'bg-slate-100 text-slate-600',
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  manager:     'Manager',
  member:      'Member',
}

const COLOR_PRESETS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#6b7280']

type Step = 'info' | 'role'

const BLANK_FORM = {
  full_name: '',
  email: '',
  password: '',
  role: 'member' as UserRole,
  team_id: '',
  project_ids: [] as string[],
}

export default function UsersPage() {
  const { user: currentUser, role } = useAuth()
  const router = useRouter()

  const [users, setUsers] = useState<UserProfile[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [projects, setProjects] = useState<{ project_id: string; name: string; team_id: string | null }[]>([])
  const [loading, setLoading] = useState(true)

  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterTeam, setFilterTeam] = useState<string>('all')
  const [search, setSearch] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [step, setStep] = useState<Step>('info')
  const [form, setForm] = useState({ ...BLANK_FORM })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [editUser, setEditUser] = useState<UserProfile | null>(null)
  const [editForm, setEditForm] = useState<{ full_name: string; role: UserRole; team_id: string }>({ full_name: '', role: 'member', team_id: '' })
  const [editSaving, setEditSaving] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)

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
    loadAll()
  }, [role])

  async function loadAll() {
    setLoading(true)
    const [usersRes, teamsRes, projectsRes] = await Promise.all([
      adminFetch('/api/admin/list-users'),
      adminFetch('/api/teams'),
      supabase.from('projects').select('project_id, name, team_id').order('project_id'),
    ])
    const usersData = await usersRes.json()
    const teamsData = await teamsRes.json()
    setUsers(Array.isArray(usersData) ? usersData : [])
    setTeams(Array.isArray(teamsData) ? teamsData : [])
    setProjects(projectsRes.data ?? [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    return users.filter(u => {
      if (filterRole !== 'all' && u.role !== filterRole) return false
      if (filterTeam !== 'all' && u.team_id !== filterTeam) return false
      if (search) {
        const q = search.toLowerCase()
        if (!u.full_name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [users, filterRole, filterTeam, search])

  const teamProjects = useMemo(() => {
    if (!form.team_id) return []
    return projects.filter(p => p.team_id === form.team_id)
  }, [form.team_id, projects])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (step === 'info') { setStep('role'); return }
    setSaving(true)
    setFormError('')
    let res: Response, data: any = {}
    try {
      res = await adminFetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          password: form.password,
          full_name: form.full_name,
          role: form.role,
          team_id: form.team_id || null,
          project_ids: form.role === 'member' ? form.project_ids : [],
        }),
      })
      data = await res.json().catch(() => ({}))
    } catch {
      setFormError('Lỗi kết nối server'); setSaving(false); return
    }
    if (!res!.ok) {
      setFormError(typeof data?.error === 'string' ? data.error : `Lỗi ${res!.status}`)
      setSaving(false); return
    }
    setUsers(prev => [...prev, data])
    setShowCreate(false)
    setForm({ ...BLANK_FORM })
    setStep('info')
    setSaving(false)
    toast.success(`Đã tạo tài khoản ${form.email}`)
  }

  async function handleSaveEdit() {
    if (!editUser) return
    setEditSaving(true)
    const res = await adminFetch('/api/admin/update-role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: editUser.user_id, role: editForm.role, team_id: editForm.team_id || null }),
    })
    if (res.ok) {
      setUsers(prev => prev.map(u => u.user_id === editUser.user_id
        ? { ...u, full_name: editForm.full_name, role: editForm.role, team_id: editForm.team_id || null }
        : u
      ))
      setEditUser(null)
      toast.success('Đã cập nhật')
    } else {
      toast.error('Không thể cập nhật')
    }
    setEditSaving(false)
  }

  async function handleResetPassword() {
    if (!editUser) return
    const pw = prompt('Nhập mật khẩu mới (tối thiểu 8 ký tự):')
    if (!pw || pw.length < 8) { toast.error('Mật khẩu tối thiểu 8 ký tự'); return }
    const res = await adminFetch('/api/admin/update-role', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: editUser.user_id, password: pw }),
    })
    if (res.ok) toast.success('Đã reset mật khẩu')
    else toast.error('Không thể reset mật khẩu')
  }

  async function handleDelete(userId: string) {
    if (userId === currentUser?.id) { toast.error('Không thể xóa tài khoản đang đăng nhập'); return }
    if (!confirm('Xóa tài khoản này? Hành động không thể hoàn tác.')) return
    setDeletingId(userId)
    const res = await adminFetch('/api/admin/delete-user', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (res.ok) {
      setUsers(prev => prev.filter(u => u.user_id !== userId))
      toast.success('Đã xóa tài khoản')
    } else {
      toast.error('Không thể xóa tài khoản')
    }
    setDeletingId(null)
  }

  function openEdit(u: UserProfile) {
    setEditUser(u)
    setEditForm({ full_name: u.full_name, role: u.role, team_id: u.team_id ?? '' })
  }

  function getInitials(name: string) {
    return name.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase() || '?'
  }

  if (role !== 'super_admin') return null

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Quản lý User</h2>
          <p className="text-sm text-slate-500 mt-0.5">{users.length} tài khoản</p>
        </div>
        <Button onClick={() => { setShowCreate(true); setStep('info'); setForm({ ...BLANK_FORM }); setFormError('') }} className="gap-1.5">
          <Plus size={14} /> Tạo user mới
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Tìm tên hoặc email..."
            className="pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300 w-52"
          />
        </div>
        <div className="relative">
          <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
            className="appearance-none pl-3 pr-7 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300">
            <option value="all">Tất cả vai trò</option>
            <option value="super_admin">Super Admin</option>
            <option value="manager">Manager</option>
            <option value="member">Member</option>
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        <div className="relative">
          <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)}
            className="appearance-none pl-3 pr-7 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300">
            <option value="all">Tất cả team</option>
            {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>
        {(filterRole !== 'all' || filterTeam !== 'all' || search) && (
          <span className="text-xs text-slate-400">{filtered.length} / {users.length}</span>
        )}
      </div>

      {/* Users table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['', 'Họ tên', 'Email', 'Vai trò', 'Team', ''].map((h, i) => (
                <th key={i} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">Đang tải...</td></tr>
            ) : filtered.map(u => (
              <tr key={u.user_id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
                    {getInitials(u.full_name || u.email)}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{u.full_name || '—'}</span>
                    {u.email_confirmed
                      ? <span title="Email đã xác nhận"><CheckCircle2 size={12} className="text-green-500 shrink-0" /></span>
                      : <span title="Chờ xác nhận"><Clock size={12} className="text-amber-400 shrink-0" /></span>
                    }
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', ROLE_BADGE[u.role])}>
                    {ROLE_LABEL[u.role]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.team ? (
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: (u.team as { color?: string }).color ?? '#6b7280' }} />
                      {(u.team as { name?: string }).name}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openEdit(u)} className="p-1 text-slate-400 hover:text-slate-700 transition-colors">
                      <Pencil size={13} />
                    </button>
                    {u.user_id !== currentUser?.id && (
                      <button
                        onClick={() => handleDelete(u.user_id)}
                        disabled={deletingId === u.user_id}
                        className="p-1 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">Không có user nào phù hợp</div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-5">
              {(['info', 'role'] as Step[]).map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  {i > 0 && <div className="w-8 h-px bg-slate-200" />}
                  <div className={cn('flex items-center gap-1.5')}>
                    <span className={cn('w-5 h-5 rounded-full text-xs flex items-center justify-center font-medium',
                      step === s ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-400')}>
                      {i + 1}
                    </span>
                    <span className={cn('text-xs', step === s ? 'text-slate-800 font-medium' : 'text-slate-400')}>
                      {s === 'info' ? 'Thông tin' : 'Phân quyền'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <form onSubmit={handleCreate} className="space-y-3">
              {step === 'info' ? (
                <>
                  <h3 className="font-semibold text-slate-800 mb-3">Tạo user mới — Thông tin cơ bản</h3>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Họ tên</label>
                    <input required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300"
                      placeholder="Nguyễn Văn A" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                    <input type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300"
                      placeholder="email@example.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Mật khẩu tạm</label>
                    <input type="password" required minLength={8} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300"
                      placeholder="Tối thiểu 8 ký tự" />
                    <p className="text-xs text-slate-400 mt-1">User nên đổi mật khẩu sau lần đăng nhập đầu</p>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="font-semibold text-slate-800 mb-3">Phân quyền & Team</h3>
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-slate-600">Vai trò</label>
                    {(['super_admin', 'manager', 'member'] as UserRole[]).map(r => (
                      <label key={r} className={cn('flex items-center gap-3 p-3 rounded-md border cursor-pointer transition-colors',
                        form.role === r ? 'border-slate-800 bg-slate-50' : 'border-slate-200 hover:bg-slate-50')}>
                        <input type="radio" name="role" value={r} checked={form.role === r}
                          onChange={() => setForm(f => ({ ...f, role: r, team_id: r === 'super_admin' ? '' : f.team_id, project_ids: [] }))}
                          className="accent-slate-800" />
                        <div>
                          <div className={cn('text-sm font-medium px-1.5 py-0.5 rounded-full inline-block', ROLE_BADGE[r])}>{ROLE_LABEL[r]}</div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {r === 'super_admin' ? 'Toàn quyền hệ thống' : r === 'manager' ? 'Quản lý team và dự án' : 'Xem dự án được giao'}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>

                  {form.role !== 'super_admin' && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Team</label>
                      <select value={form.team_id} onChange={e => setForm(f => ({ ...f, team_id: e.target.value, project_ids: [] }))}
                        className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none">
                        <option value="">— Chưa gán team —</option>
                        {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </div>
                  )}

                  {form.role === 'member' && form.team_id && (
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Giao dự án ({form.project_ids.length} đã chọn)
                      </label>
                      {teamProjects.length === 0 ? (
                        <p className="text-xs text-slate-400 px-2">Team này chưa có dự án nào</p>
                      ) : (
                        <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-md divide-y divide-slate-100">
                          {teamProjects.map(p => (
                            <label key={p.project_id} className={cn('flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors',
                              form.project_ids.includes(p.project_id) ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50 text-slate-700')}>
                              <input type="checkbox" checked={form.project_ids.includes(p.project_id)}
                                onChange={() => setForm(f => ({
                                  ...f,
                                  project_ids: f.project_ids.includes(p.project_id)
                                    ? f.project_ids.filter(id => id !== p.project_id)
                                    : [...f.project_ids, p.project_id]
                                }))} className="accent-blue-600" />
                              <span className="font-mono text-xs text-slate-400 shrink-0">{p.project_id}</span>
                              <span className="truncate">{p.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              {formError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{formError}</p>}

              <div className="flex justify-between pt-2">
                {step === 'role' ? (
                  <Button type="button" variant="outline" onClick={() => setStep('info')}>Quay lại</Button>
                ) : (
                  <Button type="button" variant="outline" onClick={() => { setShowCreate(false); setFormError('') }}>Hủy</Button>
                )}
                <Button type="submit" disabled={saving}>
                  {step === 'info' ? 'Tiếp theo →' : saving ? 'Đang tạo...' : 'Tạo user'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
            <h3 className="font-semibold text-slate-800">Sửa thông tin — {editUser.full_name || editUser.email}</h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Họ tên</label>
              <input value={editForm.full_name} onChange={e => setEditForm(f => ({ ...f, full_name: e.target.value }))}
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email (không thể thay đổi)</label>
              <input value={editUser.email} disabled
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md bg-slate-50 text-slate-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Vai trò</label>
              <select value={editForm.role}
                onChange={e => setEditForm(f => ({ ...f, role: e.target.value as UserRole }))}
                disabled={editUser.user_id === currentUser?.id}
                className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none disabled:bg-slate-50 disabled:text-slate-400">
                <option value="super_admin">Super Admin</option>
                <option value="manager">Manager</option>
                <option value="member">Member</option>
              </select>
            </div>
            {editForm.role !== 'super_admin' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Team</label>
                <select value={editForm.team_id} onChange={e => setEditForm(f => ({ ...f, team_id: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none">
                  <option value="">— Chưa gán team —</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}
            <div className="flex justify-between pt-1">
              <Button variant="outline" size="sm" onClick={handleResetPassword} className="text-xs">
                Reset mật khẩu
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setEditUser(null)}>Hủy</Button>
                <Button onClick={handleSaveEdit} disabled={editSaving}>{editSaving ? 'Đang lưu...' : 'Lưu'}</Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
