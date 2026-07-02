'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { MasterProject } from '@/lib/types'
import { useAuth } from '@/context/AuthContext'

interface MasterProjectsContextValue {
  masterProjects: MasterProject[]
  isLoading: boolean
  addMasterProject: (mp: Omit<MasterProject, 'created_at'>) => Promise<void>
  updateMasterProject: (mp: MasterProject) => Promise<void>
  deleteMasterProject: (id: string) => Promise<void>
}

const MasterProjectsContext = createContext<MasterProjectsContextValue | null>(null)

export function MasterProjectsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [masterProjects, setMasterProjects] = useState<MasterProject[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user) { setMasterProjects([]); setIsLoading(false); return }
    load()
  }, [user?.id])

  async function load() {
    setIsLoading(true)
    const token = await getToken()
    if (!token) { setMasterProjects([]); setIsLoading(false); return }
    const res = await fetch('/api/master-projects', { headers: { Authorization: `Bearer ${token}` } })
    if (res.ok) setMasterProjects(await res.json())
    setIsLoading(false)
  }

  async function getToken(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  async function addMasterProject(mp: Omit<MasterProject, 'created_at'>) {
    const token = await getToken()
    if (!token) return
    const res = await fetch('/api/master-projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: mp.name }),
    })
    if (!res.ok) { console.error(await res.text()); return }
    const data: MasterProject = await res.json()
    setMasterProjects(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
  }

  async function updateMasterProject(mp: MasterProject) {
    setMasterProjects(prev => prev.map(x => x.id === mp.id ? mp : x))
    const token = await getToken()
    if (!token) { load(); return }
    const res = await fetch(`/api/master-projects/${mp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: mp.name }),
    })
    if (!res.ok) { console.error(await res.text()); load() }
  }

  async function deleteMasterProject(id: string) {
    await supabase.from('projects').update({ master_project_id: null }).eq('master_project_id', id)
    setMasterProjects(prev => prev.filter(x => x.id !== id))
    const { error } = await supabase.from('master_projects').delete().eq('id', id)
    if (error) { console.error(error); load() }
  }

  return (
    <MasterProjectsContext.Provider value={{ masterProjects, isLoading, addMasterProject, updateMasterProject, deleteMasterProject }}>
      {children}
    </MasterProjectsContext.Provider>
  )
}

export function useMasterProjectsContext(): MasterProjectsContextValue {
  const ctx = useContext(MasterProjectsContext)
  if (!ctx) throw new Error('useMasterProjectsContext must be used within MasterProjectsProvider')
  return ctx
}
