'use client'

import { useState, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Project, MasterProject, Bank, BankAccount } from '@/lib/types'

const NETWORK_STYLES: Record<string, string> = {
  TRC20:    'bg-green-100 text-green-700',
  ERC20:    'bg-blue-100 text-blue-700',
  BEP20:    'bg-yellow-100 text-yellow-700',
  SOL:      'bg-purple-100 text-purple-700',
  Bitcoin:  'bg-orange-100 text-orange-700',
  Lightning:'bg-yellow-100 text-yellow-700',
  TON:      'bg-cyan-100 text-cyan-700',
}

function networkStyle(n: string | null | undefined) {
  return NETWORK_STYLES[n ?? ''] ?? 'bg-slate-100 text-slate-600'
}

function shortenAddr(addr: string) {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) }}
      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors">
      {done ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
    </button>
  )
}

interface Props {
  mode: 'add' | 'edit'
  initialData?: Project
  existingIds: string[]
  masterProjects: MasterProject[]
  onSave: (project: Project) => void
  onClose: () => void
}

function nextProjectId(existingIds: string[]): string {
  const nums = existingIds
    .map(id => parseInt(id.replace('proj', ''), 10))
    .filter(n => !isNaN(n))
  const max = nums.length > 0 ? Math.max(...nums) : 0
  return `proj${String(max + 1).padStart(3, '0')}`
}

export default function ProjectFormDialog({ mode, initialData, existingIds, masterProjects, onSave, onClose }: Props) {
  const [form, setForm] = useState<Project>(
    initialData ?? { project_id: nextProjectId(existingIds), cid: '0000000000', name: '', mcc_id: 'uncategorized', master_project_id: null }
  )
  const [errors, setErrors] = useState<Partial<Record<keyof Project, string>>>({})

  // Bank cascading state
  const [banks, setBanks] = useState<Bank[]>([])
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [selectedBankId, setSelectedBankId] = useState<string>(initialData?.bank_accounts?.bank_id ?? '')
  const [loadingAccounts, setLoadingAccounts] = useState(false)

  // Derive selected account info for display
  const selectedAccount = accounts.find(a => a.id === form.bank_account_id)

  useEffect(() => {
    fetch('/api/banks')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setBanks(d) })
      .catch(() => {})
  }, [])

  // When editing: pre-load accounts for the initial bank
  useEffect(() => {
    if (selectedBankId) loadAccounts(selectedBankId)
  }, [selectedBankId])

  async function loadAccounts(bankId: string) {
    setLoadingAccounts(true)
    try {
      const res = await fetch(`/api/bank-accounts?bank_id=${bankId}`)
      const data = await res.json()
      if (Array.isArray(data)) setAccounts(data)
    } finally {
      setLoadingAccounts(false)
    }
  }

  function handleBankChange(bankId: string) {
    setSelectedBankId(bankId)
    setForm(f => ({ ...f, bank_account_id: null, bank_accounts: null }))
    setAccounts([])
    if (bankId) loadAccounts(bankId)
  }

  function handleAccountChange(accountId: string) {
    if (!accountId) {
      setForm(f => ({ ...f, bank_account_id: null, bank_accounts: null }))
      return
    }
    const acc = accounts.find(a => a.id === accountId)
    const bank = banks.find(b => b.id === selectedBankId)
    setForm(f => ({ ...f, bank_account_id: accountId, bank_accounts: acc ? { ...acc, banks: bank ?? null } : null }))
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof Project, string>> = {}
    if (!form.name.trim()) errs.name = 'Bắt buộc nhập tên'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  function handleSave() {
    if (validate()) {
      onSave(form)
      onClose()
    }
  }

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'add' ? 'Thêm dự án mới' : 'Chỉnh sửa dự án'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          {mode === 'edit' && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Project ID</label>
              <Input value={form.project_id} disabled className="text-slate-400" />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Tên dự án</label>
            <Input
              value={form.name}
              placeholder="Thời trang nữ 001"
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className={errors.name ? 'border-red-400' : ''}
              autoFocus
            />
            {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Tổng Dự Án (tuỳ chọn)</label>
            <select
              value={form.master_project_id ?? ''}
              onChange={e => setForm(f => ({ ...f, master_project_id: e.target.value || null }))}
              className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            >
              <option value="">— Chưa phân nhóm —</option>
              {masterProjects.map(mp => <option key={mp.id} value={mp.id}>{mp.name}</option>)}
            </select>
          </div>

          {/* Link Ref */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Link Ref (tuỳ chọn)</label>
            <Input
              type="url"
              value={form.ref_link ?? ''}
              placeholder="https://..."
              onChange={e => setForm(f => ({ ...f, ref_link: e.target.value || null }))}
            />
          </div>

          {/* Bank cascading */}
          <div className="space-y-3 pt-1 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Bank nhận (tuỳ chọn)</p>

            {/* Step 1: chọn bank */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Ngân hàng</label>
              <select
                value={selectedBankId}
                onChange={e => handleBankChange(e.target.value)}
                className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="">— Chọn ngân hàng —</option>
                {banks.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.bank_category === 'crypto' ? '₿' : '🏦'} {b.name}
                    {b.bank_category === 'traditional' ? ` · ${b.type === 'international' ? 'Quốc tế' : 'Nội địa'}` : ' · Crypto'}
                  </option>
                ))}
              </select>
            </div>

            {/* Step 2: chọn tài khoản */}
            {selectedBankId && (() => {
              const selectedBank = banks.find(b => b.id === selectedBankId)
              const isCrypto = selectedBank?.bank_category === 'crypto'
              return (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-600">Tài khoản</label>
                  <select
                    value={form.bank_account_id ?? ''}
                    onChange={e => handleAccountChange(e.target.value)}
                    disabled={loadingAccounts}
                    className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300 disabled:opacity-60"
                  >
                    <option value="">— Chọn tài khoản —</option>
                    {accounts.map(a => isCrypto
                      ? <option key={a.id} value={a.id}>{a.coin_type} · {a.network} · {a.wallet_address ? shortenAddr(a.wallet_address) : '—'} · {a.owner_name}</option>
                      : <option key={a.id} value={a.id}>{a.account_identifier} · {a.owner_name}</option>
                    )}
                  </select>

                  {/* Confirmation card */}
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
                      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-md text-sm">
                        <span className="text-slate-500 text-xs">Người quản lý:</span>
                        <span className="font-medium text-slate-700">{selectedAccount.owner_name}</span>
                      </div>
                    )
                  )}
                </div>
              )
            })()}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Hủy</Button>
            <Button onClick={handleSave}>Lưu</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
