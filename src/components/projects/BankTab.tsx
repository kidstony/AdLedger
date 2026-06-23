'use client'

import { useState, useEffect, useMemo } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PaymentAccount, Project } from '@/lib/types'

interface Props {
  projects: Project[]
}

const BANK_SUGGESTIONS = ['PayPal', 'Payoneer', 'Wise', 'Vietcombank', 'MB Bank', 'Techcombank', 'BIDV', 'ACB', 'TPBank', 'VPBank']

interface FormState {
  bank_type: string
  label: string
  manager_name: string
  account_number: string
}

const EMPTY_FORM: FormState = { bank_type: '', label: '', manager_name: '', account_number: '' }

export default function BankTab({ projects }: Props) {
  const [accounts, setAccounts] = useState<PaymentAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ mode: 'add' | 'edit'; data?: PaymentAccount } | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<PaymentAccount | null>(null)
  const [bankInput, setBankInput] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)

  useEffect(() => {
    fetch('/api/payment-accounts')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setAccounts(d) })
      .finally(() => setLoading(false))
  }, [])

  // Count how many projects use each account
  const usageCount = useMemo(() => {
    const map = new Map<string, number>()
    projects.forEach(p => {
      if (p.payment_account_id) map.set(p.payment_account_id, (map.get(p.payment_account_id) ?? 0) + 1)
    })
    return map
  }, [projects])

  // Group accounts by bank_type
  const grouped = useMemo(() => {
    const groups = new Map<string, PaymentAccount[]>()
    accounts.forEach(acc => {
      if (!groups.has(acc.bank_type)) groups.set(acc.bank_type, [])
      groups.get(acc.bank_type)!.push(acc)
    })
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [accounts])

  // Existing bank types for suggestions
  const existingTypes = useMemo(() => [...new Set(accounts.map(a => a.bank_type))], [accounts])
  const allSuggestions = [...new Set([...BANK_SUGGESTIONS, ...existingTypes])]

  function openAdd() {
    setForm(EMPTY_FORM)
    setBankInput('')
    setDialog({ mode: 'add' })
  }

  function openEdit(acc: PaymentAccount) {
    setForm({ bank_type: acc.bank_type, label: acc.label, manager_name: acc.manager_name, account_number: acc.account_number })
    setBankInput(acc.bank_type)
    setDialog({ mode: 'edit', data: acc })
  }

  async function handleSave() {
    const bankType = bankInput.trim() || form.bank_type
    if (!bankType || !form.label.trim() || !form.manager_name.trim() || !form.account_number.trim()) return
    setSaving(true)
    try {
      if (dialog?.mode === 'add') {
        const res = await fetch('/api/payment-accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, bank_type: bankType }),
        })
        const created = await res.json()
        if (created.id) setAccounts(prev => [...prev, created])
      } else if (dialog?.data) {
        const res = await fetch('/api/payment-accounts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: dialog.data.id, ...form, bank_type: bankType }),
        })
        const updated = await res.json()
        if (updated.id) setAccounts(prev => prev.map(a => a.id === updated.id ? updated : a))
      }
      setDialog(null)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(acc: PaymentAccount) {
    await fetch(`/api/payment-accounts?id=${acc.id}`, { method: 'DELETE' })
    setAccounts(prev => prev.filter(a => a.id !== acc.id))
    setConfirmDelete(null)
  }

  const filteredSuggestions = allSuggestions.filter(s => s.toLowerCase().includes(bankInput.toLowerCase()) && s !== bankInput)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{accounts.length} tài khoản · {grouped.length} ngân hàng</p>
        <Button onClick={openAdd} className="gap-1.5"><Plus size={14} /> Thêm tài khoản</Button>
      </div>

      {loading ? (
        <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
          {[1, 2, 3].map(i => (
            <div key={i} className="px-4 py-3 flex gap-4">
              <div className="w-32 h-3 bg-slate-200 rounded animate-pulse" />
              <div className="w-24 h-3 bg-slate-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="border border-slate-200 rounded-lg p-10 text-center text-sm text-slate-400">
          Chưa có tài khoản nào. Nhấn "+ Thêm tài khoản" để bắt đầu.
        </div>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['Ngân hàng', 'Nhãn tài khoản', 'Người quản lý', 'Số TK / Email', 'Dự án dùng', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.map(([bankType, accs]) => (
                accs.map((acc, idx) => (
                  <tr key={acc.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      {idx === 0 ? (
                        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{bankType}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-800">{acc.label}</td>
                    <td className="px-4 py-3 text-slate-600">{acc.manager_name}</td>
                    <td className="px-4 py-3 font-mono text-slate-500 text-xs">{acc.account_number}</td>
                    <td className="px-4 py-3">
                      {(usageCount.get(acc.id) ?? 0) > 0 ? (
                        <span className="text-xs px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full">
                          {usageCount.get(acc.id)} dự án
                        </span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(acc)}
                          className="p-1.5 rounded hover:bg-slate-200 text-slate-500 transition-colors">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => setConfirmDelete(acc)}
                          className="p-1.5 rounded hover:bg-red-100 text-slate-500 hover:text-red-600 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit dialog */}
      {dialog && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-4">
              {dialog.mode === 'add' ? 'Thêm tài khoản ngân hàng' : 'Sửa tài khoản'}
            </h3>
            <div className="space-y-3">
              {/* Bank type with suggestions */}
              <div className="space-y-1 relative">
                <label className="text-xs font-medium text-slate-600">Loại ngân hàng</label>
                <Input
                  value={bankInput}
                  onChange={e => { setBankInput(e.target.value); setShowSuggestions(true) }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                  placeholder="PayPal, MB Bank, Vietcombank..."
                />
                {showSuggestions && filteredSuggestions.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {filteredSuggestions.map(s => (
                      <button key={s} onMouseDown={() => { setBankInput(s); setShowSuggestions(false) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 text-slate-700">
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Nhãn tài khoản</label>
                <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  placeholder="PayPal #1, TK Chính..." />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Người quản lý</label>
                <Input value={form.manager_name} onChange={e => setForm(f => ({ ...f, manager_name: e.target.value }))}
                  placeholder="Nguyễn Văn A" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Số tài khoản / Email</label>
                <Input value={form.account_number} onChange={e => setForm(f => ({ ...f, account_number: e.target.value }))}
                  placeholder="0901234567 hoặc email@example.com" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" onClick={() => setDialog(null)}>Hủy</Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving ? 'Đang lưu...' : 'Lưu'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-semibold text-slate-800 mb-2">Xóa tài khoản?</h3>
            <p className="text-sm text-slate-600 mb-1">
              <strong>{confirmDelete.label}</strong> ({confirmDelete.bank_type}) sẽ bị xóa.
            </p>
            {(usageCount.get(confirmDelete.id) ?? 0) > 0 && (
              <p className="text-sm text-amber-600 mb-4">
                {usageCount.get(confirmDelete.id)} dự án đang dùng tài khoản này sẽ bị bỏ liên kết.
              </p>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Hủy</Button>
              <Button variant="destructive" onClick={() => handleDelete(confirmDelete)}>Xóa</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
