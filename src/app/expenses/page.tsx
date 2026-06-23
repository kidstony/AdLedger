'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { useProjectsContext } from '@/context/ProjectsContext'
import { supabase } from '@/lib/supabase'
import { cn, formatVND, formatCid } from '@/lib/utils'
import type { CostCategory, OtherCost, Project, RentalGroup, RentalRateType } from '@/lib/types'

// ─── Date helpers ────────────────────────────────────────────────────────────

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
function firstOfPrevMonthStr() {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  return localDateStr(d)
}
function lastOfPrevMonthStr() {
  const d = new Date()
  d.setDate(0)
  return localDateStr(d)
}
function mondayOfWeekStr() {
  const d = new Date()
  const day = d.getDay() === 0 ? 6 : d.getDay() - 1
  d.setDate(d.getDate() - day)
  return localDateStr(d)
}

// ─── Group-based rental cost computation ──────────────────────────────────────

const MS_PER_DAY = 86400000

function computeTimeFactor(
  rate_type: RentalRateType,
  from: string,
  to: string,
  period_from: string | null,
  period_to: string | null,
): number {
  const pStart = period_from ?? '1900-01-01'
  const pEnd   = period_to   ?? '9999-12-31'
  const oFrom  = from > pStart ? from : pStart
  const oTo    = to   < pEnd   ? to   : pEnd
  if (oFrom > oTo) return 0
  const days = Math.round((new Date(oTo + 'T00:00:00').getTime() - new Date(oFrom + 'T00:00:00').getTime()) / MS_PER_DAY) + 1
  if (rate_type === 'daily')   return days
  if (rate_type === 'weekly')  return days / 7
  if (rate_type === 'monthly') {
    let total = 0
    let cur = new Date(oFrom + 'T00:00:00')
    const end = new Date(oTo + 'T00:00:00')
    while (cur <= end) {
      const y = cur.getFullYear(), mon = cur.getMonth()
      const daysInMonth = new Date(y, mon + 1, 0).getDate()
      const monthEnd = new Date(y, mon + 1, 0)
      const chunkTo = end < monthEnd ? end : monthEnd
      const daysInChunk = Math.round((chunkTo.getTime() - cur.getTime()) / MS_PER_DAY) + 1
      total += daysInChunk / daysInMonth
      cur = new Date(y, mon + 1, 1)
    }
    return total
  }
  return 0
}

function computeCidCost(
  cid: string,
  group: RentalGroup,
  from: string,
  to: string,
  adSpendByCid: Map<string, number>,
): number {
  if (group.rate_type === 'one_time') {
    const pd = group.payment_date ?? ''
    return pd >= from && pd <= to ? group.rate_value : 0
  }
  if (group.rate_type === 'percentage') {
    return (adSpendByCid.get(cid) ?? 0) * (group.rate_value / 100)
  }
  return group.rate_value * computeTimeFactor(group.rate_type, from, to, group.period_from, group.period_to)
}

function computeGroupCost(group: RentalGroup, from: string, to: string, adSpendByCid: Map<string, number>): number {
  return (group.rental_group_cids ?? []).reduce(
    (sum, c) => sum + computeCidCost(c.cid, group, from, to, adSpendByCid), 0
  )
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RATE_TYPE_LABELS: Record<RentalRateType, string> = {
  percentage: '% Ad Spend',
  daily:      '/ngày',
  weekly:     '/tuần',
  monthly:    '/tháng',
  one_time:   '1 lần',
}

const COLORS = ['blue', 'orange', 'green', 'red', 'purple', 'yellow', 'pink', 'slate'] as const
type ColorKey = (typeof COLORS)[number]

const COLOR_BADGE: Record<string, string> = {
  blue:   'bg-blue-100 text-blue-700',
  orange: 'bg-orange-100 text-orange-700',
  green:  'bg-green-100 text-green-700',
  red:    'bg-red-100 text-red-700',
  purple: 'bg-purple-100 text-purple-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  pink:   'bg-pink-100 text-pink-700',
  slate:  'bg-slate-100 text-slate-600',
}

const COLOR_DOT: Record<string, string> = {
  blue: 'bg-blue-500', orange: 'bg-orange-500', green: 'bg-green-500',
  red: 'bg-red-500', purple: 'bg-purple-500', yellow: 'bg-yellow-500',
  pink: 'bg-pink-500', slate: 'bg-slate-400',
}

// ─── Form types ───────────────────────────────────────────────────────────────

interface GroupForm {
  name: string; rate_type: RentalRateType; rate_value: string
  period_from: string; period_to: string; payment_date: string; note: string
}
interface CidForm {
  cid: string; account_label: string; project_id: string
}
interface OtherForm {
  date: string; category_id: string; amount: string; description: string; project_id: string
}
interface CategoryForm { name: string; color: ColorKey }

type Tab = 'qc' | 'rental' | 'other'
type Preset = 'week' | 'month' | 'prev_month' | 'custom'

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ExpensesPage() {
  const { projects } = useProjectsContext()
  const [tab, setTab] = useState<Tab>('qc')
  const [fromStr, setFromStr] = useState(firstOfMonthStr)
  const [toStr, setToStr] = useState(todayStr)
  const [preset, setPreset] = useState<Preset>('month')

  function applyPreset(p: Preset) {
    setPreset(p)
    if (p === 'week')       { setFromStr(mondayOfWeekStr()); setToStr(todayStr()) }
    if (p === 'month')      { setFromStr(firstOfMonthStr()); setToStr(todayStr()) }
    if (p === 'prev_month') { setFromStr(firstOfPrevMonthStr()); setToStr(lastOfPrevMonthStr()) }
  }

  // Tab 1
  const [adSpendRows, setAdSpendRows] = useState<{ campaign_id: string; date: string; spend: number }[]>([])

  // Tab 2 — group state
  const [rentalGroups, setRentalGroups] = useState<RentalGroup[]>([])
  const [showGroupModal, setShowGroupModal] = useState(false)
  const [editingGroup, setEditingGroup] = useState<RentalGroup | null>(null)
  const [groupForm, setGroupForm] = useState<GroupForm>({
    name: '', rate_type: 'monthly', rate_value: '',
    period_from: firstOfMonthStr(), period_to: '', payment_date: '', note: '',
  })
  const [groupSaving, setGroupSaving] = useState(false)
  const [showCidModal, setShowCidModal] = useState(false)
  const [cidModalGroupId, setCidModalGroupId] = useState<string | null>(null)
  const [cidForm, setCidForm] = useState<CidForm>({ cid: '', account_label: '', project_id: '' })
  const [cidSaving, setCidSaving] = useState(false)

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

  // ── Derived ───────────────────────────────────────────────────────────────

  const projectByCampaignId = useMemo(
    () => new Map(projects.filter(p => p.google_campaign_id).map(p => [p.google_campaign_id!, p])),
    [projects]
  )

  const spendByProject = useMemo(() => {
    const map = new Map<string, number>()
    adSpendRows.forEach(row => {
      const p = projectByCampaignId.get(row.campaign_id)
      if (p) map.set(p.project_id, (map.get(p.project_id) ?? 0) + row.spend)
    })
    return map
  }, [adSpendRows, projectByCampaignId])

  const adSpendByCid = useMemo(() => {
    const map = new Map<string, number>()
    adSpendRows.forEach(row => {
      const p = projectByCampaignId.get(row.campaign_id)
      if (p) map.set(p.cid, (map.get(p.cid) ?? 0) + row.spend)
    })
    return map
  }, [adSpendRows, projectByCampaignId])

  const totalQc     = useMemo(() => [...spendByProject.values()].reduce((a, b) => a + b, 0), [spendByProject])
  const totalRental = useMemo(
    () => rentalGroups.reduce((sum, g) => sum + computeGroupCost(g, fromStr, toStr, adSpendByCid), 0),
    [rentalGroups, fromStr, toStr, adSpendByCid]
  )
  const totalOther  = useMemo(() => otherCosts.reduce((a, c) => a + c.amount, 0), [otherCosts])

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
    const { data } = await supabase.from('ad_spend').select('campaign_id, date, spend').gte('date', fromStr).lte('date', toStr)
    setAdSpendRows(data ?? [])
  }
  async function fetchRentalGroups() {
    const res = await fetch('/api/expenses/rental-groups')
    if (res.ok) setRentalGroups(await res.json())
  }
  async function fetchOtherCosts() {
    const res = await fetch(`/api/expenses/other?from=${fromStr}&to=${toStr}`)
    if (res.ok) setOtherCosts(await res.json())
  }
  async function fetchCategories() {
    const res = await fetch('/api/expenses/categories')
    if (res.ok) setCategories(await res.json())
  }

  useEffect(() => { fetchAdSpend(); fetchOtherCosts() }, [fromStr, toStr]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fetchRentalGroups(); fetchCategories() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Group CRUD ────────────────────────────────────────────────────────────

  function openAddGroup() {
    setEditingGroup(null)
    setGroupForm({ name: '', rate_type: 'monthly', rate_value: '', period_from: fromStr, period_to: '', payment_date: '', note: '' })
    setShowGroupModal(true)
  }
  function openEditGroup(g: RentalGroup) {
    setEditingGroup(g)
    setGroupForm({
      name: g.name, rate_type: g.rate_type, rate_value: String(g.rate_value),
      period_from: g.period_from ?? '', period_to: g.period_to ?? '',
      payment_date: g.payment_date ?? '', note: g.note ?? '',
    })
    setShowGroupModal(true)
  }
  async function saveGroup() {
    setGroupSaving(true)
    const isOneTime = groupForm.rate_type === 'one_time'
    const payload = {
      ...(editingGroup ? { id: editingGroup.id } : {}),
      name: groupForm.name.trim(),
      rate_type: groupForm.rate_type,
      rate_value: parseFloat(groupForm.rate_value) || 0,
      period_from:  !isOneTime ? (groupForm.period_from || null) : null,
      period_to:    !isOneTime ? (groupForm.period_to || null) : null,
      payment_date: isOneTime  ? (groupForm.payment_date || null) : null,
      note: groupForm.note.trim() || null,
    }
    const res = await fetch('/api/expenses/rental-groups', {
      method: editingGroup ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) { await fetchRentalGroups(); setShowGroupModal(false) }
    setGroupSaving(false)
  }
  async function deleteGroup(id: string) {
    if (!confirm('Xóa danh mục này và tất cả CID trong đó?')) return
    await fetch('/api/expenses/rental-groups', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    await fetchRentalGroups()
  }

  // ── CID CRUD ──────────────────────────────────────────────────────────────

  function openAddCid(groupId: string) {
    setCidModalGroupId(groupId)
    setCidForm({ cid: '', account_label: '', project_id: '' })
    setShowCidModal(true)
  }
  async function saveCid() {
    if (!cidModalGroupId) return
    setCidSaving(true)
    const payload = {
      group_id: cidModalGroupId,
      cid: cidForm.cid.trim(),
      account_label: cidForm.account_label.trim() || cidForm.cid.trim(),
      project_id: cidForm.project_id || null,
    }
    const res = await fetch('/api/expenses/rental-group-cids', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) { await fetchRentalGroups(); setShowCidModal(false) }
    setCidSaving(false)
  }
  async function deleteCid(id: string) {
    if (!confirm('Xóa CID này khỏi nhóm?')) return
    await fetch('/api/expenses/rental-group-cids', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    await fetchRentalGroups()
  }

  // ── Other CRUD ────────────────────────────────────────────────────────────

  function openAddOther() {
    setEditingOther(null)
    setOtherForm({ date: toStr, category_id: '', amount: '', description: '', project_id: '' })
    setShowOtherModal(true)
  }
  function openEditOther(cost: OtherCost) {
    setEditingOther(cost)
    setOtherForm({ date: cost.date, category_id: cost.category_id ?? '', amount: String(cost.amount), description: cost.description ?? '', project_id: cost.project_id ?? '' })
    setShowOtherModal(true)
  }
  async function saveOther() {
    setOtherSaving(true)
    const payload = { ...(editingOther ? { id: editingOther.id } : {}), date: otherForm.date, category_id: otherForm.category_id || null, amount: parseFloat(otherForm.amount) || 0, description: otherForm.description.trim() || null, project_id: otherForm.project_id || null }
    const res = await fetch('/api/expenses/other', { method: editingOther ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (res.ok) { await fetchOtherCosts(); setShowOtherModal(false) }
    setOtherSaving(false)
  }
  async function deleteOther(id: string) {
    if (!confirm('Xóa khoản chi phí này?')) return
    await fetch('/api/expenses/other', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    await fetchOtherCosts()
  }

  // ── Category CRUD ─────────────────────────────────────────────────────────

  function openEditCategory(cat: CostCategory) { setEditingCategory(cat); setCategoryForm({ name: cat.name, color: cat.color as ColorKey }) }
  function openAddCategory() { setEditingCategory(null); setCategoryForm({ name: '', color: 'blue' }) }
  async function saveCategory() {
    setCategorySaving(true)
    const payload = { ...(editingCategory ? { id: editingCategory.id } : {}), name: categoryForm.name.trim(), color: categoryForm.color }
    const res = await fetch('/api/expenses/categories', { method: editingCategory ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    if (res.ok) { await fetchCategories(); openAddCategory() }
    setCategorySaving(false)
  }
  async function deleteCategory(id: string) {
    if (!confirm('Xóa danh mục này?')) return
    await fetch('/api/expenses/categories', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    await Promise.all([fetchCategories(), fetchOtherCosts()])
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <h2 className="text-xl font-semibold text-slate-800">Nhập Chi Phí</h2>

      {/* ── Navigation bar ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date range inputs */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5">
          <span className="text-[11px] text-slate-400 whitespace-nowrap">Từ ngày</span>
          <input type="date" value={fromStr}
            onChange={e => { setFromStr(e.target.value); setPreset('custom') }}
            className="text-xs text-slate-700 outline-none bg-transparent w-32" />
          <span className="text-slate-300 text-sm">—</span>
          <span className="text-[11px] text-slate-400 whitespace-nowrap">Đến ngày</span>
          <input type="date" value={toStr}
            onChange={e => { setToStr(e.target.value); setPreset('custom') }}
            className="text-xs text-slate-700 outline-none bg-transparent w-32" />
        </div>

        {/* Preset buttons */}
        <div className="flex items-center gap-0 rounded-lg border border-slate-200 overflow-hidden text-xs font-medium bg-white">
          {([
            { key: 'week',       label: 'Tuần này' },
            { key: 'month',      label: 'Tháng này' },
            { key: 'prev_month', label: 'Tháng trước' },
          ] as const).map((p, i) => (
            <button key={p.key} onClick={() => applyPreset(p.key)}
              className={cn('px-3 py-1.5 transition-colors', i > 0 && 'border-l border-slate-200',
                preset === p.key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50')}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Tab switcher */}
        <div className="ml-auto flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
          {([
            { key: 'qc',     label: 'Chi phí QC' },
            { key: 'rental', label: 'Thuê tài khoản' },
            { key: 'other',  label: 'Chi phí khác' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={cn('px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard label="Chi phí QC" value={totalQc} sub="Auto sync từ Google Ads"
          active={tab === 'qc'} onClick={() => setTab('qc')} />
        <SummaryCard label="Thuê tài khoản" value={totalRental} sub="Tự tính theo date range"
          active={tab === 'rental'} onClick={() => setTab('rental')} />
        <SummaryCard label="Chi phí khác" value={totalOther}
          sub={otherCosts.length > 0 ? `${otherCosts.length} khoản trong kỳ` : 'Chưa có khoản nào'}
          active={tab === 'other'} onClick={() => setTab('other')} />
      </div>

      {/* ── Filter bar (for QC tab) ─────────────────────────────────────────── */}
      {tab === 'qc' && (
        <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium shrink-0">
            <SlidersHorizontal size={12} />
            Nguồn:
          </div>
          <span className="text-xs text-slate-400">Ad Spend tự động từ Google Ads</span>
          <span className="ml-auto text-xs text-slate-400">
            {adSpendProjects.length > 0
              ? <><span className="font-semibold text-slate-600">{adSpendProjects.length}</span> dự án có chi phí</>
              : 'Không có dữ liệu'
            }
          </span>
        </div>
      )}

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <div className="border border-slate-200 rounded-lg overflow-hidden bg-white">
        {tab === 'qc' && <QcTab projects={adSpendProjects} total={totalQc} />}
        {tab === 'rental' && (
          <RentalTab
            groups={rentalGroups} total={totalRental}
            from={fromStr} to={toStr} adSpendByCid={adSpendByCid}
            onAddGroup={openAddGroup} onEditGroup={openEditGroup}
            onDeleteGroup={deleteGroup} onAddCid={openAddCid} onDeleteCid={deleteCid}
          />
        )}
        {tab === 'other' && (
          <OtherTab costs={otherCosts} total={totalOther} categories={categories}
            categoryMap={categoryMap} projects={projects}
            onAdd={openAddOther} onEdit={openEditOther} onDelete={deleteOther}
            onManageCategories={() => setShowCategoryPanel(true)} />
        )}
      </div>

      {/* Modals */}
      {showGroupModal && (
        <GroupModal form={groupForm} editing={!!editingGroup}
          saving={groupSaving} onChange={setGroupForm}
          onSave={saveGroup} onClose={() => setShowGroupModal(false)} />
      )}
      {showCidModal && (
        <CidModal form={cidForm} projects={projects}
          saving={cidSaving} onChange={setCidForm}
          onSave={saveCid} onClose={() => setShowCidModal(false)} />
      )}
      {showOtherModal && (
        <OtherModal form={otherForm} editing={!!editingOther} categories={categories}
          projects={projects} saving={otherSaving} onChange={setOtherForm}
          onSave={saveOther} onClose={() => setShowOtherModal(false)} />
      )}
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, sub, active, onClick }: {
  label: string; value: number; sub: string; active: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className={cn('text-left rounded-lg border p-4 transition-all w-full bg-white',
        active ? 'border-blue-300 shadow-sm ring-1 ring-blue-200' : 'border-slate-200 hover:border-slate-300')}>
      <div className="text-slate-500 text-xs mb-1">{label}</div>
      <div className={cn('text-2xl font-bold', active ? 'text-blue-700' : 'text-slate-800')}>{formatVND(value)}</div>
      <div className="text-slate-400 text-xs mt-0.5">{sub}</div>
    </button>
  )
}

// Tab 1 — Chi phí QC
function QcTab({ projects, total }: {
  projects: { project_id: string; name: string; cid: string; spend: number }[]
  total: number
}) {
  if (projects.length === 0) {
    return (
      <div className="py-16 text-center text-sm text-slate-400">
        Không có dữ liệu ad spend trong khoảng ngày này.
      </div>
    )
  }
  return (
    <table className="w-full text-sm border-collapse">
      <thead className="bg-slate-50">
        <tr>
          <th className="text-left px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide border-b border-slate-200">Dự án</th>
          <th className="text-left px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide border-b border-slate-200">CID</th>
          <th className="text-right px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide border-b border-slate-200">Chi phí QC</th>
        </tr>
      </thead>
      <tbody>
        {projects.map(p => (
          <tr key={p.project_id} className="border-b border-slate-100 hover:bg-slate-50/60">
            <td className="px-4 py-2.5 text-slate-700 font-medium text-xs">{p.name}</td>
            <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{p.cid}</td>
            <td className="px-4 py-2.5 text-right font-semibold text-xs text-slate-800">{formatVND(p.spend)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot className="bg-slate-50 border-t-2 border-slate-200">
        <tr>
          <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">TỔNG</td>
          <td className="px-4 py-2.5 text-right font-bold text-sm text-green-700">{formatVND(total)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

// Tab 2 — Thuê tài khoản (group-based)
function RentalTab({ groups, total, from, to, adSpendByCid, onAddGroup, onEditGroup, onDeleteGroup, onAddCid, onDeleteCid }: {
  groups: RentalGroup[]; total: number
  from: string; to: string; adSpendByCid: Map<string, number>
  onAddGroup: () => void; onEditGroup: (g: RentalGroup) => void
  onDeleteGroup: (id: string) => void; onAddCid: (groupId: string) => void
  onDeleteCid: (id: string) => void
}) {
  return (
    <>
      {/* Toolbar */}
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-white">
        <span className="text-xs text-slate-400">Nhóm các CID lại theo danh mục, chi phí tự tính theo kỳ.</span>
        <button onClick={onAddGroup}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-md hover:bg-slate-700 transition-colors">
          + Tạo danh mục
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="py-16 text-center text-sm text-slate-400">
          Chưa có danh mục nào. Nhấn &quot;+ Tạo danh mục&quot; để bắt đầu.
        </div>
      ) : (
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide border-b border-slate-200">Danh mục / CID</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide border-b border-slate-200">Dạng phí</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide border-b border-slate-200">Giá trị</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide border-b border-slate-200">Áp dụng</th>
              <th className="text-right px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide border-b border-slate-200">Chi phí kỳ này</th>
              <th className="border-b border-slate-200 w-24" />
            </tr>
          </thead>
          <tbody>
            {groups.map(g => {
              const groupCost = computeGroupCost(g, from, to, adSpendByCid)
              const cids = g.rental_group_cids ?? []
              return (
                <>
                  {/* Group header row */}
                  <tr key={`g-${g.id}`} className="bg-slate-50 border-b border-slate-200">
                    <td className="px-4 py-2.5">
                      <span className="text-xs font-semibold text-slate-700">📁 {g.name}</span>
                      {g.note && <span className="ml-2 text-slate-400 text-[11px]">({g.note})</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-[11px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-medium">
                        {RATE_TYPE_LABELS[g.rate_type]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 font-mono text-xs">
                      {g.rate_type === 'percentage' ? `${g.rate_value}%` : formatVND(g.rate_value)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">
                      {g.rate_type === 'one_time' ? (g.payment_date ?? '—') : (g.period_from ? `${g.period_from} →` : '—')}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-sm text-green-700">{formatVND(groupCost)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-3 justify-end">
                        <button onClick={() => onEditGroup(g)} className="text-xs text-slate-400 hover:text-slate-700 transition-colors">Sửa</button>
                        <button onClick={() => onDeleteGroup(g.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors">Xóa</button>
                      </div>
                    </td>
                  </tr>

                  {/* CID sub-rows */}
                  {cids.map(c => {
                    const cidCost = computeCidCost(c.cid, g, from, to, adSpendByCid)
                    return (
                      <tr key={`c-${c.id}`} className="border-b border-slate-100 hover:bg-blue-50/30">
                        <td className="px-4 py-2 pl-10">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-300 text-xs">└</span>
                            <div>
                              <span className="text-xs text-slate-600 font-medium">{c.account_label}</span>
                              <span className="ml-2 text-slate-400 font-mono text-[11px]">{formatCid(c.cid)}</span>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-2 text-slate-300 text-xs">↳</td>
                        <td className="px-4 py-2">
                          {g.rate_type === 'percentage' && (
                            <span className="text-slate-400 text-[11px]">spend: {formatVND(adSpendByCid.get(c.cid) ?? 0)}</span>
                          )}
                        </td>
                        <td className="px-4 py-2" />
                        <td className="px-4 py-2 text-right text-xs font-semibold text-slate-600">{formatVND(cidCost)}</td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end">
                            <button onClick={() => onDeleteCid(c.id)} className="text-xs text-red-300 hover:text-red-500 transition-colors">Xóa</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                  {/* Add CID row */}
                  <tr key={`add-${g.id}`} className="border-b border-slate-100">
                    <td colSpan={6} className="px-4 py-2 pl-10">
                      <button onClick={() => onAddCid(g.id)}
                        className="text-xs text-slate-400 hover:text-blue-600 transition-colors flex items-center gap-1">
                        <span className="text-slate-300">└</span>
                        + Thêm CID vào nhóm
                      </button>
                    </td>
                  </tr>
                </>
              )
            })}
          </tbody>
          <tfoot className="bg-slate-50 border-t-2 border-slate-200">
            <tr>
              <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">TỔNG</td>
              <td className="px-4 py-2.5 text-right font-bold text-sm text-green-700">{formatVND(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      )}
    </>
  )
}

// Tab 3 — Chi phí khác
function OtherTab({ costs, total, categories, categoryMap, projects, onAdd, onEdit, onDelete, onManageCategories }: {
  costs: OtherCost[]; total: number; categories: CostCategory[]
  categoryMap: Map<string, CostCategory>; projects: Project[]
  onAdd: () => void; onEdit: (c: OtherCost) => void; onDelete: (id: string) => void
  onManageCategories: () => void
}) {
  const projectMap = useMemo(() => new Map(projects.map(p => [p.project_id, p.name])), [projects])
  return (
    <>
      {/* Toolbar */}
      <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-white">
        <button onClick={onManageCategories}
          className="text-xs text-slate-500 hover:text-slate-700 transition-colors">
          ⚙ Quản lý danh mục
        </button>
        <button onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-800 text-white rounded-md hover:bg-slate-700 transition-colors">
          + Thêm chi phí
        </button>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead className="bg-slate-50">
          <tr>
            {['Ngày', 'Danh mục', 'Số tiền', 'Mô tả', 'Dự án', ''].map((h, i) => (
              <th key={i} className={cn('px-4 py-2.5 text-[10px] font-medium text-slate-400 uppercase tracking-wide border-b border-slate-200', i === 2 ? 'text-right' : 'text-left')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {costs.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-400">Chưa có chi phí nào trong khoảng ngày này.</td></tr>
          )}
          {costs.map(c => {
            const cat = c.category_id ? categoryMap.get(c.category_id) : null
            return (
              <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50/60">
                <td className="px-4 py-2.5 text-slate-500 font-mono text-xs">{c.date}</td>
                <td className="px-4 py-2.5">
                  {cat
                    ? <span className={cn('text-[11px] px-2 py-0.5 rounded font-medium', COLOR_BADGE[cat.color] ?? COLOR_BADGE.slate)}>{cat.name}</span>
                    : <span className="text-slate-300 text-xs">—</span>
                  }
                </td>
                <td className="px-4 py-2.5 text-right font-semibold text-xs text-slate-800">{formatVND(c.amount)}</td>
                <td className="px-4 py-2.5 text-slate-600 text-xs max-w-xs truncate">{c.description ?? <span className="text-slate-300">—</span>}</td>
                <td className="px-4 py-2.5 text-slate-400 text-xs">
                  {c.project_id ? (projectMap.get(c.project_id) ?? c.project_id) : <span className="text-slate-300">(chung)</span>}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => onEdit(c)} className="text-xs text-slate-400 hover:text-slate-700 transition-colors">Sửa</button>
                    <button onClick={() => onDelete(c.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors">Xóa</button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
        {costs.length > 0 && (
          <tfoot className="bg-slate-50 border-t-2 border-slate-200">
            <tr>
              <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-slate-600 uppercase tracking-wide">TỔNG</td>
              <td className="px-4 py-2.5 text-right font-bold text-sm text-green-700">{formatVND(total)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        )}
      </table>
    </>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

const INPUT = 'w-full border border-slate-200 text-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 bg-white'
const LABEL = 'text-xs text-slate-500 block mb-1'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className={LABEL}>{label}</label>{children}</div>
}

function GroupModal({ form, editing, saving, onChange, onSave, onClose }: {
  form: GroupForm; editing: boolean
  saving: boolean; onChange: (f: GroupForm) => void; onSave: () => void; onClose: () => void
}) {
  function set(patch: Partial<GroupForm>) { onChange({ ...form, ...patch }) }
  const isOneTime = form.rate_type === 'one_time'
  const valueLabel = {
    percentage: 'Tỷ lệ (%)',
    daily: 'Phí / ngày ($)',
    weekly: 'Phí / tuần ($)',
    monthly: 'Phí / tháng ($)',
    one_time: 'Số tiền ($)',
  }[form.rate_type]

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800 mb-4">{editing ? 'Sửa danh mục' : 'Tạo danh mục thuê tài khoản'}</h3>
        <div className="space-y-3">
          <Field label="Tên danh mục *">
            <input value={form.name} onChange={e => set({ name: e.target.value })}
              placeholder="VD: BM Proxy tháng 06, Thuê cố định..." className={INPUT} />
          </Field>
          <Field label="Dạng phí">
            <div className="grid grid-cols-3 gap-2">
              {(['percentage', 'daily', 'weekly', 'monthly', 'one_time'] as RentalRateType[]).map(t => (
                <button key={t} onClick={() => set({ rate_type: t })}
                  className={cn('py-1.5 text-xs rounded-md border transition-colors font-medium',
                    form.rate_type === t ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
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
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50">Hủy</button>
          <button onClick={onSave} disabled={saving || !form.name.trim() || !form.rate_value}
            className="px-4 py-1.5 text-xs bg-slate-800 text-white rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors font-medium">
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CidCombobox({ value, projects, onChange }: {
  value: string; projects: Project[]; onChange: (cid: string) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const uniqueCids = useMemo(() => [...new Map(projects.map(p => [p.cid, p])).values()], [projects])
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return uniqueCids.filter(p =>
      formatCid(p.cid).includes(q) || p.name.toLowerCase().includes(q)
    ).slice(0, 50)
  }, [uniqueCids, search])

  const selectedProject = uniqueCids.find(p => p.cid === value)
  const displayValue = value ? `${formatCid(value)} — ${selectedProject?.name ?? ''}` : ''

  return (
    <div ref={ref} className="relative">
      <input
        className={INPUT}
        placeholder="Tìm CID hoặc tên dự án..."
        value={open ? search : displayValue}
        onFocus={() => { setOpen(true); setSearch('') }}
        onChange={e => setSearch(e.target.value)}
      />
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
          {filtered.length === 0
            ? <div className="px-3 py-2 text-xs text-slate-400">Không tìm thấy CID nào</div>
            : filtered.map(p => (
              <button key={p.cid} type="button"
                className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-center gap-2"
                onMouseDown={() => { onChange(p.cid); setOpen(false) }}>
                <span className="font-mono text-slate-700">{formatCid(p.cid)}</span>
                <span className="text-slate-300">—</span>
                <span className="text-slate-600">{p.name}</span>
              </button>
            ))
          }
        </div>
      )}
    </div>
  )
}

function CidModal({ form, projects, saving, onChange, onSave, onClose }: {
  form: CidForm; projects: Project[]
  saving: boolean; onChange: (f: CidForm) => void; onSave: () => void; onClose: () => void
}) {
  function set(patch: Partial<CidForm>) { onChange({ ...form, ...patch }) }

  function handleCidSelect(cid: string) {
    const proj = projects.find(p => p.cid === cid)
    set({ cid, account_label: form.account_label || (proj?.name ?? ''), project_id: form.project_id || (proj?.project_id ?? '') })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800 mb-4">Thêm CID vào nhóm</h3>
        <div className="space-y-3">
          <Field label="CID (Google Customer ID) *">
            <CidCombobox value={form.cid} projects={projects} onChange={handleCidSelect} />
          </Field>
          <Field label="Tên tài khoản (hiển thị)">
            <input value={form.account_label} onChange={e => set({ account_label: e.target.value })}
              placeholder="Tự động điền từ tên dự án" className={INPUT} />
          </Field>
          <Field label="Dự án liên kết (tuỳ chọn)">
            <select value={form.project_id} onChange={e => set({ project_id: e.target.value })} className={INPUT}>
              <option value="">— Không gắn —</option>
              {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.name} ({formatCid(p.cid)})</option>)}
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50">Hủy</button>
          <button onClick={onSave} disabled={saving || !form.cid}
            className="px-4 py-1.5 text-xs bg-slate-800 text-white rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors font-medium">
            {saving ? 'Đang thêm...' : 'Thêm'}
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
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800 mb-4">{editing ? 'Sửa chi phí' : 'Thêm chi phí khác'}</h3>
        <div className="space-y-3">
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
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-3 py-1.5 text-xs border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50">Hủy</button>
          <button onClick={onSave} disabled={saving || !form.date || !form.amount}
            className="px-4 py-1.5 text-xs bg-slate-800 text-white rounded-md hover:bg-slate-700 disabled:opacity-50 transition-colors font-medium">
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
  onSave: () => void; onDelete: (id: string) => void; onAddNew: () => void; onClose: () => void
}) {
  function set(patch: Partial<CategoryForm>) { onFormChange({ ...form, ...patch }) }
  return (
    <div className="fixed inset-0 bg-black/30 flex items-stretch justify-end z-50" onClick={onClose}>
      <div className="bg-white border-l border-slate-200 w-72 flex flex-col shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
          <h3 className="font-semibold text-slate-800 text-sm">Danh mục chi phí</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none transition-colors">×</button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1.5">
          {categories.length === 0 && <p className="text-slate-400 text-sm">Chưa có danh mục.</p>}
          {categories.map(c => (
            <div key={c.id} className="flex items-center justify-between border border-slate-200 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <div className={cn('w-2.5 h-2.5 rounded-full shrink-0', COLOR_DOT[c.color] ?? 'bg-slate-400')} />
                <span className="text-slate-700 text-sm">{c.name}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => onEdit(c)} className="text-xs text-slate-400 hover:text-slate-700 transition-colors">Sửa</button>
                <button onClick={() => onDelete(c.id)} className="text-xs text-red-400 hover:text-red-600 transition-colors">Xóa</button>
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-slate-200 px-4 py-4 space-y-3">
          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">
            {editingCategory ? 'Sửa danh mục' : 'Thêm danh mục mới'}
          </p>
          <input value={form.name} onChange={e => set({ name: e.target.value })}
            placeholder="Tên danh mục" className={INPUT} />
          <div>
            <p className={LABEL}>Màu</p>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button key={c} onClick={() => set({ color: c })}
                  className={cn('w-6 h-6 rounded-full transition-all', COLOR_DOT[c],
                    form.color === c ? 'ring-2 ring-slate-800 ring-offset-2 scale-110' : 'opacity-60 hover:opacity-100')} />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            {editingCategory && (
              <button onClick={onAddNew} className="text-xs text-slate-500 hover:text-slate-700 px-3 py-1.5 border border-slate-200 rounded-md transition-colors">
                Hủy
              </button>
            )}
            <button onClick={onSave} disabled={saving || !form.name.trim()}
              className="flex-1 text-xs bg-slate-800 text-white py-1.5 rounded-md font-medium hover:bg-slate-700 disabled:opacity-50 transition-colors">
              {saving ? '...' : editingCategory ? 'Cập nhật' : 'Thêm'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
