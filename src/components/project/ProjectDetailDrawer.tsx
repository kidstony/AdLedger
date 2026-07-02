'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, ChevronRight, ChevronLeft, Clock, History, Info, BarChart2, Eye, EyeOff, Copy, Check } from 'lucide-react'
import UserSelect from '@/components/project/UserSelect'
import { Project, ProjectStatus, STATUS_CONFIG, ACTIVE_STATUSES, ProjectReminder } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { cn, formatVND } from '@/lib/utils'
import StatusPicker from '@/components/project/StatusPicker'
import ReminderModal from '@/components/project/ReminderModal'
import { useAuth } from '@/context/AuthContext'
import { useMasterProjectsContext } from '@/context/MasterProjectsContext'

interface HistoryEntry {
  id: string
  field: string
  old_value: string | null
  new_value: string | null
  user_name: string
  created_at: string
}

interface PnlData {
  total_spend: number
  total_revenue: number
  total_profit: number
  total_rental: number
  total_other: number
  total_pending: number
}

interface ProjectDetailDrawerProps {
  project: Project | null
  onClose: () => void
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  onProjectUpdated?: (updated: Project) => void
  teamUsers?: { user_id: string; full_name: string; email: string }[]
}

type DrawerTab = 'info' | 'pnl' | 'reminders' | 'history'

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={handleCopy} className="ml-1 text-slate-400 hover:text-slate-600">
      {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
    </button>
  )
}

export default function ProjectDetailDrawer({
  project,
  onClose,
  authFetch,
  onProjectUpdated,
  teamUsers = [],
}: ProjectDetailDrawerProps) {
  const [tab, setTab] = useState<DrawerTab>('info')
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [pnl, setPnl] = useState<PnlData | null>(null)
  const [pnlLoading, setPnlLoading] = useState(false)
  const [pnlFrom, setPnlFrom] = useState('')
  const [pnlTo, setPnlTo] = useState(new Date().toISOString().split('T')[0])
  const [showPassword, setShowPassword] = useState(false)
  const [editingNote, setEditingNote] = useState(false)
  const [noteValue, setNoteValue] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [showReminderModal, setShowReminderModal] = useState(false)
  const [reminders, setReminders] = useState<ProjectReminder[]>([])

  const isOpen = !!project
  const { role } = useAuth()
  const canEdit = role === 'super_admin' || role === 'manager'
  const { masterProjects } = useMasterProjectsContext()

  // Reset on new project
  useEffect(() => {
    if (!project) return
    setTab('info')
    setShowPassword(false)
    setEditingNote(false)
    setNoteValue(project.note ?? '')
    setHistory([])
    setPnl(null)
    setReminders([])
    setPnlFrom(project.camp_start_date ?? '')
    setPnlTo(new Date().toISOString().split('T')[0])
  }, [project?.project_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadHistory = useCallback(async () => {
    if (!project) return
    setHistoryLoading(true)
    try {
      const res = await authFetch(`/api/projects/${project.project_id}/history`)
      if (res.ok) setHistory(await res.json())
    } finally {
      setHistoryLoading(false)
    }
  }, [project, authFetch])

  const loadPnl = useCallback(async (from?: string, to?: string) => {
    if (!project) return
    setPnlLoading(true)
    try {
      const f = from ?? (pnlFrom || '2000-01-01')
      const t = to ?? pnlTo
      const res  = await authFetch(`/api/projects/${project.project_id}/pnl-summary?from=${f}&to=${t}`)
      if (res.ok) setPnl(await res.json())
    } finally {
      setPnlLoading(false)
    }
  }, [project, authFetch, pnlFrom, pnlTo])

  const loadReminders = useCallback(async () => {
    if (!project) return
    const res = await authFetch(`/api/projects/${project.project_id}/reminder`)
    if (res.ok) setReminders(await res.json())
  }, [project, authFetch])

  // Always load reminders on project open (for badge count in tab header)
  useEffect(() => {
    if (project) loadReminders()
  }, [project?.project_id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!project) return
    if (tab === 'history') {
      loadHistory()
    } else if (tab === 'pnl') {
      loadPnl()
    }
  }, [tab, project?.project_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleStatusChange = async (newStatuses: ProjectStatus[]) => {
    if (!project) return
    const res = await authFetch(`/api/projects/${project.project_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statuses: newStatuses }),
    })
    if (res.ok) {
      const updated = await res.json()
      onProjectUpdated?.({ ...project, ...updated })
    }
  }

  const handlePersonChange = async (userId: string) => {
    if (!project) return
    const res = await authFetch(`/api/projects/${project.project_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_in_charge: userId || null }),
    })
    if (res.ok) {
      const updated = await res.json()
      onProjectUpdated?.({ ...project, ...updated })
    }
  }

  const handleMasterProjectChange = async (masterProjectId: string) => {
    if (!project) return
    const res = await authFetch(`/api/projects/${project.project_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ master_project_id: masterProjectId || null }),
    })
    if (res.ok) {
      const updated = await res.json()
      onProjectUpdated?.({ ...project, ...updated })
    }
  }

  const handleNoteSave = async () => {
    if (!project) return
    setSavingNote(true)
    const res = await authFetch(`/api/projects/${project.project_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: noteValue }),
    })
    if (res.ok) {
      const updated = await res.json()
      onProjectUpdated?.({ ...project, ...updated })
    }
    setSavingNote(false)
    setEditingNote(false)
  }

  const fmtDate = (s: string) =>
    new Date(s).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

  const activeReminders = reminders.filter(r => !r.is_triggered)

  if (!project) return null

  const personName = teamUsers.find(u => u.user_id === project.person_in_charge)?.full_name ?? '—'

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/30 transition-opacity duration-300',
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* Drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex flex-col bg-white shadow-2xl transition-transform duration-300 w-[520px] max-w-[95vw]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-200 shrink-0">
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <ChevronRight size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-slate-800 truncate">{project.name}</h2>
            <p className="text-xs text-slate-500">{project.project_id}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 shrink-0">
          {[
            { key: 'info' as DrawerTab, label: 'Thông tin', icon: Info },
            { key: 'pnl' as DrawerTab, label: 'P&L', icon: BarChart2 },
            { key: 'reminders' as DrawerTab, label: 'Nhắc nhở', icon: Clock },
            { key: 'history' as DrawerTab, label: 'Lịch sử', icon: History },
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              <Icon size={14} />
              {label}
              {key === 'reminders' && activeReminders.length > 0 && (
                <span className="ml-1 rounded-full bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 font-semibold">
                  {activeReminders.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {/* ── TAB: THÔNG TIN ── */}
          {tab === 'info' && (
            <div className="p-5 space-y-5">
              {/* Statuses */}
              <Section label="Tình trạng">
                <StatusPicker
                  value={project.statuses ?? []}
                  onChange={handleStatusChange}
                  disabled={!canEdit}
                />
              </Section>

              {/* Category */}
              {project.category && (
                <Section label="Category">
                  <span
                    className="inline-flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full font-medium"
                    style={{ backgroundColor: project.category.color + '22', color: project.category.color }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: project.category.color }} />
                    {project.category.name}
                  </span>
                </Section>
              )}

              {/* Người phụ trách */}
              <Section label="Người phụ trách">
                <UserSelect
                  value={project.person_in_charge ?? null}
                  users={teamUsers}
                  disabled={!canEdit || teamUsers.length === 0}
                  onChange={id => handlePersonChange(id ?? '')}
                  size="md"
                />
              </Section>

              {/* Tổng Dự Án */}
              <Section label="Tổng Dự Án">
                {canEdit ? (
                  <select
                    value={project.master_project_id ?? ''}
                    onChange={e => handleMasterProjectChange(e.target.value)}
                    className="text-sm text-slate-700 border border-slate-200 rounded-md px-2.5 py-1.5 bg-white hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
                  >
                    <option value="">— Chưa gán —</option>
                    {masterProjects.map(mp => (
                      <option key={mp.id} value={mp.id}>{mp.name}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm text-slate-700">
                    {masterProjects.find(mp => mp.id === project.master_project_id)?.name ?? '—'}
                  </span>
                )}
              </Section>

              {/* Ngày lên camp */}
              {project.camp_start_date && (
                <Section label="Ngày lên camp">
                  <span className="text-sm text-slate-700">
                    {new Date(project.camp_start_date).toLocaleDateString('vi-VN')}
                  </span>
                </Section>
              )}

              {/* Affiliate */}
              {(project.affiliate_url || project.affiliate_username) && (
                <div className="border border-slate-100 rounded-lg p-4 space-y-3 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Affiliate</p>
                  {project.affiliate_network && (
                    <InfoRow label="Mạng">{project.affiliate_network}</InfoRow>
                  )}
                  {project.affiliate_url && (
                    <InfoRow label="URL">
                      <a href={project.affiliate_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate max-w-xs block">
                        {project.affiliate_url}
                      </a>
                      <CopyButton value={project.affiliate_url} />
                    </InfoRow>
                  )}
                  {project.affiliate_username && (
                    <InfoRow label="Username">
                      <span>{project.affiliate_username}</span>
                      <CopyButton value={project.affiliate_username} />
                    </InfoRow>
                  )}
                  {project.affiliate_password && (
                    <InfoRow label="Password">
                      <span className="font-mono text-sm">
                        {showPassword ? project.affiliate_password : '•'.repeat(Math.min(project.affiliate_password.length, 12))}
                      </span>
                      <button onClick={() => setShowPassword(v => !v)} className="ml-1 text-slate-400 hover:text-slate-600">
                        {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      {showPassword && <CopyButton value={project.affiliate_password} />}
                    </InfoRow>
                  )}
                </div>
              )}

              {/* Links */}
              {(project.ref_link || project.email_ref) && (
                <div className="border border-slate-100 rounded-lg p-4 space-y-3 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Links</p>
                  {project.ref_link && (
                    <InfoRow label="Link Ref">
                      <a href={project.ref_link} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate max-w-xs block">
                        {project.ref_link}
                      </a>
                      <CopyButton value={project.ref_link} />
                    </InfoRow>
                  )}
                  {project.email_ref && (
                    <InfoRow label="Email Ref">
                      <span>{project.email_ref}</span>
                      <CopyButton value={project.email_ref} />
                    </InfoRow>
                  )}
                </div>
              )}

              {/* Note */}
              <Section label="Note">
                {editingNote && canEdit ? (
                  <div className="space-y-2">
                    <textarea
                      rows={4}
                      className="w-full text-sm border border-slate-200 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                      value={noteValue}
                      onChange={e => setNoteValue(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleNoteSave} disabled={savingNote}>
                        {savingNote ? 'Đang lưu...' : 'Lưu'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setEditingNote(false); setNoteValue(project.note ?? '') }}>
                        Hủy
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p
                    className={cn('text-sm text-slate-600 rounded p-1 -m-1 whitespace-pre-wrap min-h-[24px]', canEdit && 'cursor-pointer hover:bg-slate-50')}
                    onClick={() => canEdit && setEditingNote(true)}
                    title={canEdit ? 'Click để chỉnh sửa' : undefined}
                  >
                    {project.note || <span className="text-slate-400 italic">Chưa có ghi chú — click để thêm</span>}
                  </p>
                )}
              </Section>
            </div>
          )}

          {/* ── TAB: P&L ── */}
          {tab === 'pnl' && (
            <div className="p-5">
              {/* Date range picker */}
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <label className="text-xs text-slate-500 shrink-0">Từ</label>
                <input type="date" className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={pnlFrom} onChange={e => setPnlFrom(e.target.value)} />
                <label className="text-xs text-slate-500 shrink-0">đến</label>
                <input type="date" className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
                  value={pnlTo} onChange={e => setPnlTo(e.target.value)} />
                <button
                  className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
                  onClick={() => loadPnl(pnlFrom, pnlTo)}
                >
                  Tải lại
                </button>
              </div>
              {pnlLoading ? (
                <p className="text-sm text-slate-400 text-center py-10">Đang tải P&L...</p>
              ) : pnl ? (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-slate-700">Tổng quan P&L</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <PnlCard label="Doanh thu" value={pnl.total_revenue} color="text-green-600" />
                    <PnlCard label="Lợi nhuận" value={pnl.total_profit} color={pnl.total_profit >= 0 ? 'text-green-600' : 'text-red-600'} />
                    <PnlCard label="Chi quảng cáo" value={pnl.total_spend} color="text-slate-700" />
                    {pnl.total_rental > 0 && <PnlCard label="Chi thuê TK" value={pnl.total_rental} color="text-slate-700" />}
                    {pnl.total_other > 0 && <PnlCard label="Chi khác" value={pnl.total_other} color="text-slate-700" />}
                    <PnlCard label="Doanh thu chờ" value={pnl.total_pending} color="text-amber-600" />
                    <PnlCard
                      label="ROI"
                      value={null}
                      formatted={
                        (pnl.total_spend + pnl.total_rental + pnl.total_other) > 0
                          ? `${((pnl.total_profit / (pnl.total_spend + pnl.total_rental + pnl.total_other)) * 100).toFixed(1)}%`
                          : '—'
                      }
                      color={pnl.total_profit >= 0 ? 'text-green-600' : 'text-red-600'}
                    />
                  </div>
                  <p className="text-xs text-slate-400 text-center">Xem chi tiết tại trang Báo cáo P&L</p>
                </div>
              ) : (
                <p className="text-sm text-slate-400 text-center py-10">Không có dữ liệu P&L cho dự án này.</p>
              )}
            </div>
          )}

          {/* ── TAB: NHẮC NHỞ + LỊCH SỬ ── */}
          {tab === 'reminders' && (
            <div className="p-5 space-y-6">
              {/* Reminders section */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
                    <Clock size={14} /> Nhắc nhở
                  </h3>
                  <Button size="sm" variant="outline" onClick={() => setShowReminderModal(true)}>
                    + Thêm nhắc nhở
                  </Button>
                </div>

                {reminders.length === 0 ? (
                  <p className="text-sm text-slate-400 italic">Chưa có nhắc nhở nào.</p>
                ) : (
                  <div className="space-y-2">
                    {reminders.map(r => (
                      <div
                        key={r.id}
                        className={cn(
                          'flex items-start gap-2 p-3 rounded-lg border text-sm',
                          r.is_triggered ? 'border-slate-100 bg-slate-50 opacity-60' : 'border-amber-100 bg-amber-50'
                        )}
                      >
                        <span className={r.is_triggered ? '⚫' : '🟡'} />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-700">
                            {new Date(r.remind_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            {r.repeat_type !== 'none' && (
                              <span className="ml-2 text-xs text-slate-500">
                                {r.repeat_type === 'daily' ? '· Hàng ngày' : r.repeat_type === 'weekly' ? '· Hàng tuần' : `· Mỗi ${r.repeat_days} ngày`}
                              </span>
                            )}
                          </p>
                          {r.message && <p className="text-slate-600 truncate">{r.message}</p>}
                          <div className="flex gap-2 mt-1 text-xs text-slate-400">
                            {r.notify_inapp && <span>📱 In-app</span>}
                            {r.notify_telegram && <span>✈️ Telegram</span>}
                          </div>
                        </div>
                        {r.is_triggered && <span className="text-xs text-slate-400">Đã gửi</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}

          {/* ── TAB: LỊCH SỬ ── */}
          {tab === 'history' && (
            <div className="p-5">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-1.5 mb-4">
                <History size={14} /> Lịch sử thay đổi
              </h3>
              {historyLoading ? (
                <p className="text-sm text-slate-400">Đang tải...</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-slate-400 italic">Chưa có lịch sử nào.</p>
              ) : (
                <div className="space-y-3">
                  {history.map(h => (
                    <div key={h.id} className="flex gap-3 text-sm border-b border-slate-50 pb-3 last:border-0">
                      <span className="text-slate-400 shrink-0 w-28 text-xs pt-0.5">{fmtDate(h.created_at)}</span>
                      <div className="min-w-0">
                        <span className="font-medium text-slate-700">{h.user_name}</span>
                        {' đổi '}
                        <span className="font-medium text-slate-700">{h.field}</span>
                        {h.old_value && (
                          <> từ <span className="line-through text-slate-400">{h.old_value}</span></>
                        )}
                        {h.new_value && (
                          <> → <span className="text-slate-800">{h.new_value}</span></>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* ReminderModal */}
      {showReminderModal && project && (
        <ReminderModal
          projectId={project.project_id}
          projectName={project.name}
          onClose={() => { setShowReminderModal(false); loadReminders() }}
          authFetch={authFetch}
          onReminderChange={() => loadReminders()}
        />
      )}
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">{label}</p>
      <div>{children}</div>
    </div>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-slate-400 w-20 shrink-0">{label}</span>
      <div className="flex items-center gap-1 flex-1 min-w-0 text-slate-700">{children}</div>
    </div>
  )
}

function PnlCard({ label, value, formatted, color }: { label: string; value: number | null; formatted?: string; color: string }) {
  const display = formatted ?? (value !== null ? formatVND(value) : '—')
  return (
    <div className="border border-slate-100 rounded-lg p-3 bg-white">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={cn('text-base font-semibold', color)}>{display}</p>
    </div>
  )
}
