'use client'

import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Project, MasterProject, PaymentAccount } from '@/lib/types'

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
  const [accounts, setAccounts] = useState<PaymentAccount[]>([])
  const [bankSearch, setBankSearch] = useState('')

  useEffect(() => {
    fetch('/api/payment-accounts')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setAccounts(d) })
      .catch(() => {})
  }, [])

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

  // Group accounts by bank_type for combobox display
  const grouped = accounts.reduce((acc, a) => {
    const key = a.bank_type
    if (!acc[key]) acc[key] = []
    acc[key].push(a)
    return acc
  }, {} as Record<string, PaymentAccount[]>)

  const filtered = bankSearch.trim()
    ? accounts.filter(a =>
        a.label.toLowerCase().includes(bankSearch.toLowerCase()) ||
        a.bank_type.toLowerCase().includes(bankSearch.toLowerCase()) ||
        a.manager_name.toLowerCase().includes(bankSearch.toLowerCase())
      )
    : null

  const selectedAccount = accounts.find(a => a.id === form.payment_account_id)

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

          {/* Bank Nhận */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-600">Bank Nhận (tuỳ chọn)</label>
            {accounts.length === 0 ? (
              <p className="text-xs text-slate-400 py-1">Chưa có tài khoản nào. Vào tab "Bank Nhận" để tạo trước.</p>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Tìm tài khoản..."
                  value={bankSearch || (selectedAccount ? `${selectedAccount.label} — ${selectedAccount.manager_name} (${selectedAccount.bank_type})` : '')}
                  onFocus={() => setBankSearch('')}
                  onChange={e => setBankSearch(e.target.value)}
                  className="cursor-pointer"
                />
                {bankSearch !== '' && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-56 overflow-y-auto">
                    <button
                      onMouseDown={() => { setForm(f => ({ ...f, payment_account_id: null, payment_accounts: null })); setBankSearch('') }}
                      className="w-full text-left px-3 py-2 text-sm text-slate-400 hover:bg-slate-50 border-b border-slate-100">
                      — Không chọn —
                    </button>
                    {(filtered ?? accounts).length === 0 && (
                      <p className="px-3 py-2 text-xs text-slate-400">Không tìm thấy</p>
                    )}
                    {filtered
                      ? filtered.map(acc => (
                          <button key={acc.id} onMouseDown={() => {
                            setForm(f => ({ ...f, payment_account_id: acc.id, payment_accounts: acc }))
                            setBankSearch('')
                          }} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-700">
                            <span className="text-slate-400 text-xs mr-1">{acc.bank_type}</span>
                            {acc.label} — {acc.manager_name}
                          </button>
                        ))
                      : Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([bankType, accs]) => (
                          <div key={bankType}>
                            <div className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide bg-slate-50">
                              {bankType}
                            </div>
                            {accs.map(acc => (
                              <button key={acc.id} onMouseDown={() => {
                                setForm(f => ({ ...f, payment_account_id: acc.id, payment_accounts: acc }))
                                setBankSearch('')
                              }} className="w-full text-left px-3 py-2 pl-5 text-sm hover:bg-slate-50 text-slate-700">
                                {acc.label} — {acc.manager_name}
                              </button>
                            ))}
                          </div>
                        ))
                    }
                  </div>
                )}
              </div>
            )}
            {selectedAccount && bankSearch === '' && (
              <p className="text-xs text-slate-500">
                {selectedAccount.bank_type} · {selectedAccount.account_number}
                <button onClick={() => setForm(f => ({ ...f, payment_account_id: null, payment_accounts: null }))}
                  className="ml-2 text-red-400 hover:text-red-600">✕ Bỏ chọn</button>
              </p>
            )}
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
