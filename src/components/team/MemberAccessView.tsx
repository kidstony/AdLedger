'use client'

import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import MemberProjectList, { MatrixMember, MatrixProject, MatrixShare } from './MemberProjectList'

interface Props {
  members:   MatrixMember[]
  projects:  MatrixProject[]
  shares:    MatrixShare[]
  getToken:  () => Promise<string>
  onRefresh: () => void
}

function avatarColor(userId: string): string {
  const colors = ['bg-blue-500','bg-violet-500','bg-emerald-500','bg-orange-500','bg-rose-500','bg-cyan-500']
  let hash = 0
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
  return colors[hash % colors.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function MemberAccessView({ members, projects, shares, getToken, onRefresh }: Props) {
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(members[0]?.user_id ?? null)
  const [memberSearch, setMemberSearch] = useState('')

  const filteredMembers = useMemo(() => {
    const q = memberSearch.toLowerCase()
    return !q ? members : members.filter(m => m.full_name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q))
  }, [members, memberSearch])

  const selectedMember = members.find(m => m.user_id === selectedMemberId) ?? null

  // Shares for the currently selected member
  const memberShares = useMemo(
    () => shares.filter(s => s.user_id === selectedMemberId),
    [shares, selectedMemberId]
  )

  // Count granted projects per member
  const grantedCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of shares) map.set(s.user_id, (map.get(s.user_id) ?? 0) + 1)
    return map
  }, [shares])

  if (members.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-slate-500">Team chưa có thành viên.</p>
        <p className="text-xs text-slate-400 mt-1">Thêm thành viên trong tab "Thành viên & Dự án".</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[500px]">
      {/* Left panel: member list */}
      <div className="w-56 shrink-0 border-r border-slate-200 flex flex-col">
        <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">Thành viên</p>
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={memberSearch}
              onChange={e => setMemberSearch(e.target.value)}
              placeholder="Tìm..."
              className="w-full pl-6 pr-2 py-1 text-xs border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-300 bg-white"
            />
          </div>
        </div>
        <div className="flex-1 overflow-auto">
          {filteredMembers.map(m => {
            const granted = grantedCountMap.get(m.user_id) ?? 0
            const active = m.user_id === selectedMemberId
            return (
              <button
                key={m.user_id}
                onClick={() => setSelectedMemberId(m.user_id)}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-slate-100',
                  active ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-slate-50'
                )}
              >
                <div className={cn('w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-semibold shrink-0', avatarColor(m.user_id))}>
                  {getInitials(m.full_name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-800 truncate">{m.full_name}</div>
                  <div className={cn('text-[10px]', granted > 0 ? 'text-blue-600 font-medium' : 'text-slate-400')}>
                    {granted > 0 ? `${granted} dự án` : 'Chưa có quyền'}
                  </div>
                </div>
              </button>
            )
          })}
          {filteredMembers.length === 0 && (
            <p className="px-3 py-6 text-xs text-slate-400 text-center">Không tìm thấy</p>
          )}
        </div>
      </div>

      {/* Right panel: project list for selected member */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedMember ? (
          <MemberProjectList
            key={selectedMember.user_id}
            member={selectedMember}
            projects={projects}
            memberShares={memberShares}
            getToken={getToken}
            onRefresh={onRefresh}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-slate-400">
            Chọn một thành viên để quản lý quyền
          </div>
        )}
      </div>
    </div>
  )
}
