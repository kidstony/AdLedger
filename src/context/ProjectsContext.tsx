'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { MOCK_PROJECTS } from '@/lib/mock-data'
import { Project, ShareAccessLevel, SharePermissions, SharePermissionId, ACCESS_LEVEL_DEFAULTS } from '@/lib/types'

interface ProjectsContextValue {
  projects: Project[]
  isLoading: boolean
  addProject: (p: Project) => Promise<string | null>
  updateProject: (p: Project) => Promise<string | null>
  patchProjectLocal: (p: Project) => void
  deleteProject: (id: string) => Promise<void>
  deleteProjects: (ids: string[]) => Promise<void>
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { user, role, teamId } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user) { setProjects([]); setIsLoading(false); return }

    if (role === 'super_admin') loadAllProjects()
    else if (role === 'manager') loadManagerProjects()
    else if (role === 'member') loadAssignedProjects(user.id)
  }, [user, role, teamId])

  async function loadManagerProjects() {
    if (!teamId) {
      setProjects([])
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    const { data, error } = await supabase
      .from('projects')
      .select('*, bank_accounts(*, banks(*)), category:project_categories(id, name, color)')
      .eq('team_id', teamId)
      .order('project_id')

    if (error) { console.error('Lỗi tải dự án team:', error); setIsLoading(false); return }
    setProjects((data ?? []) as Project[])
    setIsLoading(false)
  }

  async function loadAllProjects() {
    setIsLoading(true)
    const { data, error } = await supabase
      .from('projects').select('*, bank_accounts(*, banks(*)), category:project_categories(id, name, color)').order('project_id')

    if (error) { console.error('Lỗi tải dự án:', error); setIsLoading(false); return }

    let projectList = data as Project[]

    if (projectList.length === 0) {
      const { data: seeded, error: seedError } = await supabase
        .from('projects').insert(MOCK_PROJECTS).select('*, bank_accounts(*, banks(*)), category:project_categories(id, name, color)')
      if (seedError) console.error('Lỗi seed data:', seedError)
      else projectList = seeded as Project[] ?? []
    }

    // Enrich cid from campaign_discoveries so stale '0000000000' is overridden
    // 8s timeout so setProjects is always called even if route is slow
    try {
      const controller = new AbortController()
      const tid = setTimeout(() => controller.abort(), 8000)
      const cidRes = await fetch('/api/integrations/campaigns', { signal: controller.signal })
      clearTimeout(tid)
      if (cidRes.ok) {
        const campaigns: Array<{ project_id: string | null; customer_id: string }> = await cidRes.json().catch(() => [])
        if (Array.isArray(campaigns)) {
          const cidByProjectId = new Map(
            campaigns.filter(c => c.project_id && c.customer_id).map(c => [c.project_id!, c.customer_id])
          )
          projectList = projectList.map(p => {
            const realCid = cidByProjectId.get(p.project_id)
            return realCid ? { ...p, cid: realCid } : p
          })
        }
      }
    } catch { /* timeout or network error — setProjects still runs below */ }

    setProjects(projectList)
    setIsLoading(false)
  }

  async function loadAssignedProjects(userId: string) {
    setIsLoading(true)

    // Fetch both sources in parallel: explicit shares + person_in_charge assignments
    const [sharesRes, ownedRes] = await Promise.all([
      supabase.from('project_shares').select('id, project_id, access_level').eq('user_id', userId),
      supabase.from('projects').select('project_id').eq('person_in_charge', userId),
    ])

    type Assignment = { id: string; project_id: string; access_level: string }
    const rows = (sharesRes.data ?? []) as Assignment[]
    const shareIdSet = new Set(rows.map(a => a.project_id))
    const shareIds = rows.map(a => a.id)
    const accessMap = new Map(rows.map(a => [a.project_id, { shareId: a.id, level: a.access_level as ShareAccessLevel }]))

    // Projects from person_in_charge not already in project_shares → add with 'editor' level
    const ownedIds = ((ownedRes.data ?? []) as { project_id: string }[])
      .map(p => p.project_id)
      .filter(id => !shareIdSet.has(id))
    for (const id of ownedIds) {
      accessMap.set(id, { shareId: '', level: 'viewer' })
    }

    const allIds = [...shareIdSet, ...ownedIds]
    if (allIds.length === 0) { setProjects([]); setIsLoading(false); return }

    // Fetch custom permission overrides (only for explicit project_shares entries)
    const { data: customPerms } = shareIds.length > 0
      ? await supabase.from('project_share_permissions').select('share_id, permission_id, granted').in('share_id', shareIds)
      : { data: [] }

    type CustomPerm = { share_id: string; permission_id: string; granted: boolean }
    const permsByShareId = new Map<string, Map<string, boolean>>()
    for (const cp of (customPerms ?? []) as CustomPerm[]) {
      if (!permsByShareId.has(cp.share_id)) permsByShareId.set(cp.share_id, new Map())
      permsByShareId.get(cp.share_id)!.set(cp.permission_id, cp.granted)
    }

    const { data, error } = await supabase
      .from('projects').select('*, bank_accounts(*, banks(*)), category:project_categories(id, name, color)').in('project_id', allIds).order('project_id')

    if (error) console.error('Lỗi tải dự án được phân công:', error)
    else setProjects((data as Project[]).map(p => {
      const info = accessMap.get(p.project_id)
      const level = info?.level ?? 'viewer'
      const overrides = permsByShareId.get(info?.shareId ?? '') ?? new Map()
      const defaults = ACCESS_LEVEL_DEFAULTS[level]
      const effective: SharePermissions = { ...defaults }
      for (const pid of Object.keys(defaults) as SharePermissionId[]) {
        if (overrides.has(pid)) effective[pid] = overrides.get(pid)!
      }
      return { ...p, share_access_level: level, effective_permissions: effective }
    }))
    setIsLoading(false)
  }

  async function addProject(p: Project): Promise<string | null> {
    setProjects(prev => [...prev, p])
    const { error } = await supabase.from('projects').insert({
      project_id: p.project_id,
      cid: p.cid,
      name: p.name,
      mcc_id: p.mcc_id,
      team_id: teamId ?? null,
      master_project_id: p.master_project_id ?? null,
      screen_revenue_type: p.screen_revenue_type ?? 'daily',
      ref_link: p.ref_link ?? null,
      email_ref: p.email_ref ?? null,
      bank_account_id: p.bank_account_id ?? null,
      // Camp Manager fields
      category_id: p.category_id ?? null,
      affiliate_url: p.affiliate_url ?? null,
      affiliate_username: p.affiliate_username ?? null,
      affiliate_password: p.affiliate_password ?? null,
      affiliate_network: p.affiliate_network ?? null,
      statuses: p.statuses ?? [],
      camp_start_date: p.camp_start_date ?? null,
      person_in_charge: p.person_in_charge ?? null,
      note: p.note ?? null,
      created_by: user?.id ?? null,
      // Attribution: tách chi phí QC theo link ref
      attribution_type: p.attribution_type ?? 'campaign',
      attribution_device: p.attribution_device ?? null,
      attribution_ad_group_id: p.attribution_ad_group_id ?? null,
      attribution_from: p.attribution_from ?? null,
      attribution_to: p.attribution_to ?? null,
      attribution_weight: p.attribution_weight ?? null,
    })
    if (error) {
      console.error('Lỗi thêm dự án:', error)
      setProjects(prev => prev.filter(x => x.project_id !== p.project_id))
      return error.message
    }
    return null
  }

  async function updateProject(updated: Project): Promise<string | null> {
    setProjects(prev => prev.map(p => p.project_id === updated.project_id ? updated : p))
    const { error } = await supabase
      .from('projects')
      .update({
        cid: updated.cid,
        name: updated.name,
        mcc_id: updated.mcc_id,
        master_project_id: updated.master_project_id ?? null,
        screen_revenue_type: updated.screen_revenue_type ?? 'daily',
        ref_link: updated.ref_link ?? null,
        email_ref: updated.email_ref ?? null,
        bank_account_id: updated.bank_account_id ?? null,
        // Camp Manager fields
        category_id: updated.category_id ?? null,
        affiliate_url: updated.affiliate_url ?? null,
        affiliate_username: updated.affiliate_username ?? null,
        affiliate_password: updated.affiliate_password ?? null,
        affiliate_network: updated.affiliate_network ?? null,
        statuses: updated.statuses ?? [],
        camp_start_date: updated.camp_start_date ?? null,
        person_in_charge: updated.person_in_charge ?? null,
        note: updated.note ?? null,
        // Attribution: tách chi phí QC theo link ref
        attribution_type: updated.attribution_type ?? 'campaign',
        attribution_device: updated.attribution_device ?? null,
        attribution_ad_group_id: updated.attribution_ad_group_id ?? null,
        attribution_from: updated.attribution_from ?? null,
        attribution_to: updated.attribution_to ?? null,
        attribution_weight: updated.attribution_weight ?? null,
      })
      .eq('project_id', updated.project_id)
    if (error) {
      console.error('Lỗi cập nhật dự án:', error)
      const { data } = await supabase.from('projects').select('*, bank_accounts(*, banks(*)), category:project_categories(id, name, color)').order('project_id')
      if (data) setProjects(data as Project[])
      return error.message
    }
    return null
  }

  function patchProjectLocal(updated: Project) {
    setProjects(prev => prev.map(p => p.project_id === updated.project_id ? updated : p))
  }

  async function deleteProject(id: string) {
    setProjects(prev => prev.filter(p => p.project_id !== id))
    const { error } = await supabase.from('projects').delete().eq('project_id', id)
    if (error) {
      console.error('Lỗi xóa dự án:', error)
      const { data } = await supabase.from('projects').select('*').order('project_id')
      if (data) setProjects(data as Project[])
    }
  }

  async function deleteProjects(ids: string[]) {
    const idSet = new Set(ids)
    setProjects(prev => prev.filter(p => !idSet.has(p.project_id)))
    const { error } = await supabase.from('projects').delete().in('project_id', ids)
    if (error) {
      console.error('Lỗi xóa nhiều dự án:', error)
      const { data } = await supabase.from('projects').select('*').order('project_id')
      if (data) setProjects(data as Project[])
    }
  }

  return (
    <ProjectsContext.Provider value={{ projects, isLoading, addProject, updateProject, patchProjectLocal, deleteProject, deleteProjects }}>
      {children}
    </ProjectsContext.Provider>
  )
}

export function useProjectsContext(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext)
  if (!ctx) throw new Error('useProjectsContext must be used within ProjectsProvider')
  return ctx
}
