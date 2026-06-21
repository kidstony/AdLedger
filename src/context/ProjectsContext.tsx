'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/context/AuthContext'
import { MOCK_PROJECTS } from '@/lib/mock-data'
import { Project } from '@/lib/types'

interface ProjectsContextValue {
  projects: Project[]
  isLoading: boolean
  addProject: (p: Project) => Promise<void>
  updateProject: (p: Project) => Promise<void>
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

    if (role === 'manager') loadAllProjects()
    else if (role === 'employee') loadAssignedProjects(user.id)
  }, [user, role])

  async function loadAllProjects() {
    setIsLoading(true)
    const { data, error } = await supabase
      .from('projects').select('*').order('project_id')

    if (error) { console.error('Lỗi tải dự án:', error); setIsLoading(false); return }

    if (data.length === 0) {
      const { data: seeded, error: seedError } = await supabase
        .from('projects').insert(MOCK_PROJECTS).select()
      if (seedError) console.error('Lỗi seed data:', seedError)
      else setProjects(seeded ?? [])
    } else {
      setProjects(data as Project[])
    }
    setIsLoading(false)
  }

  async function loadAssignedProjects(userId: string) {
    setIsLoading(true)
    const { data: assignments } = await supabase
      .from('project_assignments')
      .select('project_id')
      .eq('user_id', userId)

    const ids = (assignments ?? []).map((a: { project_id: string }) => a.project_id)

    if (ids.length === 0) { setProjects([]); setIsLoading(false); return }

    const { data, error } = await supabase
      .from('projects').select('*').in('project_id', ids).order('project_id')

    if (error) console.error('Lỗi tải dự án được phân công:', error)
    else setProjects(data as Project[])
    setIsLoading(false)
  }

  async function addProject(p: Project) {
    setProjects(prev => [...prev, p])
    const { error } = await supabase.from('projects').insert(p)
    if (error) {
      console.error('Lỗi thêm dự án:', error)
      setProjects(prev => prev.filter(x => x.project_id !== p.project_id))
    }
  }

  async function updateProject(updated: Project) {
    setProjects(prev => prev.map(p => p.project_id === updated.project_id ? updated : p))
    const { error } = await supabase
      .from('projects')
      .update({ cid: updated.cid, name: updated.name, mcc_id: updated.mcc_id })
      .eq('project_id', updated.project_id)
    if (error) {
      console.error('Lỗi cập nhật dự án:', error)
      const { data } = await supabase.from('projects').select('*').order('project_id')
      if (data) setProjects(data as Project[])
    }
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
