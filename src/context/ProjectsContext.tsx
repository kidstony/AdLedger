'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { MOCK_PROJECTS } from '@/lib/mock-data'
import { Project, ShareAccessLevel } from '@/lib/types'

interface ProjectsContextValue {
  projects: Project[]
  isLoading: boolean
  addProject: (p: Project) => Promise<string | null>
  updateProject: (p: Project) => Promise<string | null>
  deleteProject: (id: string) => Promise<void>
  deleteProjects: (ids: string[]) => Promise<void>
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { user, role } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user) { setProjects([]); setIsLoading(false); return }

    if (role === 'super_admin' || role === 'manager') loadAllProjects()
    else if (role === 'member') loadAssignedProjects(user.id)
  }, [user, role])

  async function loadAllProjects() {
    setIsLoading(true)
    const { data, error } = await supabase
      .from('projects').select('*, bank_accounts(*, banks(*))').order('project_id')

    if (error) { console.error('Lỗi tải dự án:', error); setIsLoading(false); return }

    let projectList = data as Project[]

    if (projectList.length === 0) {
      const { data: seeded, error: seedError } = await supabase
        .from('projects').insert(MOCK_PROJECTS).select('*, bank_accounts(*, banks(*))')
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
    const { data: assignments } = await supabase
      .from('project_shares')
      .select('project_id, access_level')
      .eq('user_id', userId)

    type Assignment = { project_id: string; access_level: string }
    const rows = (assignments ?? []) as Assignment[]
    const ids = rows.map(a => a.project_id)
    const accessMap = new Map(rows.map(a => [a.project_id, a.access_level as ShareAccessLevel]))

    if (ids.length === 0) { setProjects([]); setIsLoading(false); return }

    const { data, error } = await supabase
      .from('projects').select('*, bank_accounts(*, banks(*))').in('project_id', ids).order('project_id')

    if (error) console.error('Lỗi tải dự án được phân công:', error)
    else setProjects((data as Project[]).map(p => ({
      ...p,
      share_access_level: accessMap.get(p.project_id) ?? null,
    })))
    setIsLoading(false)
  }

  async function addProject(p: Project): Promise<string | null> {
    setProjects(prev => [...prev, p])
    const { error } = await supabase.from('projects').insert({
      project_id: p.project_id,
      cid: p.cid,
      name: p.name,
      mcc_id: p.mcc_id,
      master_project_id: p.master_project_id ?? null,
      screen_revenue_type: p.screen_revenue_type ?? 'daily',
      ref_link: p.ref_link ?? null,
      email_ref: p.email_ref ?? null,
      bank_account_id: p.bank_account_id ?? null,
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
      })
      .eq('project_id', updated.project_id)
    if (error) {
      console.error('Lỗi cập nhật dự án:', error)
      const { data } = await supabase.from('projects').select('*, bank_accounts(*, banks(*))').order('project_id')
      if (data) setProjects(data as Project[])
      return error.message
    }
    return null
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
    <ProjectsContext.Provider value={{ projects, isLoading, addProject, updateProject, deleteProject, deleteProjects }}>
      {children}
    </ProjectsContext.Provider>
  )
}

export function useProjectsContext(): ProjectsContextValue {
  const ctx = useContext(ProjectsContext)
  if (!ctx) throw new Error('useProjectsContext must be used within ProjectsProvider')
  return ctx
}
