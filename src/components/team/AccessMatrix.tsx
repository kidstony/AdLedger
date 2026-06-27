'use client'

import { useState, useEffect, useMemo } from 'react'
import { Users, FolderOpen } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import MemberAccessView from './MemberAccessView'
import ProjectAccessView from './ProjectAccessView'
import { MatrixMember, MatrixProject, MatrixShare } from './MemberProjectList'

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? ''
}

export default function AccessMatrix({ teamId }: { teamId: string }) {
  const { user } = useAuth()
  const [members, setMembers]   = useState<MatrixMember[]>([])
  const [projects, setProjects] = useState<MatrixProject[]>([])
  const [shares, setShares]     = useState<MatrixShare[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'member' | 'project'>('member')

  const visibleMembers = useMemo(
    () => members.filter(m => m.user_id !== user?.id),
    [members, user?.id]
  )

  async function load() {
    setIsLoading(true)
    const token = await getToken()
    const res = await fetch(`/api/teams/${teamId}/access-matrix`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      setMembers(data.members ?? [])
      setProjects(data.projects ?? [])
      setShares(data.shares ?? [])
    }
    setIsLoading(false)
  }

  useEffect(() => { load() }, [teamId])

  if (isLoading) {
    return <div className="py-16 text-center text-sm text-slate-400">Đang tải ma trận phân quyền...</div>
  }

  if (members.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-slate-500">Team chưa có thành viên.</p>
        <p className="text-xs text-slate-400 mt-1">Thêm thành viên trong tab "Thành viên".</p>
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-slate-500">Team chưa có dự án nào được gán.</p>
        <p className="text-xs text-slate-400 mt-1">Gán dự án trong tab "Dự án".</p>
      </div>
    )
  }

  return (
    <>
      {/* Toggle + stats */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-3">
        <div className="flex gap-1 p-0.5 bg-slate-200 rounded-lg">
          <button
            onClick={() => setViewMode('member')}
            className={cn('flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all', viewMode === 'member' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            <Users size={12} /> Theo thành viên
          </button>
          <button
            onClick={() => setViewMode('project')}
            className={cn('flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all', viewMode === 'project' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
          >
            <FolderOpen size={12} /> Theo dự án
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500 ml-2">
          <span><span className="font-semibold text-slate-700">{members.length}</span> thành viên</span>
          <span>·</span>
          <span><span className="font-semibold text-slate-700">{projects.length}</span> dự án</span>
          <span>·</span>
          <span><span className="font-semibold text-slate-700">{shares.length}</span> phân quyền</span>
        </div>
      </div>

      {viewMode === 'member' && (
        <MemberAccessView
          members={visibleMembers}
          projects={projects}
          shares={shares}
          getToken={getToken}
          onRefresh={load}
        />
      )}

      {viewMode === 'project' && (
        <ProjectAccessView
          members={visibleMembers}
          projects={projects}
          shares={shares}
          getToken={getToken}
          onRefresh={load}
        />
      )}
    </>
  )
}
