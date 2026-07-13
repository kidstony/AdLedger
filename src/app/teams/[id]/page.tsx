'use client'

import { useState, useEffect, use } from 'react'
import { ArrowLeft, Plus, Trash2, FolderOpen, Crown, LayoutGrid, Users, X } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import AccessMatrix from '@/components/team/AccessMatrix'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import PageHeader from '@/components/ui/PageHeader'
import TabBar from '@/components/ui/TabBar'

interface Member { user_id: string; full_name: string; role: string }
interface TeamProject { project_id: string; name: string }
interface TeamDetail {
  id: string; name: string; color: string
  members: Member[]
  projects: TeamProject[]
}

const BLANK_CREATE = { full_name: '', email: '', password: '' }

export default function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const confirmDlg = useConfirm()
  const { id } = use(params)
  const { role, teamId: myTeamId } = useAuth()
  const router = useRouter()

  const [team, setTeam] = useState<TeamDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'members' | 'projects' | 'matrix'>('members')

  const [allUsers, setAllUsers] = useState<{ user_id: string; full_name: string; team_id: string | null }[]>([])
  const [allProjects, setAllProjects] = useState<{ project_id: string; name: string; team_id: string | null }[]>([])
  const [addMemberVal, setAddMemberVal] = useState('')
  const [addProjectVal, setAddProjectVal] = useState('')

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({ ...BLANK_CREATE })
  const [createSaving, setCreateSaving] = useState(false)

  const isAdmin = role === 'super_admin'
  const canAccess = role === 'super_admin' || (role === 'manager' && myTeamId === id)

  async function adminFetch(url: string, options?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    return fetch(url, {
      ...options,
      headers: { ...options?.headers, 'Authorization': `Bearer ${session?.access_token ?? ''}` },
    })
  }

  useEffect(() => {
    if (role && !canAccess) router.replace('/dashboard')
  }, [role, myTeamId])

  useEffect(() => {
    if (!canAccess) return
    loadTeam()
    if (isAdmin) {
      supabase.from('user_profiles').select('user_id, full_name, team_id').then(r => setAllUsers(r.data ?? []))
      supabase.from('projects').select('project_id, name, team_id').order('project_id').then(r => setAllProjects(r.data ?? []))
    }
  }, [role, myTeamId, id])

  async function loadTeam() {
    setLoading(true)
    const res = await adminFetch(`/api/teams/${id}`)
    if (res.ok) setTeam(await res.json())
    else router.replace('/teams')
    setLoading(false)
  }

  const unassignedUsers = allUsers.filter(u => !u.team_id || u.team_id === id ? false : true).concat(
    allUsers.filter(u => !u.team_id)
  )
  const unassignedProjects = allProjects.filter(p => !p.team_id)

  async function addMember() {
    if (!addMemberVal) return
    const res = await adminFetch(`/api/teams/${id}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: addMemberVal }),
    })
    if (res.ok) {
      const added = allUsers.find(u => u.user_id === addMemberVal)
      if (added) setTeam(t => t ? { ...t, members: [...t.members, { user_id: added.user_id, full_name: added.full_name, role: 'member' }] } : t)
      setAddMemberVal('')
      toast.success('Đã thêm thành viên')
    } else {
      toast.error('Không thể thêm thành viên')
    }
  }

  async function createMember() {
    if (!createForm.full_name || !createForm.email || !createForm.password) return
    setCreateSaving(true)
    const res = await adminFetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...createForm, role: 'member', team_id: id }),
    })
    if (res.ok) {
      toast.success('Đã tạo thành viên mới')
      setShowCreate(false)
      setCreateForm({ ...BLANK_CREATE })
      loadTeam()
    } else {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? 'Không thể tạo thành viên')
    }
    setCreateSaving(false)
  }

  async function removeMember(userId: string) {
    if (!(await confirmDlg({ title: 'Xóa thành viên này khỏi team?' }))) return
    const res = await adminFetch(`/api/teams/${id}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    if (res.ok) {
      setTeam(t => t ? { ...t, members: t.members.filter(m => m.user_id !== userId) } : t)
      toast.success('Đã xóa khỏi team')
    } else {
      toast.error('Không thể xóa')
    }
  }

  async function assignProject() {
    if (!addProjectVal) return
    const res = await adminFetch(`/api/teams/${id}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: addProjectVal }),
    })
    if (res.ok) {
      const added = allProjects.find(p => p.project_id === addProjectVal)
      if (added) setTeam(t => t ? { ...t, projects: [...t.projects, { project_id: added.project_id, name: added.name }] } : t)
      setAddProjectVal('')
      toast.success('Đã gán dự án')
    } else {
      toast.error('Không thể gán dự án')
    }
  }

  async function unassignProject(projectId: string) {
    if (!(await confirmDlg({ title: 'Bỏ gán dự án này khỏi team?', confirmLabel: 'Bỏ gán' }))) return
    const res = await adminFetch(`/api/teams/${id}/projects`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId }),
    })
    if (res.ok) {
      setTeam(t => t ? { ...t, projects: t.projects.filter(p => p.project_id !== projectId) } : t)
      toast.success('Đã bỏ gán')
    } else {
      toast.error('Không thể bỏ gán')
    }
  }

  if (!canAccess) return null
  if (loading) return <div className="p-6 text-sm text-slate-400">Đang tải...</div>
  if (!team) return null

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        backHref={isAdmin ? '/teams' : '/dashboard'}
        title={
          <span className="flex items-center gap-2">
            <span className="w-4 h-4 rounded-full shrink-0" style={{ backgroundColor: team.color }} />
            {team.name}
          </span>
        }
        subtitle={`${team.members.length} thành viên · ${team.projects.length} dự án`}
      />

      {/* Tab bar */}
      <TabBar
        tabs={[
          { key: 'members', label: <span className="flex items-center gap-1.5"><Users size={14} /> Thành viên</span> },
          { key: 'projects', label: <span className="flex items-center gap-1.5"><FolderOpen size={14} /> Dự án</span> },
          { key: 'matrix', label: <span className="flex items-center gap-1.5"><LayoutGrid size={14} /> Ma trận phân quyền</span> },
        ]}
        active={activeTab}
        onChange={k => setActiveTab(k as 'members' | 'projects' | 'matrix')}
      />

      {/* Tab: Thành viên */}
      {activeTab === 'members' && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Users size={14} /> Thành viên ({team.members.length})
            </h3>
            {!isAdmin && (
              <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1 h-7 text-xs">
                <Plus size={12} /> Thêm thành viên
              </Button>
            )}
          </div>

          <div className="divide-y divide-slate-100">
            {team.members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-2">
                  {m.role === 'manager'
                    ? <Crown size={13} className="text-amber-500 shrink-0" />
                    : <span className="w-3.5 h-3.5 shrink-0" />
                  }
                  <div>
                    <p className="text-sm font-medium text-slate-800">{m.full_name || '—'}</p>
                    <p className="text-xs text-slate-400">{m.role === 'manager' ? 'Manager' : 'Member'}</p>
                  </div>
                </div>
                {(isAdmin || m.role !== 'manager') && (
                  <button onClick={() => removeMember(m.user_id)}
                    className="p-1 text-slate-400 hover:text-red-500 transition-colors">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
            {team.members.length === 0 && (
              <p className="px-4 py-6 text-sm text-slate-400 text-center">Chưa có thành viên</p>
            )}
          </div>

          {isAdmin && (
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex gap-2">
              <select value={addMemberVal} onChange={e => setAddMemberVal(e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-md outline-none">
                <option value="">Chọn user để thêm...</option>
                {unassignedUsers.map(u => (
                  <option key={u.user_id} value={u.user_id}>{u.full_name}</option>
                ))}
              </select>
              <Button size="sm" onClick={addMember} disabled={!addMemberVal} className="gap-1">
                <Plus size={12} /> Thêm
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Tab: Dự án */}
      {activeTab === 'projects' && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <FolderOpen size={14} /> Dự án ({team.projects.length})
            </h3>
          </div>

          <div className="divide-y divide-slate-100">
            {team.projects.map(p => (
              <div key={p.project_id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-xs font-mono text-slate-400">{p.project_id}</p>
                  <p className="text-sm text-slate-800">{p.name}</p>
                </div>
                {isAdmin && (
                  <button onClick={() => unassignProject(p.project_id)}
                    className="p-1 text-slate-400 hover:text-red-500 transition-colors">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
            {team.projects.length === 0 && (
              <p className="px-4 py-6 text-sm text-slate-400 text-center">Chưa có dự án</p>
            )}
          </div>

          {isAdmin && (
            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex gap-2">
              <select value={addProjectVal} onChange={e => setAddProjectVal(e.target.value)}
                className="flex-1 px-2 py-1.5 text-sm border border-slate-200 rounded-md outline-none">
                <option value="">Chọn dự án để gán...</option>
                {unassignedProjects.map(p => (
                  <option key={p.project_id} value={p.project_id}>{p.project_id} · {p.name}</option>
                ))}
              </select>
              <Button size="sm" onClick={assignProject} disabled={!addProjectVal} className="gap-1">
                <Plus size={12} /> Gán
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Tab: Ma trận phân quyền */}
      {activeTab === 'matrix' && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <AccessMatrix teamId={id} />
        </div>
      )}

      {/* Modal tạo thành viên mới (Manager only) */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">Thêm thành viên mới</h3>
              <button onClick={() => { setShowCreate(false); setCreateForm({ ...BLANK_CREATE }) }}
                className="p-1 rounded hover:bg-slate-100 text-slate-400">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Họ tên</label>
                <input
                  type="text"
                  value={createForm.full_name}
                  onChange={e => setCreateForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Nguyễn Văn A"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input
                  type="email"
                  value={createForm.email}
                  onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="email@example.com"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mật khẩu</label>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => { setShowCreate(false); setCreateForm({ ...BLANK_CREATE }) }}
              >
                Hủy
              </Button>
              <Button
                className="flex-1"
                onClick={createMember}
                disabled={createSaving || !createForm.full_name || !createForm.email || !createForm.password}
              >
                {createSaving ? 'Đang tạo...' : 'Tạo thành viên'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
