'use client'

import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Building2, Users, FolderOpen, X, Check } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import PageHeader from '@/components/ui/PageHeader'

interface Org { id: string; name: string; created_at: string }
interface OrgTeam { id: string; name: string; color: string; organization_id: string | null }
interface OrgAdmin { user_id: string; full_name: string; organization_id: string | null }

export default function OrganizationsPage() {
  const confirmDlg = useConfirm()
  const { user, role, organizationId } = useAuth()
  const router = useRouter()

  const [orgs, setOrgs] = useState<Org[]>([])
  const [teams, setTeams] = useState<OrgTeam[]>([])
  const [admins, setAdmins] = useState<OrgAdmin[]>([])
  const [loading, setLoading] = useState(true)

  async function adminFetch(url: string, options?: RequestInit) {
    const { data: { session } } = await supabase.auth.getSession()
    return fetch(url, {
      ...options,
      headers: { ...options?.headers, 'Authorization': `Bearer ${session?.access_token ?? ''}` },
    })
  }

  const [newOrgName, setNewOrgName] = useState('')
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  // Guard: only global SA (organizationId === null) can manage orgs
  useEffect(() => {
    if (role && (role !== 'super_admin' || organizationId !== null)) router.replace('/dashboard')
  }, [role, organizationId, router])

  useEffect(() => {
    if (role !== 'super_admin' || organizationId !== null) return
    loadAll()
  }, [role, organizationId])

  async function loadAll() {
    setLoading(true)
    const [{ data: orgsData }, { data: teamsData }, { data: adminsData }] = await Promise.all([
      supabase.from('organizations').select('*').order('created_at'),
      supabase.from('teams').select('id, name, color, organization_id').order('name'),
      supabase.from('user_profiles').select('user_id, full_name, organization_id').eq('role', 'super_admin'),
    ])
    setOrgs(orgsData ?? [])
    setTeams(teamsData ?? [])
    setAdmins(adminsData ?? [])
    setLoading(false)
  }

  async function createOrg() {
    if (!newOrgName.trim()) return
    setCreating(true)
    const { data, error } = await supabase
      .from('organizations')
      .insert({ name: newOrgName.trim() })
      .select()
      .single()
    if (error) { toast.error('Không thể tạo tổ chức'); setCreating(false); return }
    setOrgs(prev => [...prev, data])
    setNewOrgName('')
    toast.success('Đã tạo tổ chức')
    setCreating(false)
  }

  async function saveEditOrg(id: string) {
    if (!editName.trim()) return
    const { error } = await supabase.from('organizations').update({ name: editName.trim() }).eq('id', id)
    if (error) { toast.error('Không thể cập nhật'); return }
    setOrgs(prev => prev.map(o => o.id === id ? { ...o, name: editName.trim() } : o))
    setEditingId(null)
    toast.success('Đã cập nhật')
  }

  async function deleteOrg(org: Org) {
    const orgTeams = teams.filter(t => t.organization_id === org.id)
    const orgAdmins = admins.filter(a => a.organization_id === org.id)
    if (orgTeams.length > 0 || orgAdmins.length > 0) {
      toast.error('Vui lòng bỏ gán toàn bộ teams và admins trước khi xóa tổ chức')
      return
    }
    if (!(await confirmDlg({ title: `Xóa tổ chức "${org.name}"?` }))) return
    const { error } = await supabase.from('organizations').delete().eq('id', org.id)
    if (error) { toast.error('Không thể xóa'); return }
    setOrgs(prev => prev.filter(o => o.id !== org.id))
    toast.success('Đã xóa tổ chức')
  }

  async function assignTeam(teamId: string, orgId: string | null) {
    const res = await adminFetch('/api/admin/assign-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'team', id: teamId, organization_id: orgId }),
    })
    if (!res.ok) { toast.error('Không thể gán team'); return }
    setTeams(prev => prev.map(t => t.id === teamId ? { ...t, organization_id: orgId } : t))
  }

  async function assignAdmin(userId: string, orgId: string | null) {
    const res = await adminFetch('/api/admin/assign-org', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', id: userId, organization_id: orgId }),
    })
    if (!res.ok) { toast.error('Không thể gán admin'); return }
    setAdmins(prev => prev.map(a => a.user_id === userId ? { ...a, organization_id: orgId } : a))
    toast.success('Đã gán admin')
  }

  if (role !== 'super_admin' || organizationId !== null) return null
  if (loading) return <div className="p-6 text-sm text-slate-400">Đang tải...</div>

  const unassignedTeams = teams.filter(t => !t.organization_id)
  const unassignedAdmins = admins.filter(a => !a.organization_id && a.user_id !== user?.id)

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <PageHeader
        title="Quản lý Tổ chức"
        subtitle={`${orgs.length} tổ chức · ${unassignedTeams.length} team chưa phân nhóm · ${unassignedAdmins.length} admin chưa phân nhóm`}
      />

      {/* Create org */}
      <div className="flex gap-2">
        <input
          value={newOrgName}
          onChange={e => setNewOrgName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createOrg()}
          placeholder="Tên tổ chức mới..."
          className="flex-1 max-w-sm px-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-300"
        />
        <Button onClick={createOrg} disabled={creating || !newOrgName.trim()} className="gap-1.5">
          <Plus size={14} /> Tạo tổ chức
        </Button>
      </div>

      {/* Org list */}
      {orgs.length === 0 ? (
        <div className="py-12 text-center text-slate-400">
          <Building2 size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Chưa có tổ chức nào. Tạo tổ chức đầu tiên!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orgs.map(org => {
            const orgTeams  = teams.filter(t => t.organization_id === org.id)
            const orgAdmins = admins.filter(a => a.organization_id === org.id)
            const availableTeams  = unassignedTeams
            const availableAdmins = unassignedAdmins

            return (
              <div key={org.id} className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                {/* Org header */}
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
                  <Building2 size={14} className="text-slate-500 shrink-0" />
                  {editingId === org.id ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEditOrg(org.id); if (e.key === 'Escape') setEditingId(null) }}
                        className="flex-1 max-w-xs px-2 py-1 text-sm border border-blue-300 rounded outline-none focus:ring-1 focus:ring-blue-300"
                      />
                      <button onClick={() => saveEditOrg(org.id)} className="p-1 text-green-600 hover:text-green-700"><Check size={14} /></button>
                      <button onClick={() => setEditingId(null)} className="p-1 text-slate-400 hover:text-slate-600"><X size={14} /></button>
                    </div>
                  ) : (
                    <>
                      <span className="font-semibold text-slate-800 flex-1">{org.name}</span>
                      <span className="text-xs text-slate-400">{orgTeams.length} teams · {orgAdmins.length} admins</span>
                      <button onClick={() => { setEditingId(org.id); setEditName(org.name) }}
                        className="p-1 text-slate-400 hover:text-slate-700"><Pencil size={13} /></button>
                      <button onClick={() => deleteOrg(org)}
                        className="p-1 text-slate-400 hover:text-red-500"><Trash2 size={13} /></button>
                    </>
                  )}
                </div>

                <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Teams */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <FolderOpen size={11} /> Teams
                    </p>
                    <div className="space-y-1.5 mb-2">
                      {orgTeams.map(t => (
                        <div key={t.id} className="flex items-center gap-2 text-sm">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: t.color }} />
                          <span className="flex-1 text-slate-700">{t.name}</span>
                          <button onClick={() => assignTeam(t.id, null)}
                            className="text-xs text-slate-400 hover:text-red-500 transition-colors">Bỏ gán</button>
                        </div>
                      ))}
                      {orgTeams.length === 0 && <p className="text-xs text-slate-400 italic">Chưa có team</p>}
                    </div>
                    {availableTeams.length > 0 && (
                      <select
                        className="w-full px-2 py-1.5 text-xs border border-dashed border-slate-300 rounded-md outline-none text-slate-500"
                        value=""
                        onChange={e => { if (e.target.value) assignTeam(e.target.value, org.id) }}
                      >
                        <option value="">+ Gán team vào đây...</option>
                        {availableTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    )}
                  </div>

                  {/* Admins */}
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                      <Users size={11} /> Admins
                    </p>
                    <div className="space-y-1.5 mb-2">
                      {orgAdmins.map(a => (
                        <div key={a.user_id} className="flex items-center gap-2 text-sm">
                          <span className="flex-1 text-slate-700">{a.full_name}</span>
                          <button onClick={() => assignAdmin(a.user_id, null)}
                            className="text-xs text-slate-400 hover:text-red-500 transition-colors">Bỏ gán</button>
                        </div>
                      ))}
                      {orgAdmins.length === 0 && <p className="text-xs text-slate-400 italic">Chưa có admin</p>}
                    </div>
                    {availableAdmins.length > 0 && (
                      <select
                        className="w-full px-2 py-1.5 text-xs border border-dashed border-slate-300 rounded-md outline-none text-slate-500"
                        value=""
                        onChange={e => { if (e.target.value) assignAdmin(e.target.value, org.id) }}
                      >
                        <option value="">+ Gán admin vào đây...</option>
                        {availableAdmins.map(a => <option key={a.user_id} value={a.user_id}>{a.full_name}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Unassigned section */}
      {(unassignedTeams.length > 0 || unassignedAdmins.length > 0) && (
        <div className="border border-dashed border-slate-300 rounded-lg p-4 bg-slate-50 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Chưa phân nhóm</p>
          {unassignedTeams.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {unassignedTeams.map(t => (
                <span key={t.id} className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-white border border-slate-200 text-slate-600')}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
                  {t.name}
                </span>
              ))}
            </div>
          )}
          {unassignedAdmins.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {unassignedAdmins.map(a => (
                <span key={a.user_id} className="px-2.5 py-1 rounded-full text-xs bg-white border border-slate-200 text-slate-600">
                  {a.full_name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
