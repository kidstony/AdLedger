'use client'

import { useState, useEffect, useMemo } from 'react'
import { useProjectsContext } from '@/context/ProjectsContext'
import { supabase } from '@/lib/supabase'
import type { AccountRentalRate, CostCategory, OtherCost, Project, RentalRateType } from '@/lib/types'

// ─── Date helpers ───────────────────────────────────────────────────────────

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function todayStr() { return localDateStr(new Date()) }
function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

// ─── Rental cost computation ─────────────────────────────────────────────────

function computeRentalCost(
  rate: AccountRentalRate,
  from: string,
  to: string,
  adSpendByCid: Map<string, number>
): number {
  if (rate.rate_type === 'one_time') {
    const pd = rate.payment_date ?? ''
    return pd >= from && pd <= to ? rate.rate_value : 0
  }

  const periodStart = rate.period_from ?? '1900-01-01'
  const periodEnd = rate.period_to ?? '9999-12-31'
  const overlapFrom = from > periodStart ? from : periodStart
  const overlapTo = to < periodEnd ? to : periodEnd
  if (overlapFrom > overlapTo) return 0

  const msPerDay = 86400000
  const days = Math.round((new Date(overlapTo + 'T00:00:00').getTime() - new Date(overlapFrom + 'T00:00:00').getTime()) / msPerDay) + 1

  switch (rate.rate_type) {
    case 'percentage':
      return (adSpendByCid.get(rate.cid ?? '') ?? 0) * (rate.rate_value / 100)
    case 'daily':
      return rate.rate_value * days
    case 'weekly':
      return rate.rate_value * (days / 7)
    case 'monthly': {
      let total = 0
      let cur = new Date(overlapFrom + 'T00:00:00')
      const end = new Date(overlapTo + 'T00:00:00')
      while (cur <= end) {
        const y = cur.getFullYear()
        const mon = cur.getMonth()
        const daysInMonth = new Date(y, mon + 1, 0).getDate()
        const monthEnd = new Date(y, mon + 1, 0)
        const chunkTo = end < monthEnd ? end : monthEnd
        const daysInChunk = Math.round((chunkTo.getTime() - cur.getTime()) / msPerDay) + 1
        total += rate.rate_value * (daysInChunk / daysInMonth)
        cur = new Date(y, mon + 1, 1)
      }
      return total
    }
  }
  return 0
}

// ─── Constants ───────────────────────────────────────────────────────────────

const RATE_TYPE_LABELS: Record<RentalRateType, string> = {
  percentage: '% Ad Spend',
  daily: '/ngày',
  weekly: '/tuần',
  monthly: '/tháng',
  one_time: '1 lần',
}

const COLORS = ['blue', 'orange', 'green', 'red', 'purple', 'yellow', 'pink', 'slate'] as const
type ColorKey = (typeof COLORS)[number]

const COLOR_CLASSES: Record<string, string> = {
  blue:   'bg-blue-500/20 text-blue-300',
  orange: 'bg-orange-500/20 text-orange-300',
  green:  'bg-green-500/20 text-green-300',
  red:    'bg-red-500/20 text-red-300',
  purple: 'bg-purple-500/20 text-purple-300',
  yellow: 'bg-yellow-500/20 text-yellow-300',
  pink:   'bg-pink-500/20 text-pink-300',
  slate:  'bg-slate-500/20 text-slate-300',
}

const COLOR_DOT: Record<string, string> = {
  blue:   'bg-blue-500',
  orange: 'bg-orange-500',
  green:  'bg-green-500',
  red:    'bg-red-500',
  purple: 'bg-purple-500',
  yellow: 'bg-yellow-500',
  pink:   'bg-pink-500',
  slate:  'bg-slate-500',
}

function fmt(n: number) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── Form types ──────────────────────────────────────────────────────────────

interface RentalForm {
  account_label: string; cid: string; project_id: string
  rate_type: RentalRateType; rate_value: string
  period_from: string; period_to: string; payment_date: string; note: string
}

interface OtherForm {
  date: string; category_id: string; amount: string
  description: string; project_id: string
}

interface CategoryForm { name: string; color: ColorKey }

// ─── Main page ───────────────────────────────────────────────────────────────

type Tab = 'qc' | 'rental' | 'other'

export default function ExpensesPage() {
  const { projects } = useProjectsContext()
  const [tab, setTab] = useState<Tab>('qc')
  const [fromStr, setFromStr] = useState(firstOfMonthStr)
  const [toStr, setToStr] = useState(todayStr)

  // Tab 1
  const [adSpendRows, setAdSpendRows] = useState<{ campaign_id: string; date: string; spend: number }[]>([])

  // Tab 2
  const [rentalRates, setRentalRates] = useState<AccountRentalRate[]>([])
  const [showRentalModal, setShowRentalModal] = useState(false)
  const [editingRental, setEditingRental] = useState<AccountRentalRate | null>(null)
  const [rentalForm, setRentalForm] = useState<RentalForm>({
    account_label: '', cid: '', project_id: '', rate_type: 'percentage',
    rate_value: '', period_from: firstOfMonthStr(), period_to: '', payment_date: '', note: '',
  })
  const [rentalSaving, setRentalSaving] = useState(false)

  // Tab 3
  const [otherCosts, setOtherCosts] = useState<OtherCost[]>([])
  const [categories, setCategories] = useState<CostCategory[]>([])
  const [showOtherModal, setShowOtherModal] = useState(false)
  const [editingOther, setEditingOther] = useState<OtherCost | null>(null)
  const [otherForm, setOtherForm] = useState<OtherForm>({
    date: todayStr(), category_id: '', amount: '', description: '', project_id: '',
  })
  const [otherSaving, setOtherSaving] = useState(false)
  const [showCategoryPanel, setShowCategoryPanel] = useState(false)
  const [editingCategory, setEditingCategory] = useState<CostCategory | null>(null)
  const [categoryForm, setCategoryForm] = useState<CategoryForm>({ name: '', color: 'blue' })
  const [categorySaving, setCategorySaving] = useState(false)

  // ── Derived maps ──────────────────────────────────────────────────────────

  const projectByCampaignId = useMemo(
    () => new Map(projects.filter(p => p.google_campaign_id).map(p => [p.google_campaign_id!, p])),
    [projects]
  )

  const spendByProject = useMemo(() => {
    const map = new Map<string, number>()
    adSpendRows.forEach(row => {
      const p = projectByCampaignId.get(row.campaign_id)
      if (!p) return
      map.set(p.project_id, (map.get(p.project_id) ?? 0) + row.spend)
    })
    return map
  }, [adSpendRows, projectByCampaignId])

  const adSpendByCid = useMemo(() => {
    const map = new Map<string, number>()
    adSpendRows.forEach(row => {
      const p = projectByCampaignId.get(row.campaign_id)
      if (!p) return
      map.set(p.cid, (map.get(p.cid) ?? 0) + row.spend)
    })
    return map
  }, [adSpendRows, projectByCampaignId])

  const rentalWithCost = useMemo(
    () => rentalRates.map(r => ({ ...r, cost: computeRentalCost(r, fromStr, toStr, adSpendByCid) })),
    [rentalRates, fromStr, toStr, adSpendByCid]
  )

  const totalQc = useMemo(() => [...spendByProject.values()].reduce((a, b) => a + b, 0), [spendByProject])
  const totalRental = useMemo(() => rentalWithCost.reduce((a, r) => a + r.cost, 0), [rentalWithCost])
  const totalOther = useMemo(() => otherCosts.reduce((a, c) => a + c.amount, 0), [otherCosts])

  const adSpendProjects = useMemo(() => {
    const seen = new Set<string>()
    const result: { project_id: string; name: string; cid: string; spend: number }[] = []
    adSpendRows.forEach(row => {
      const p = projectByCampaignId.get(row.campaign_id)
      if (!p || seen.has(p.project_id)) return
      seen.add(p.project_id)
      result.push({ project_id: p.project_id, name: p.name, cid: p.cid, spend: spendByProject.get(p.project_id) ?? 0 })
    })
    return result.sort((a, b) => b.spend - a.spend)
  }, [adSpendRows, projectByCampaignId, spendByProject])

  const categoryMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])

  // ── Fetchers ──────────────────────────────────────────────────────────────

  async function fetchAdSpend() {
    const { data } = await supabase
      .from('ad_spend')
      .select('campaign_id, date, spend')
      .gte('date', fromStr)
      .lte('date', toStr)
    setAdSpendRows(data ?? [])
  }

  async function fetchRentalRates() {
    const res = await fetch('/api/expenses/rental-rates')
    if (res.ok) setRentalRates(await res.json())
  }

  async function fetchOtherCosts() {
    const res = await fetch(`/api/expenses/other?from=${fromStr}&to=${toStr}`)
    if (res.ok) setOtherCosts(await res.json())
  }

  async function fetchCategories() {
    const res = await fetch('/api/expenses/categories')
    if (res.ok) setCategories(await res.json())
  }

  useEffect(() => {
    fetchAdSpend()
    fetchOtherCosts()
  }, [fromStr, toStr]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchRentalRates()
    fetchCategories()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rental CRUD ───────────────────────────────────────────────────────────

  function openAddRental() {
    setEditingRental(null)
    setRentalForm({ account_label: '', cid: '', project_id: '', rate_type: 'percentage', rate_value: '', period_from: fromStr, period_to: '', payment_date: '', note: '' })
    setShowRentalModal(true)
  }

  function openEditRental(rate: AccountRentalRate) {
    setEditingRental(rate)
    setRentalForm({
      account_label: rate.account_label, cid: rate.cid ?? '', project_id: rate.project_id ?? '',
      rate_type: rate.rate_type, rate_value: String(rate.rate_value),
      period_from: rate.period_from ?? '', period_to: rate.period_to ?? '',
      payment_date: rate.payment_date ?? '', note: rate.note ?? '',
    })
    setShowRentalModal(true)
  }

  async function saveRental() {
    setRentalSaving(true)
    const payload = {
      ...(editingRental ? { id: editingRental.id } : {}),
      account_label: rentalForm.account_label.trim(),
      cid: rentalForm.cid.trim() || null,
      project_id: rentalForm.project_id || null,
      rate_type: rentalForm.rate_type,
      rate_value: parseFloat(rentalForm.rate_value) || 0,
      period_from: rentalForm.rate_type !== 'one_time' ? (rentalForm.period_from || null) : null,
      period_to: rentalForm.rate_type !== 'one_time' ? (rentalForm.period_to || null) : null,
      payment_date: rentalForm.rate_type === 'one_time' ? (rentalForm.payment_date || null) : null,
      note: rentalForm.note.trim() || null,
    }
    const res = await fetch('/api/expenses/rental-rates', {
      method: editingRental ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) { await fetchRentalRates(); setShowRentalModal(false) }
    setRentalSaving(false)
  }

  async function deleteRental(id: string) {
    if (!confirm('Xóa cấu hình này?')) return
    await fetch('/api/expenses/rental-rates', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    await fetchRentalRates()
  }

  // ── Other CRUD ────────────────────────────────────────────────────────────

  function openAddOther() {
    setEditingOther(null)
    setOtherForm({ date: toStr, category_id: '', amount: '', description: '', project_id: '' })
    setShowOtherModal(true)
  }

  function openEditOther(cost: OtherCost) {
    setEditingOther(cost)
    setOtherForm({
      date: cost.date, category_id: cost.category_id ?? '',
      amount: String(cost.amount), description: cost.description ?? '', project_id: cost.project_id ?? '',
    })
    setShowOtherModal(true)
  }

  async function saveOther() {
    setOtherSaving(true)
    const payload = {
      ...(editingOther ? { id: editingOther.id } : {}),
      date: otherForm.date,
      category_id: otherForm.category_id || null,
      amount: parseFloat(otherForm.amount) || 0,
      description: otherForm.description.trim() || null,
      project_id: otherForm.project_id || null,
    }
    const res = await fetch('/api/expenses/other', {
      method: editingOther ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) { await fetchOtherCosts(); setShowOtherModal(false) }
    setOtherSaving(false)
  }

  async function deleteOther(id: string) {
    if (!confirm('Xóa khoản chi phí này?')) return
    await fetch('/api/expenses/other', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    await fetchOtherCosts()
  }

  // ── Category CRUD ─────────────────────────────────────────────────────────

  function openEditCategory(cat: CostCategory) {
    setEditingCategory(cat)
    setCategoryForm({ name: cat.name, color: cat.color as ColorKey })
  }

  function openAddCategory() {
    setEditingCategory(null)
    setCategoryForm({ name: '', color: 'blue' })
  }

  async function saveCategory() {
    setCategorySaving(true)
    const payload = {
      ...(editingCategory ? { id: editingCategory.id } : {}),
      name: categoryForm.name.trim(),
      color: categoryForm.color,
    }
    const res = await fetch('/api/expenses/categories', {
      method: editingCategory ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) { await fetchCategories(); openAddCategory() }
    setCategorySaving(false)
  }

  async function deleteCategory(id: string) {
    if (!confirm('Xóa danh mục này? Các chi phí liên quan sẽ mất danh mục.')) return
    await fetch('/api/expenses/categories', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    await Promise.all([fetchCategories(), fetchOtherCosts()])
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-white">Nhập Chi Phí</h1>
        <div className="flex items-center gap-2">
          <input type="date" value={fromStr} onChange={e => setFromStr(e.target.value)}
            className="bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm" />
          <span className="text-slate-500">—</span>
          <input type="date" value={toStr} onChange={e => setToStr(e.target.value)}
            className="bg-slate-800 border border-slate-600 text-white rounded px-3 py-1.5 text-sm" />
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Chi phí QC" value={totalQc} sub="Auto sync" active={tab === 'qc'} onClick={() => setTab('qc')} />
        <SummaryCard label="Thuê tài khoản" value={totalRental} sub="Tự tính" active={tab === 'rental'} onClick={() => setTab('rental')} />
        <SummaryCard label="Chi phí khác" value={totalOther} sub={`${otherCosts.length} khoản`} active={tab === 'other'} onClick={() => setTab('other')} />
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-700 flex">
        {(['qc', 'rental', 'other'] as Tab[]).map((t, i) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t ? 'border-blue-400 text-blue-400' : 'border-transparent text-slate-400 hover:text-white'
            }`}>
            {['Chi phí QC', 'Thuê tài khoản', 'Chi phí khác'][i]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'qc' && <QcTab projects={adSpendProjects} total={totalQc} />}
      {tab === 'rental' && (
        <RentalTab rates={rentalWithCost} total={totalRental} projects={projects}
          onAdd={openAddRental} onEdit={openEditRental} onDelete={deleteRental} />
      )}
      {tab === 'other' && (
        <OtherTab costs={otherCosts} total={totalOther} categories={categories}
          categoryMap={categoryMap} projects={projects}
          onAdd={openAddOther} onEdit={openEditOther} onDelete={deleteOther}
          onManageCategories={() => setShowCategoryPanel(true)} />
      )}

      {/* Rental modal */}
      {showRentalModal && (
        <RentalModal form={rentalForm} editing={!!editingRental} projects={projects}
          saving={rentalSaving} onChange={setRentalForm}
          onSave={saveRental} onClose={() => setShowRentalModal(false)} />
      )}

      {/* Other cost modal */}
      {showOtherModal && (
        <OtherModal form={otherForm} editing={!!editingOther} categories={categories}
          projects={projects} saving={otherSaving} onChange={setOtherForm}
          onSave={saveOther} onClose={() => setShowOtherModal(false)} />
      )}

      {/* Category panel */}
      {showCategoryPanel && (
        <CategoryPanel categories={categories} editingCategory={editingCategory}
          form={categoryForm} saving={categorySaving}
          onFormChange={setCategoryForm} onEdit={openEditCategory}
          onSave={saveCategory} onDelete={deleteCategory} onAddNew={openAddCategory}
          onClose={() => { setShowCategoryPanel(false); openAddCategory() }} />
      )}
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, active, onClick }: {
  label: string; value: number; sub: string; active: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className={`text-left rounded-lg border p-4 transition-colors w-full ${
        active ? 'border-blue-500 bg-blue-900/20' : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
      }`}>
      <div className="text-slate-400 text-xs mb-1">{label}</div>
      <div className="text-white text-2xl font-bold">{fmt(value)}</div>
      <div className="text-slate-500 text-xs mt-0.5">{sub}</div>
    </button>
  )
}

function QcTab({ projects, total }: {
  projects: { project_id: string; name: string; cid: string; spend: number }[]
  total: number
}) {
  if (projects.length === 0) {
    return <div className="text-slate-500 text-sm py-12 text-center">Không có dữ liệu ad spend trong khoảng ngày này.</div>
  }
  return (
    <div className="overflow-auto rounded-lg border border-slate-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wide">
            <th className="text-left px-4 py-3">Dự án</th>
            <th className="text-left px-4 py-3">CID</th>
            <th className="text-right px-4 py-3">Chi phí QC</th>
          </tr>
        </thead>
        <tbody>
          {projects.map(p => (
            <tr key={p.project_id} className="border-t border-slate-700/50 hover:bg-slate-800/30">
              <td className="px-4 py-2.5 text-white">{p.name}</td>
              <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{p.cid}</td>
              <td className="px-4 py-2.5 text-right text-white font-medium">{fmt(p.spend)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-slate-600 bg-slate-800/60">
            <td colSpan={2} className="px-4 py-2.5 text-slate-400 text-xs font-semibold">TỔNG</td>
            <td className="px-4 py-2.5 text-right text-white font-bold">{fmt(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

type RentalWithCost = AccountRentalRate & { cost: number }

function RentalTab({ rates, total, projects, onAdd, onEdit, onDelete }: {
  rates: RentalWithCost[]
  total: number
  projects: Project[]
  onAdd: () => void
  onEdit: (r: AccountRentalRate) => void
  onDelete: (id: string) => void
}) {
  const projectMap = useMemo(() => new Map(projects.map(p => [p.project_id, p.name])), [projects])
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-slate-500 text-xs">Chi phí kỳ này tự tính theo khoảng ngày đã chọn.</p>
        <button onClick={onAdd}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-1.5 rounded-md font-medium transition-colors">
          + Thêm cấu hình
        </button>
      </div>
      <div className="overflow-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3">CID / Tài khoản</th>
              <th className="text-left px-4 py-3">Dự án</th>
              <th className="text-left px-4 py-3">Dạng phí</th>
              <th className="text-left px-4 py-3">Giá trị</th>
              <th className="text-left px-4 py-3">Áp dụng từ</th>
              <th className="text-right px-4 py-3">Chi phí kỳ này</th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-500">
                  Chưa có cấu hình. Nhấn "+ Thêm cấu hình" để bắt đầu.
                </td>
              </tr>
            )}
            {rates.map(r => (
              <tr key={r.id} className="border-t border-slate-700/50 hover:bg-slate-800/30">
                <td className="px-4 py-2.5">
                  <div className="text-white font-medium">{r.account_label}</div>
                  {r.cid && <div className="text-slate-500 font-mono text-xs mt-0.5">{r.cid}</div>}
                </td>
                <td className="px-4 py-2.5 text-slate-300 text-xs">
                  {r.project_id ? (projectMap.get(r.project_id) ?? r.project_id) : <span className="text-slate-600">(chung)</span>}
                </td>
                <td className="px-4 py-2.5">
                  <span className="text-xs bg-slate-700 text-slate-300 px-2 py-0.5 rounded">{RATE_TYPE_LABELS[r.rate_type]}</span>
                </td>
                <td className="px-4 py-2.5 text-white font-mono text-xs">
                  {r.rate_type === 'percentage' ? `${r.rate_value}%` : fmt(r.rate_value)}
                </td>
                <td className="px-4 py-2.5 text-slate-400 text-xs">
                  {r.rate_type === 'one_time' ? (r.payment_date ?? '—') : (r.period_from ?? '—')}
                </td>
                <td className="px-4 py-2.5 text-right font-bold text-white">{fmt(r.cost)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => onEdit(r)} className="text-slate-400 hover:text-white text-xs">Sửa</button>
                    <button onClick={() => onDelete(r.id)} className="text-red-400 hover:text-red-300 text-xs">Xóa</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {rates.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-600 bg-slate-800/60">
                <td colSpan={5} className="px-4 py-2.5 text-slate-400 text-xs font-semibold">TỔNG</td>
                <td className="px-4 py-2.5 text-right text-white font-bold">{fmt(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

function OtherTab({ costs, total, categories, categoryMap, projects, onAdd, onEdit, onDelete, onManageCategories }: {
  costs: OtherCost[]
  total: number
  categories: CostCategory[]
  categoryMap: Map<string, CostCategory>
  projects: Project[]
  onAdd: () => void
  onEdit: (c: OtherCost) => void
  onDelete: (id: string) => void
  onManageCategories: () => void
}) {
  const projectMap = useMemo(() => new Map(projects.map(p => [p.project_id, p.name])), [projects])
  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <button onClick={onManageCategories}
          className="text-slate-400 hover:text-white text-xs transition-colors">
          ⚙ Quản lý danh mục
        </button>
        <button onClick={onAdd}
          className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-1.5 rounded-md font-medium transition-colors">
          + Thêm chi phí
        </button>
      </div>
      <div className="overflow-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3">Ngày</th>
              <th className="text-left px-4 py-3">Danh mục</th>
              <th className="text-right px-4 py-3">Số tiền</th>
              <th className="text-left px-4 py-3">Mô tả</th>
              <th className="text-left px-4 py-3">Dự án</th>
              <th className="px-4 py-3 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {costs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  Chưa có chi phí nào trong khoảng ngày này.
                </td>
              </tr>
            )}
            {costs.map(c => {
              const cat = c.category_id ? categoryMap.get(c.category_id) : null
              return (
                <tr key={c.id} className="border-t border-slate-700/50 hover:bg-slate-800/30">
                  <td className="px-4 py-2.5 text-slate-300 font-mono text-xs">{c.date}</td>
                  <td className="px-4 py-2.5">
                    {cat
                      ? <span className={`text-xs px-2 py-0.5 rounded ${COLOR_CLASSES[cat.color] ?? COLOR_CLASSES.slate}`}>{cat.name}</span>
                      : <span className="text-slate-600 text-xs">—</span>
                    }
                  </td>
                  <td className="px-4 py-2.5 text-right text-white font-medium">{fmt(c.amount)}</td>
                  <td className="px-4 py-2.5 text-slate-300 max-w-xs truncate">{c.description ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">
                    {c.project_id ? (projectMap.get(c.project_id) ?? c.project_id) : <span className="text-slate-600">(chung)</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => onEdit(c)} className="text-slate-400 hover:text-white text-xs">Sửa</button>
                      <button onClick={() => onDelete(c.id)} className="text-red-400 hover:text-red-300 text-xs">Xóa</button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {costs.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-600 bg-slate-800/60">
                <td colSpan={2} className="px-4 py-2.5 text-slate-400 text-xs font-semibold">TỔNG</td>
                <td className="px-4 py-2.5 text-right text-white font-bold">{fmt(total)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function RentalModal({ form, editing, projects, saving, onChange, onSave, onClose }: {
  form: RentalForm; editing: boolean; projects: Project[]
  saving: boolean; onChange: (f: RentalForm) => void
  onSave: () => void; onClose: () => void
}) {
  function set(patch: Partial<RentalForm>) { onChange({ ...form, ...patch }) }
  const isOneTime = form.rate_type === 'one_time'
  const valueLabel = {
    percentage: 'Tỷ lệ (%)', daily: 'Phí / ngày ($)',
    weekly: 'Phí / tuần ($)', monthly: 'Phí / tháng ($)', one_time: 'Số tiền ($)',
  }[form.rate_type]

  const uniqueCids = [...new Set(projects.map(p => p.cid))]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold mb-5">{editing ? 'Sửa cấu hình' : 'Thêm cấu hình thuê tài khoản'}</h2>
        <div className="space-y-4">
          <Field label="CID / Tên tài khoản *">
            <input value={form.account_label} onChange={e => set({ account_label: e.target.value })}
              placeholder="VD: CID-1234 hoặc Account #45" className={INPUT} />
          </Field>
          <Field label="CID (Google Customer ID)">
            <select value={form.cid} onChange={e => set({ cid: e.target.value })} className={INPUT}>
              <option value="">— Không gắn CID —</option>
              {uniqueCids.map(cid => <option key={cid} value={cid}>{cid}</option>)}
            </select>
          </Field>
          <Field label="Dạng phí">
            <div className="grid grid-cols-3 gap-2">
              {(['percentage', 'daily', 'weekly', 'monthly', 'one_time'] as RentalRateType[]).map(t => (
                <button key={t} onClick={() => set({ rate_type: t })}
                  className={`py-1.5 text-xs rounded border transition-colors ${
                    form.rate_type === t ? 'border-blue-500 bg-blue-500/10 text-blue-300' : 'border-slate-600 text-slate-400 hover:border-slate-500'
                  }`}>
                  {RATE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </Field>
          <Field label={`${valueLabel} *`}>
            <input type="number" min={0} step="0.01" value={form.rate_value}
              onChange={e => set({ rate_value: e.target.value })} className={INPUT} />
          </Field>
          {!isOneTime && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Áp dụng từ">
                <input type="date" value={form.period_from} onChange={e => set({ period_from: e.target.value })} className={INPUT} />
              </Field>
              <Field label="Kết thúc (trống = vô thời hạn)">
                <input type="date" value={form.period_to} onChange={e => set({ period_to: e.target.value })} className={INPUT} />
              </Field>
            </div>
          )}
          {isOneTime && (
            <Field label="Ngày thanh toán *">
              <input type="date" value={form.payment_date} onChange={e => set({ payment_date: e.target.value })} className={INPUT} />
            </Field>
          )}
          <Field label="Ghi chú">
            <input value={form.note} onChange={e => set({ note: e.target.value })} className={INPUT} />
          </Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm px-4 py-2 rounded">Hủy</button>
          <button onClick={onSave} disabled={saving || !form.account_label.trim() || !form.rate_value}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-5 py-2 rounded font-medium transition-colors">
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

function OtherModal({ form, editing, categories, projects, saving, onChange, onSave, onClose }: {
  form: OtherForm; editing: boolean; categories: CostCategory[]
  projects: Project[]; saving: boolean; onChange: (f: OtherForm) => void
  onSave: () => void; onClose: () => void
}) {
  function set(patch: Partial<OtherForm>) { onChange({ ...form, ...patch }) }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
        <h2 className="text-white font-semibold mb-5">{editing ? 'Sửa chi phí' : 'Thêm chi phí khác'}</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ngày *">
              <input type="date" value={form.date} onChange={e => set({ date: e.target.value })} className={INPUT} />
            </Field>
            <Field label="Số tiền ($) *">
              <input type="number" min={0} step="0.01" value={form.amount}
                onChange={e => set({ amount: e.target.value })} className={INPUT} />
            </Field>
          </div>
          <Field label="Danh mục">
            <select value={form.category_id} onChange={e => set({ category_id: e.target.value })} className={INPUT}>
              <option value="">— Không có danh mục —</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Mô tả">
            <input value={form.description} onChange={e => set({ description: e.target.value })} className={INPUT} />
          </Field>
          <Field label="Dự án (tuỳ chọn)">
            <select value={form.project_id} onChange={e => set({ project_id: e.target.value })} className={INPUT}>
              <option value="">— Tất cả / chung —</option>
              {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="text-slate-400 hover:text-white text-sm px-4 py-2 rounded">Hủy</button>
          <button onClick={onSave} disabled={saving || !form.date || !form.amount}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm px-5 py-2 rounded font-medium transition-colors">
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CategoryPanel({ categories, editingCategory, form, saving, onFormChange, onEdit, onSave, onDelete, onAddNew, onClose }: {
  categories: CostCategory[]; editingCategory: CostCategory | null
  form: CategoryForm; saving: boolean
  onFormChange: (f: CategoryForm) => void; onEdit: (c: CostCategory) => void
  onSave: () => void; onDelete: (id: string) => void
  onAddNew: () => void; onClose: () => void
}) {
  function set(patch: Partial<CategoryForm>) { onFormChange({ ...form, ...patch }) }
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/40" onClick={onClose}>
      <div className="bg-slate-900 border-l border-slate-700 w-80 flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold">Danh mục chi phí</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {categories.length === 0 && <p className="text-slate-500 text-sm">Chưa có danh mục.</p>}
          {categories.map(c => (
            <div key={c.id} className="flex items-center justify-between bg-slate-800 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${COLOR_DOT[c.color] ?? 'bg-slate-500'}`} />
                <span className="text-white text-sm">{c.name}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onEdit(c)} className="text-slate-400 hover:text-white text-xs">Sửa</button>
                <button onClick={() => onDelete(c.id)} className="text-red-400 hover:text-red-300 text-xs">Xóa</button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-700 px-5 py-4 space-y-3">
          <p className="text-slate-400 text-xs font-medium uppercase tracking-wide">
            {editingCategory ? 'Sửa danh mục' : 'Thêm danh mục mới'}
          </p>
          <input value={form.name} onChange={e => set({ name: e.target.value })}
            placeholder="Tên danh mục" className={INPUT} />
          <div>
            <p className="text-slate-400 text-xs mb-1.5">Màu</p>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button key={c} onClick={() => set({ color: c })}
                  className={`w-6 h-6 rounded-full ${COLOR_DOT[c]} transition-all ${
                    form.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-900 scale-110' : 'opacity-70 hover:opacity-100'
                  }`} />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            {editingCategory && (
              <button onClick={onAddNew} className="text-slate-400 hover:text-white text-xs px-3 py-1.5 rounded border border-slate-600">
                Hủy
              </button>
            )}
            <button onClick={onSave} disabled={saving || !form.name.trim()}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm py-1.5 rounded font-medium transition-colors">
              {saving ? '...' : editingCategory ? 'Cập nhật' : 'Thêm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-slate-400 text-xs block mb-1">{label}</label>
      {children}
    </div>
  )
}

const INPUT = 'w-full bg-slate-800 border border-slate-600 text-white rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500'
