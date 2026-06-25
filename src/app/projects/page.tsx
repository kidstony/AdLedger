'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Pencil, Trash2, Search, UserCheck, Link2, Mail, Copy, Check, RefreshCw, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Download } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import ProjectFormDialog from '@/components/projects/ProjectFormDialog'
import { Project, CampaignDiscovery } from '@/lib/types'
import { Button } from '@/components/ui/button'
import TableSkeleton from '@/components/ui/TableSkeleton'
import { toast } from 'sonner'
import { exportToCsv } from '@/lib/utils'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/lib/supabase'
import { useMasterProjectsContext } from '@/context/MasterProjectsContext'

interface UserRow { user_id: string; email: string; full_name: string; role: string }

function fmtCustomerId(id: string | null | undefined): string {
  if (!id) return '—'
  const d = id.replace(/-/g, '')
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : id
}

export default function ProjectsPage() {
  const { projects, isLoading, addProject, updateProject, deleteProject, deleteProjects } = useProjects()
  const { role } = useAuth()
  const { masterProjects } = useMasterProjectsContext()
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; data?: Project } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Project | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const headerCheckboxRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null)
  const [copiedWallet, setCopiedWallet] = useState<string | null>(null)
  const [syncingMcc, setSyncingMcc] = useState(false)
  const [sortKey, setSortKey] = useState<'project_id' | 'name' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  // campaign info from Google Ads: project_id → {customer_id, campaign_id, mcc_name, mcc_id}
  const [campaignInfoMap, setCampaignInfoMap] = useState<Map<string, {
    customer_id: string; campaign_id: string; mcc_name: string | null; mcc_id: string | null
  }>>(new Map())

  useEffect(() => {
    fetch('/api/integrations/campaigns')
      .then(r => r.json())
      .then((list: CampaignDiscovery[]) => {
        if (!Array.isArray(list)) {
          console.error('[campaigns] API error:', list)
          return
        }
        const map = new Map<string, { customer_id: string; campaign_id: string; mcc_name: string | null; mcc_id: string | null }>()
        list.forEach(c => {
          if (c.project_id) map.set(c.project_id, {
            customer_id: c.customer_id,
            campaign_id: c.campaign_id,
            mcc_name: c.mcc_name ?? null,
            mcc_id: c.mcc_id ?? null,
          })
        })
        console.log(`[campaigns] ${list.length} campaigns, ${map.size} mapped to projects`)
        setCampaignInfoMap(map)
      })
      .catch(e => console.error('[campaigns] fetch failed:', e))
  }, [])

  async function refreshMccInfo() {
    setSyncingMcc(true)
    try {
      await fetch('/api/integrations/campaigns', { method: 'POST' })
      const list = await fetch('/api/integrations/campaigns').then(r => r.json())
      if (Array.isArray(list)) {
        const map = new Map<string, { customer_id: string; campaign_id: string; mcc_name: string | null; mcc_id: string | null }>()
        ;(list as CampaignDiscovery[]).forEach(c => {
          if (c.project_id) map.set(c.project_id, {
            customer_id: c.customer_id,
            campaign_id: c.campaign_id,
            mcc_name: c.mcc_name ?? null,
            mcc_id: c.mcc_id ?? null,
          })
        })
        setCampaignInfoMap(map)
        toast.success('Đã cập nhật thông tin MCC')
      }
    } catch {
      toast.error('Không thể cập nhật MCC')
    }
    setSyncingMcc(false)
  }

  const [employees, setEmployees] = useState<UserRow[]>([])
  const [employeesLoaded, setEmployeesLoaded] = useState(false)
  const [assigningProjectId, setAssigningProjectId] = useState<string | null>(null)
  const [projectAssignments, setProjectAssignments] = useState<Record<string, string[]>>({})
  const [assignmentLoading, setAssignmentLoading] = useState(false)

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.project_id.includes(search) ||
    p.cid.includes(search)
  )

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey]
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      })
    : filtered

  function handleSort(key: 'project_id' | 'name') {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  function handleExport() {
    exportToCsv(
      sorted.map(p => ({
        'Project ID': p.project_id,
        'Tên dự án': p.name,
        'CID': p.cid,
        'Tổng Dự Án': masterProjects.find(m => m.id === p.master_project_id)?.name ?? '',
        'Link Ref': p.ref_link ?? '',
        'Email Ref': p.email_ref ?? '',
        'Bank': p.bank_accounts?.banks?.name ?? '',
      })),
      `projects-${new Date().toISOString().slice(0, 10)}.csv`
    )
  }

  useEffect(() => { setSelectedIds(new Set()) }, [search])

  const allFilteredSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.project_id))
  const someSelected = filtered.some(p => selectedIds.has(p.project_id))
  const selectedCount = [...selectedIds].filter(id => filtered.some(p => p.project_id === id)).length

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected && !allFilteredSelected
    }
  }, [someSelected, allFilteredSelected])

  function toggleAll() {
    if (allFilteredSelected) {
      setSelectedIds(prev => { const next = new Set(prev); filtered.forEach(p => next.delete(p.project_id)); return next })
    } else {
      setSelectedIds(prev => { const next = new Set(prev); filtered.forEach(p => next.add(p.project_id)); return next })
    }
  }

  function toggleOne(id: string) {
    setSelectedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function handleBulkDelete() {
    const count = selectedIds.size
    deleteProjects([...selectedIds])
    setSelectedIds(new Set())
    setConfirmBulkDelete(false)
    toast.success(`Đã xóa ${count} dự án`)
  }

  async function loadEmployees() {
    if (employeesLoaded) return
    const res = await fetch('/api/admin/list-users')
    const data: UserRow[] = await res.json()
    setEmployees(Array.isArray(data) ? data.filter(u => u.role === 'employee') : [])
    setEmployeesLoaded(true)
  }

  async function openAssignPanel(projectId: string) {
    if (assigningProjectId === projectId) { setAssigningProjectId(null); return }
    setAssignmentLoading(true)
    await loadEmployees()
    if (projectAssignments[projectId] === undefined) {
      const { data } = await supabase.from('project_assignments').select('user_id').eq('project_id', projectId)
      setProjectAssignments(prev => ({ ...prev, [projectId]: (data ?? []).map((a: { user_id: string }) => a.user_id) }))
    }
    setAssigningProjectId(projectId)
    setAssignmentLoading(false)
  }

  async function toggleAssignment(projectId: string, userId: string, currentlyAssigned: boolean) {
    if (currentlyAssigned) {
      await supabase.from('project_assignments').delete().eq('project_id', projectId).eq('user_id', userId)
      setProjectAssignments(prev => ({ ...prev, [projectId]: (prev[projectId] ?? []).filter(uid => uid !== userId) }))
    } else {
      await supabase.from('project_assignments').insert({ project_id: projectId, user_id: userId })
      setProjectAssignments(prev => ({ ...prev, [projectId]: [...(prev[projectId] ?? []), userId] }))
    }
  }

  function copyLink(url: string, id: string) {
    navigator.clipboard.writeText(url)
    setCopied(id)
    setTimeout(() => setCopied(null), 1500)
  }

  function copyEmail(email: string, id: string) {
    navigator.clipboard.writeText(email)
    setCopiedEmail(id)
    setTimeout(() => setCopiedEmail(null), 1500)
  }

  function copyWallet(addr: string, key: string) {
    navigator.clipboard.writeText(addr)
    setCopiedWallet(key)
    setTimeout(() => setCopiedWallet(null), 1500)
  }

  function networkBadge(n: string | null | undefined) {
    const styles: Record<string, string> = {
      TRC20: 'bg-green-100 text-green-700', ERC20: 'bg-blue-100 text-blue-700',
      BEP20: 'bg-yellow-100 text-yellow-700', SOL: 'bg-purple-100 text-purple-700',
      ARB: 'bg-sky-100 text-sky-700', OP: 'bg-red-100 text-red-700',
      BASE: 'bg-indigo-100 text-indigo-700', POL: 'bg-violet-100 text-violet-700',
      AVAX: 'bg-rose-100 text-rose-700',
    }
    return styles[n ?? ''] ?? 'bg-slate-100 text-slate-600'
  }

  function shortenAddr(addr: string) {
    return addr.length <= 12 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Quản lý dự án</h2>
          <p className="text-sm text-slate-500 mt-0.5">{projects.length} dự án · Thêm/sửa/xóa mapping CID</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-colors">
            <Download size={14} /> Export CSV
          </button>
          <Button onClick={() => setDialog({ mode: 'add' })} className="gap-1.5">
            <Plus size={14} /> Thêm dự án
          </Button>
        </div>
      </div>

      <>
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm theo tên, ID, CID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 pr-3 py-1.5 w-full text-sm border border-slate-200 rounded-md bg-white outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          {selectedCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-slate-800 rounded-lg text-white text-sm">
              <span className="font-medium">{selectedCount} dự án đã chọn</span>
              <button onClick={() => setSelectedIds(new Set())} className="text-slate-400 hover:text-white text-xs underline underline-offset-2">Bỏ chọn</button>
              <div className="flex-1" />
              <button
                onClick={() => setConfirmBulkDelete(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-md text-white text-xs font-medium transition-colors"
              >
                <Trash2 size={13} /> Xóa {selectedCount} dự án
              </button>
            </div>
          )}

          {isLoading ? <TableSkeleton rows={8} cols={9} /> : (
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 w-10">
                        <input
                          ref={headerCheckboxRef}
                          type="checkbox"
                          checked={allFilteredSelected}
                          onChange={toggleAll}
                          className="rounded border-slate-300 cursor-pointer accent-slate-700"
                          title="Chọn tất cả"
                        />
                      </th>
                      <th onClick={() => handleSort('project_id')} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-slate-700">
                        <span className="inline-flex items-center gap-1">Project ID {sortKey === 'project_id' ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="text-slate-400" />}</span>
                      </th>
                      <th onClick={() => handleSort('name')} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap cursor-pointer select-none hover:text-slate-700">
                        <span className="inline-flex items-center gap-1">Tên dự án {sortKey === 'name' ? (sortDir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ArrowUpDown size={11} className="text-slate-400" />}</span>
                      </th>
                      {['CID', 'ID Campaign', 'MCC', 'ID MCC', 'Tổng Dự Án', 'Link Ref', 'Email Ref', 'Bank Nhận', ''].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(p => {
                      const isSelected = selectedIds.has(p.project_id)
                      return (
                        <tr key={p.project_id} className={`border-b border-slate-100 transition-colors ${isSelected ? 'bg-slate-50' : 'hover:bg-slate-50'}`}>
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={isSelected} onChange={() => toggleOne(p.project_id)}
                              className="rounded border-slate-300 cursor-pointer accent-slate-700" />
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.project_id}</td>
                          <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{p.name}</td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">
                            {fmtCustomerId(campaignInfoMap.get(p.project_id)?.customer_id ?? p.cid)}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">
                            {campaignInfoMap.get(p.project_id)?.campaign_id ?? <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500">
                            {campaignInfoMap.get(p.project_id)?.mcc_name
                              ? campaignInfoMap.get(p.project_id)!.mcc_name
                              : campaignInfoMap.has(p.project_id)
                                ? <button onClick={refreshMccInfo} disabled={syncingMcc} title="Cập nhật MCC"
                                    className="flex items-center gap-1 text-slate-400 hover:text-blue-500 transition-colors disabled:opacity-50">
                                    {syncingMcc ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                                    <span>Cập nhật</span>
                                  </button>
                                : <span className="text-slate-300">—</span>
                            }
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">
                            {(() => {
                              const info = campaignInfoMap.get(p.project_id)
                              if (!info?.mcc_id) return <span className="text-slate-300">—</span>
                              const mccClean = info.mcc_id.replace(/-/g, '')
                              const cidClean = (info.customer_id ?? '').replace(/-/g, '')
                              if (mccClean === cidClean) return <span className="text-slate-300">—</span>
                              return fmtCustomerId(info.mcc_id)
                            })()}
                          </td>
                          <td className="px-4 py-3">
                            {p.master_project_id ? (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-600 font-medium whitespace-nowrap">
                                {masterProjects.find(m => m.id === p.master_project_id)?.name ?? p.master_project_id}
                              </span>
                            ) : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                                          {/* Link Ref */}
                          <td className="px-4 py-3 max-w-[160px]">
                            {p.ref_link ? (
                              <div className="flex items-center gap-1.5 group">
                                <Link2 size={11} className="text-slate-400 shrink-0" />
                                <span className="text-xs text-slate-600 truncate" title={p.ref_link}>
                                  {p.ref_link.replace(/^https?:\/\//, '').slice(0, 30)}{p.ref_link.length > 35 ? '…' : ''}
                                </span>
                                <button
                                  onClick={() => copyLink(p.ref_link!, p.project_id)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 shrink-0"
                                  title="Copy link"
                                >
                                  {copied === p.project_id ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                                </button>
                              </div>
                            ) : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          {/* Email Ref */}
                          <td className="px-4 py-3 max-w-[180px]">
                            {p.email_ref ? (
                              <div className="flex items-center gap-1.5 group">
                                <Mail size={11} className="text-slate-400 shrink-0" />
                                <span className="text-xs text-slate-600 truncate" title={p.email_ref}>
                                  {p.email_ref.length > 28 ? p.email_ref.slice(0, 28) + '…' : p.email_ref}
                                </span>
                                <button
                                  onClick={() => copyEmail(p.email_ref!, p.project_id)}
                                  className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 shrink-0"
                                  title="Copy email"
                                >
                                  {copiedEmail === p.project_id ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                                </button>
                              </div>
                            ) : <span className="text-slate-300 text-xs">—</span>}
                          </td>
                          {/* Bank Nhận */}
                          <td className="px-4 py-3 min-w-[180px]">
                            {p.bank_accounts ? (
                              p.bank_accounts.banks?.bank_category === 'crypto' ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold bg-orange-50 text-orange-700 border border-orange-200">
                                      ₿ {p.bank_accounts.banks?.name}
                                    </span>
                                    <span className="text-xs font-bold text-slate-800">{p.bank_accounts.coin_type}</span>
                                    {p.bank_accounts.network && (
                                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${networkBadge(p.bank_accounts.network)}`}>
                                        {p.bank_accounts.network}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="font-mono text-xs text-slate-500">
                                      {p.bank_accounts.wallet_address ? shortenAddr(p.bank_accounts.wallet_address) : '—'}
                                    </span>
                                    {p.bank_accounts.wallet_address && (
                                      <button
                                        onClick={() => copyWallet(p.bank_accounts!.wallet_address!, p.bank_accounts!.id)}
                                        className="p-0.5 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors"
                                        title="Copy địa chỉ ví"
                                      >
                                        {copiedWallet === p.bank_accounts.id ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
                                      </button>
                                    )}
                                    <span className="text-slate-300 text-xs">·</span>
                                    <span className="text-xs text-slate-500">{p.bank_accounts.owner_name}</span>
                                  </div>
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  <span className="text-xs px-1.5 py-0.5 rounded-md font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                                    🏦 {p.bank_accounts.banks?.name}
                                  </span>
                                  <p className="text-xs text-slate-600 mt-0.5">
                                    {p.bank_accounts.account_identifier && (
                                      <span className="font-mono">{p.bank_accounts.account_identifier} · </span>
                                    )}
                                    {p.bank_accounts.owner_name}
                                  </p>
                                </div>
                              )
                            ) : (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 font-medium border border-amber-200 whitespace-nowrap">
                                Chưa cấu hình
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1 justify-end">
                              {role === 'super_admin' && projectAssignments[p.project_id] !== undefined && (
                                <span className="text-xs text-slate-400 mr-1">{projectAssignments[p.project_id].length} NV</span>
                              )}
                              {role === 'super_admin' && (
                                <button onClick={() => openAssignPanel(p.project_id)}
                                  className={`p-1.5 rounded transition-colors ${assigningProjectId === p.project_id ? 'bg-blue-100 text-blue-600' : 'hover:bg-slate-200 text-slate-500'}`}
                                  title="Phân công nhân viên">
                                  <UserCheck size={13} />
                                </button>
                              )}
                              <button onClick={() => setDialog({ mode: 'edit', data: p })}
                                className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors">
                                <Pencil size={13} />
                              </button>
                              <button onClick={() => setConfirmDelete(p)}
                                className="p-1.5 rounded hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {sorted.length === 0 && (
                  <div className="py-10 text-center text-sm text-slate-500">Không tìm thấy dự án.</div>
                )}
              </div>
            </div>
          )}
      </>

      {/* Employee assignment modal */}
      {assigningProjectId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-slate-800">Phân công nhân viên</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {projects.find(p => p.project_id === assigningProjectId)?.name}
                </p>
              </div>
              <button onClick={() => setAssigningProjectId(null)} className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">✕</button>
            </div>
            {assignmentLoading ? (
              <div className="py-6 text-center text-sm text-slate-400">Đang tải...</div>
            ) : employees.length === 0 ? (
              <div className="py-6 text-center text-sm text-slate-400">Chưa có nhân viên nào trong hệ thống.</div>
            ) : (
              <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {employees.map(emp => {
                  const assigned = (projectAssignments[assigningProjectId] ?? []).includes(emp.user_id)
                  return (
                    <label key={emp.user_id} className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${assigned ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50'}`}>
                      <input type="checkbox" checked={assigned} onChange={() => toggleAssignment(assigningProjectId, emp.user_id, assigned)} className="accent-blue-600" />
                      {emp.full_name || emp.email}
                    </label>
                  )
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button variant="outline" onClick={() => setAssigningProjectId(null)}>Xong</Button>
            </div>
          </div>
        </div>
      )}

      {dialog && (
        <ProjectFormDialog
          mode={dialog.mode}
          initialData={dialog.data}
          existingIds={projects.map(p => p.project_id)}
          masterProjects={masterProjects}
          onSave={async (p) => {
            const err = await (dialog.mode === 'add' ? addProject : updateProject)(p)
            if (err) { toast.error(err); return err }
            toast.success(dialog.mode === 'add' ? 'Đã tạo dự án' : 'Đã cập nhật dự án')
            return null
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa dự án?</h3>
            <p className="text-sm text-slate-600 mb-5">
              Bạn chắc chắn muốn xóa <strong>{confirmDelete.name}</strong>? Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Hủy</Button>
              <Button variant="destructive" onClick={() => { deleteProject(confirmDelete.project_id); setConfirmDelete(null); toast.success('Đã xóa dự án') }}>Xóa</Button>
            </div>
          </div>
        </div>
      )}

      {confirmBulkDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa {selectedCount} dự án?</h3>
            <p className="text-sm text-slate-600 mb-5">
              Bạn chắc chắn muốn xóa <strong>{selectedCount} dự án</strong> đã chọn? Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmBulkDelete(false)}>Hủy</Button>
              <Button variant="destructive" onClick={handleBulkDelete}>Xóa {selectedCount} dự án</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
