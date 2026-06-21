'use client'

import { useState, useEffect } from 'react'
import { Plus, Trash2, UserCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface UserProfile {
  user_id: string
  full_name: string
  role: 'admin' | 'manager' | 'employee'
  email?: string
}

interface Project {
  project_id: string
  name: string
}

export default function AdminPage() {
  const { role } = useAuth()
  const router = useRouter()
  const [users, setUsers] = useState<UserProfile[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [assignments, setAssignments] = useState<Record<string, string[]>>({})
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role: 'employee' as 'manager' | 'employee' })
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [assigningUser, setAssigningUser] = useState<string | null>(null)

  useEffect(() => {
    if (role && role !== 'admin') router.replace('/dashboard')
  }, [role, router])

  useEffect(() => {
    if (role !== 'admin') return
    loadUsers()
    loadProjects()
  }, [role])

  async function loadUsers() {
    const { data } = await supabase.from('user_profiles').select('*').order('role')
    setUsers(data ?? [])
  }

  async function loadProjects() {
    const { data } = await supabase.from('projects').select('project_id, name').order('project_id')
    setProjects(data ?? [])
  }

  async function loadAssignments(userId: string) {
    const { data } = await supabase
      .from('project_assignments')
      .select('project_id')
      .eq('user_id', userId)
    setAssignments(prev => ({
      ...prev,
      [userId]: (data ?? []).map((a: { project_id: string }) => a.project_id)
    }))
    setAssigningUser(userId)
  }

  async function toggleAssignment(userId: string, projectId: string, assigned: boolean) {
    if (assigned) {
      await supabase.from('project_assignments').delete()
        .eq('user_id', userId).eq('project_id', projectId)
      setAssignments(prev => ({ ...prev, [userId]: prev[userId].filter(p => p !== projectId) }))
    } else {
      await supabase.from('project_assignments').insert({ user_id: userId, project_id: projectId })
      setAssignments(prev => ({ ...prev, [userId]: [...(prev[userId] ?? []), projectId] }))
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setError('')

    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { full_name: form.full_name } }
    })

    if (error) { setError(error.message); setCreating(false); return }

    if (data.user && form.role !== 'employee') {
      await supabase.from('user_profiles')
        .update({ role: form.role, full_name: form.full_name })
        .eq('user_id', data.user.id)
    }

    setForm({ email: '', password: '', full_name: '', role: 'employee' })
    setShowCreateForm(false)
    setCreating(false)
    loadUsers()
  }

  const roleLabel = { admin: 'Quản trị', manager: 'Trưởng phòng', employee: 'Nhân viên' }
  const roleBadgeClass = {
    admin: 'bg-purple-100 text-purple-700',
    manager: 'bg-blue-100 text-blue-700',
    employee: 'bg-slate-100 text-slate-600',
  }

  if (role !== 'admin') return null

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Quản trị hệ thống</h2>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý tài khoản và phân công dự án</p>
        </div>
        <Button onClick={() => setShowCreateForm(true)} className="gap-1.5">
          <Plus size={14} /> Tạo tài khoản
        </Button>
      </div>

      {/* Create user form */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-4">Tạo tài khoản mới</h3>
            <form onSubmit={handleCreate} className="space-y-3">
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
                <label className="block text-xs font-medium text-slate-600 mb-1">Mật khẩu</label>
                <input type="password" required minLength={6} value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none focus:ring-2 focus:ring-slate-300"
                  placeholder="Tối thiểu 6 ký tự" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Vai trò</label>
                <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value as 'manager' | 'employee' }))}
                  className="w-full px-3 py-1.5 text-sm border border-slate-200 rounded-md outline-none">
                  <option value="employee">Nhân viên</option>
                  <option value="manager">Trưởng phòng</option>
                </select>
              </div>
              {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{error}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>Hủy</Button>
                <Button type="submit" disabled={creating}>{creating ? 'Đang tạo...' : 'Tạo tài khoản'}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Users table */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Họ tên', 'Vai trò', 'Phân công dự án', ''].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.user_id} className="border-b border-slate-100">
                <td className="px-4 py-3 font-medium text-slate-800">{u.full_name}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleBadgeClass[u.role]}`}>
                    {roleLabel[u.role]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  {u.role === 'employee' ? (
                    assigningUser === u.user_id ? (
                      <span className="text-blue-600">{assignments[u.user_id]?.length ?? 0} dự án</span>
                    ) : '—'
                  ) : 'Tất cả dự án'}
                </td>
                <td className="px-4 py-3">
                  {u.role === 'employee' && (
                    <button
                      onClick={() => assigningUser === u.user_id ? setAssigningUser(null) : loadAssignments(u.user_id)}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                    >
                      <UserCheck size={13} /> Phân công
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Assignment panel */}
      {assigningUser && (
        <div className="border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-slate-700">
              Phân công dự án cho: <strong>{users.find(u => u.user_id === assigningUser)?.full_name}</strong>
            </h3>
            <button onClick={() => setAssigningUser(null)} className="text-xs text-slate-400 hover:text-slate-600">Đóng</button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 max-h-60 overflow-y-auto">
            {projects.map(p => {
              const assigned = (assignments[assigningUser] ?? []).includes(p.project_id)
              return (
                <label key={p.project_id} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs ${assigned ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                  <input
                    type="checkbox"
                    checked={assigned}
                    onChange={() => toggleAssignment(assigningUser, p.project_id, assigned)}
                    className="accent-blue-600"
                  />
                  {p.name}
                </label>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
