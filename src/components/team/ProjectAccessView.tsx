'use client'

import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import ProjectMemberList from './ProjectMemberList'
import { MatrixMember, MatrixProject, MatrixShare } from './MemberProjectList'

interface Props {
  members:   MatrixMember[]
  projects:  MatrixProject[]
  shares:    MatrixShare[]
  getToken:  () => Promise<string>
  onRefresh: () => void
}

export default function ProjectAccessView({ members, projects, shares, getToken, onRefresh }: Props) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(projects[0]?.project_id ?? null)
  const [projectSearch, setProjectSearch] = useState('')

  const filteredProjects = useMemo(() => {
    const q = projectSearch.toLowerCase()
    return !q ? projects : projects.filter(p =>
      p.name.toLowerCase().includes(q) || p.project_id.toLowerCase().includes(q)
    )
  }, [projects, projectSearch])

  const selectedProject = projects.find(p => p.project_id === selectedProjectId) ?? null

  const projectShares = useMemo(
    () => shares.filter(s => s.project_id === selectedProjectId),
    [shares, selectedProjectId]
  )

  const grantedCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of shares) map.set(s.project_id, (map.get(s.project_id) ?? 0) + 1)
    return map
  }, [shares])

  if (projects.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-slate-500">Team chưa có dự án nào.</p>
        <p className="text-xs text-slate-400 mt-1">Gán dự án trong tab "Thành viên & Dự án".</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[500px]">
      {/* Left panel: project list */}
      <div className="w-56 shrink-0 border-r border-slate-200 flex flex-col">
        <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Dự án</p>
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={projectSearch}
              onChange={e => setProjectSearch(e.target.value)}
              placeholder="Tìm..."
              className="w-full pl-6 pr-2 py-1 text-xs border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-300 bg-white"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {filteredProjects.map(p => {
            const granted = grantedCountMap.get(p.project_id) ?? 0
            const active  = p.project_id === selectedProjectId
            return (
              <button
                key={p.project_id}
                onClick={() => setSelectedProjectId(p.project_id)}
                className={cn(
                  'w-full flex flex-col gap-0.5 px-3 py-2.5 text-left transition-colors border-b border-slate-100',
                  active ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-slate-50'
                )}
              >
                <div className="text-[10px] font-mono text-slate-400">{p.project_id}</div>
                <div className="text-xs font-medium text-slate-800 truncate">{p.name}</div>
                <div className={cn('text-[10px]', granted > 0 ? 'text-blue-600 font-medium' : 'text-slate-400')}>
                  {granted > 0 ? `${granted} thành viên` : 'Chưa có ai'}
                </div>
              </button>
            )
          })}
          {filteredProjects.length === 0 && (
            <p className="px-3 py-6 text-xs text-slate-400 text-center">Không tìm thấy</p>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedProject ? (
          <ProjectMemberList
            key={selectedProject.project_id}
            project={selectedProject}
            members={members}
            projectShares={projectShares}
            getToken={getToken}
            onRefresh={onRefresh}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
            Chọn một dự án để quản lý quyền
          </div>
        )}
      </div>
    </div>
  )
}
