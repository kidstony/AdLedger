'use client'

import { useState, useEffect } from 'react'
import { Copy, Check, Plus, X, Loader2, Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react'
import CategorySelect from '@/components/project/CategorySelect'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Project, MasterProject, Bank, BankAccount,
  ProjectCategory, ProjectStatus, STATUS_CONFIG,
} from '@/lib/types'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import AttributionFields from '@/components/projects/AttributionFields'

const NETWORK_STYLES: Record<string, string> = {
  TRC20: 'bg-green-100 text-green-700', ERC20: 'bg-blue-100 text-blue-700',
  BEP20: 'bg-yellow-100 text-yellow-700', SOL: 'bg-purple-100 text-purple-700',
  Bitcoin: 'bg-orange-100 text-orange-700', Lightning: 'bg-yellow-100 text-yellow-700',
  TON: 'bg-cyan-100 text-cyan-700', ARB: 'bg-sky-100 text-sky-700',
  OP: 'bg-red-100 text-red-700', BASE: 'bg-indigo-100 text-indigo-700',
  POL: 'bg-violet-100 text-violet-700', AVAX: 'bg-rose-100 text-rose-700',
}
function networkStyle(n: string | null | undefined) { return NETWORK_STYLES[n ?? ''] ?? 'bg-slate-100 text-slate-600' }
function shortenAddr(addr: string) { return addr.length <= 12 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}` }

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors">
      {done ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  )
}

async function authFetch(url: string, opts?: RequestInit) {
  const { data: { session } } = await supabase.auth.getSession()
  return fetch(url, {
    ...opts,
    headers: { ...opts?.headers, 'Authorization': `Bearer ${session?.access_token ?? ''}` },
  })
}

const ALL_STATUSES = Object.keys(STATUS_CONFIG) as ProjectStatus[]

interface Props {
  mode: 'add' | 'edit'
  initialData?: Partial<Project>
  existingIds: string[]
  masterProjects: MasterProject[]
  teamUsers?: { user_id: string; full_name: string; email: string }[]
  onSave: (project: Project) => Promise<string | null>
  onClose: () => void
}

function nextProjectId(existingIds: string[]): string {
  const nums = existingIds.map(id => parseInt(id.replace('proj', ''), 10)).filter(n => !isNaN(n))
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `proj${String(max + 1).padStart(3, '0')}`
}

export default function ProjectFormDialog({ mode, initialData, existingIds, masterProjects, teamUsers = [], onSave, onClose }: Props) {
  const [form, setForm] = useState<Project>({
    project_id: nextProjectId(existingIds), cid: '0000000000', name: '', mcc_id: 'uncategorized', master_project_id: null,
    ...(initialData ?? {}),
  } as Project)

  useEffect(() => {
    if (mode !== 'add') return
    authFetch('/api/projects/next-id').then(r => r.json()).then(d => {
      if (d.project_id) setForm(f => ({ ...f, project_id: d.project_id }))
    }).catch(() => {})
  }, [])
  const [errors, setErrors] = useState<Partial<Record<keyof Project, string>>>({})
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showAffiliateSection, setShowAffiliateSection] = useState(
    !!(initialData?.affiliate_url || initialData?.affiliate_username || initialData?.affiliate_password)
  )
  const [showDetails, setShowDetails] = useState(mode === 'edit')

  // Categories
  const [categories, setCategories] = useState<ProjectCategory[]>([])
  useEffect(() => {
    authFetch('/api/projects/categories').then(r => r.json()).then(d => setCategories(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  // Inline master project creation
  const [showCreateMaster, setShowCreateMaster] = useState(false)
  const [newMasterName, setNewMasterName] = useState('')
  const [creatingMaster, setCreatingMaster] = useState(false)
  const [localMasterProjects, setLocalMasterProjects] = useState<MasterProject[]>([])
  const allMasterProjects = [...masterProjects, ...localMasterProjects]

  async function handleCreateMaster() {
    if (!newMasterName.trim()) return
    setCreatingMaster(true)
    const res = await authFetch('/api/master-projects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newMasterName.trim() }),
    }).catch(() => null)
    if (res?.ok) {
      const mp: MasterProject = await res.json()
      setLocalMasterProjects(prev => [...prev, mp])
      setForm(f => ({ ...f, master_project_id: mp.id }))
      setShowCreateMaster(false); setNewMasterName('')
    }
    setCreatingMaster(false)
  }

  // Bank cascading state
  const [banks, setBanks] = useState<Bank[]>([])
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [selectedBankId, setSelectedBankId] = useState<string>(initialData?.bank_accounts?.bank_id ?? '')
  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const selectedAccount = accounts.find(a => a.id === form.bank_account_id)

  useEffect(() => {
    authFetch('/api/banks').then(r => r.json()).then(d => { if (Array.isArray(d)) setBanks(d) }).catch(() => {})
  }, [])
  useEffect(() => { if (selectedBankId) loadAccounts(selectedBankId) }, [selectedBankId])

  async function loadAccounts(bankId: string) {
    setLoadingAccounts(true)
    try {
      const res = await authFetch(`/api/bank-accounts?bank_id=${bankId}`)
      const data = await res.json()
      if (Array.isArray(data)) setAccounts(data)
    } finally { setLoadingAccounts(false) }
  }

  function handleBankChange(bankId: string) {
    setSelectedBankId(bankId)
    setForm(f => ({ ...f, bank_account_id: null, bank_accounts: null }))
    setAccounts([])
    if (bankId) loadAccounts(bankId)
  }

  function handleAccountChange(accountId: string) {
    if (!accountId) { setForm(f => ({ ...f, bank_account_id: null, bank_accounts: null })); return }
    const acc = accounts.find(a => a.id === accountId)
    const bank = banks.find(b => b.id === selectedBankId)
    setForm(f => ({ ...f, bank_account_id: accountId, bank_accounts: acc ? { ...acc, banks: bank ?? null } : null }))
  }

  function toggleStatus(status: ProjectStatus) {
    const current = form.statuses ?? []
    const next = current.includes(status) ? current.filter(s => s !== status) : [...current, status]
    setForm(f => ({ ...f, statuses: next }))
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof Project, string>> = {}
    if (!form.name.trim()) errs.name = 'Bắt buộc nhập tên'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true); setSaveError('')
    try {
      const err = await onSave(form)
      if (err) { setSaveError(err); return }
      onClose()
    } finally { setSaving(false) }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Thêm dự án mới' : 'Chỉnh sửa dự án'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          {/* ── Thông tin cơ bản ── */}
          {mode === 'edit' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Project ID</label>
              <Input value={form.project_id} disabled className="text-slate-400" />
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Tên dự án <span className="text-red-400">*</span></label>
            <Input value={form.name} placeholder="vd: Proxy Seller, ClickBank Nutra..."
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={errors.name ? 'border-red-400' : ''} autoFocus />
            {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
          </div>

          {/* Category */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Category</label>
            <div className="border border-slate-200 rounded-md px-2 py-1.5 bg-white min-h-[38px] flex items-center">
              <CategorySelect
                value={form.category_id ?? null}
                categories={categories}
                canManage={true}
                onChange={id => setForm(f => ({ ...f, category_id: id }))}
                onCategoryCreated={cat => {
                  setCategories(prev => [...prev, cat])
                  setForm(f => ({ ...f, category_id: cat.id }))
                }}
                authFetch={authFetch}
              />
            </div>
          </div>

          {/* Tình trạng */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-600">Tình trạng</label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_STATUSES.map(status => {
                const selected = (form.statuses ?? []).includes(status)
                return (
                  <button key={status} type="button" onClick={() => toggleStatus(status)}
                    className={cn(
                      'text-xs px-2.5 py-1 rounded-full font-medium border transition-all',
                      selected
                        ? cn(STATUS_CONFIG[status]?.badge, 'border-current shadow-sm')
                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                    )}>
                    {STATUS_CONFIG[status]?.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Tổng Dự Án — luôn hiển thị */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Tổng Dự Án</label>
            <div className="flex gap-1">
              <select value={form.master_project_id ?? ''}
                onChange={e => setForm(f => ({ ...f, master_project_id: e.target.value || null }))}
                className="flex-1 border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300">
                <option value="">— Chưa phân nhóm —</option>
                {allMasterProjects.map(mp => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
              </select>
              {!showCreateMaster && (
                <button type="button" onClick={() => setShowCreateMaster(true)}
                  className="p-2 text-slate-400 hover:text-slate-600 border border-slate-200 rounded-md hover:bg-slate-50">
                  <Plus size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Inline master project creation */}
          {showCreateMaster && (
            <div className="flex items-center gap-1.5">
              <input autoFocus value={newMasterName} onChange={e => setNewMasterName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateMaster() } if (e.key === 'Escape') { setShowCreateMaster(false); setNewMasterName('') } }}
                placeholder="Tên nhóm mới..."
                className="flex-1 border border-slate-200 rounded-md px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
              <button type="button" onClick={handleCreateMaster} disabled={creatingMaster || !newMasterName.trim()}
                className="p-1.5 rounded-md bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50">
                {creatingMaster ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              </button>
              <button type="button" onClick={() => { setShowCreateMaster(false); setNewMasterName('') }}
                className="p-1.5 rounded-md border border-slate-200 text-slate-400 hover:text-slate-600">
                <X size={13} />
              </button>
            </div>
          )}

          {/* ── Toggle chi tiết (chỉ hiện ở add mode) ── */}
          {mode === 'add' && (
            <button type="button"
              onClick={() => setShowDetails(v => !v)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors py-0.5">
              {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showDetails ? 'Ẩn chi tiết' : 'Thêm chi tiết (tùy chọn)'}
            </button>
          )}

          {showDetails && (
            <>
              {/* Ngày lên camp */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Ngày lên camp</label>
                <input type="date" value={form.camp_start_date ?? ''}
                  onChange={e => setForm(f => ({ ...f, camp_start_date: e.target.value || null }))}
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
              </div>

              {/* Người phụ trách */}
              {teamUsers.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Người phụ trách</label>
                  <select value={form.person_in_charge ?? ''}
                    onChange={e => setForm(f => ({ ...f, person_in_charge: e.target.value || null }))}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300">
                    <option value="">— Chưa phân công —</option>
                    {teamUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.full_name || u.email}</option>)}
                  </select>
                </div>
              )}

              {/* Note */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Note</label>
                <textarea value={form.note ?? ''} rows={2}
                  onChange={e => setForm(f => ({ ...f, note: e.target.value || null }))}
                  placeholder="Ghi chú về dự án..."
                  className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 resize-none" />
              </div>

              {/* ── Affiliate Section (collapsible) ── */}
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <button type="button"
                  onClick={() => setShowAffiliateSection(v => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors">
                  <span>Thông tin Affiliate Network</span>
                  {showAffiliateSection ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showAffiliateSection && (
                  <div className="p-4 space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">URL Affiliate</label>
                      <Input type="url" value={form.affiliate_url ?? ''} placeholder="https://affiliate.network/..."
                        onChange={e => setForm(f => ({ ...f, affiliate_url: e.target.value || null }))} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-600">Username</label>
                        <Input value={form.affiliate_username ?? ''} placeholder="username"
                          onChange={e => setForm(f => ({ ...f, affiliate_username: e.target.value || null }))} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-600">Password</label>
                        <div className="relative">
                          <Input type={showPassword ? 'text' : 'password'} value={form.affiliate_password ?? ''} placeholder="••••••"
                            onChange={e => setForm(f => ({ ...f, affiliate_password: e.target.value || null }))}
                            className="pr-9" />
                          <button type="button" onClick={() => setShowPassword(v => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Mạng Affiliate</label>
                      <Input value={form.affiliate_network ?? ''} placeholder="vd: AccessTrade, ClickBank, Impact..."
                        onChange={e => setForm(f => ({ ...f, affiliate_network: e.target.value || null }))} />
                    </div>
                  </div>
                )}
              </div>

              {/* ── Link Ref & Email Ref ── */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Link Ref</label>
                  <Input type="url" value={form.ref_link ?? ''} placeholder="https://..."
                    onChange={e => setForm(f => ({ ...f, ref_link: e.target.value || null }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Email Ref</label>
                  <Input type="email" value={form.email_ref ?? ''} placeholder="partner@..."
                    onChange={e => setForm(f => ({ ...f, email_ref: e.target.value || null }))} />
                </div>
              </div>

              {/* ── Tách chi phí QC theo link ref (khi nhiều ref chung 1 CID/campaign) ── */}
              <AttributionFields value={form} onChange={patch => setForm(f => ({ ...f, ...patch }))} />

              {/* ── Bank nhận ── */}
              <div className="border border-slate-100 rounded-lg p-3 space-y-3 bg-slate-50">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bank nhận (tuỳ chọn)</p>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Ngân hàng</label>
                  <select value={selectedBankId} onChange={e => handleBankChange(e.target.value)}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 bg-white">
                    <option value="">— Chọn ngân hàng —</option>
                    {banks.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.bank_category === 'crypto' ? '₿' : '🏦'} {b.name}
                        {b.bank_category === 'traditional' ? ` · ${b.type === 'international' ? 'Quốc tế' : 'Nội địa'}` : ' · Crypto'}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedBankId && (() => {
                  const selectedBank = banks.find(b => b.id === selectedBankId)
                  const isCrypto = selectedBank?.bank_category === 'crypto'
                  return (
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-slate-600">Tài khoản</label>
                      <select value={form.bank_account_id ?? ''} onChange={e => handleAccountChange(e.target.value)}
                        disabled={loadingAccounts}
                        className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-60 bg-white">
                        <option value="">— Chọn tài khoản —</option>
                        {accounts.map(a => isCrypto
                          ? <option key={a.id} value={a.id}>{a.coin_type} · {a.network} · {a.wallet_address ? shortenAddr(a.wallet_address) : '—'} · {a.owner_name}</option>
                          : <option key={a.id} value={a.id}>{a.account_identifier} · {a.owner_name}</option>
                        )}
                      </select>
                      {selectedAccount && (
                        isCrypto ? (
                          <div className="border border-green-200 bg-green-50 rounded-md px-3 py-2.5 space-y-1">
                            <p className="text-xs font-semibold text-green-800">{selectedBank?.name}</p>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-slate-700">{selectedAccount.coin_type}</span>
                              {selectedAccount.network && <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${networkStyle(selectedAccount.network)}`}>{selectedAccount.network}</span>}
                            </div>
                            {selectedAccount.wallet_address && (
                              <div className="flex items-center gap-1 font-mono text-xs text-slate-700">
                                <span className="break-all">{selectedAccount.wallet_address}</span>
                                <CopyBtn text={selectedAccount.wallet_address} />
                              </div>
                            )}
                            <p className="text-xs text-slate-500">Người quản lý: <span className="font-medium text-slate-700">{selectedAccount.owner_name}</span></p>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-md text-sm">
                            <span className="text-slate-500 text-xs">Người quản lý:</span>
                            <span className="font-medium text-slate-700">{selectedAccount.owner_name}</span>
                          </div>
                        )
                      )}
                    </div>
                  )
                })()}
              </div>
            </>
          )}

          {saveError && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded">{saveError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>Hủy</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu'}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
