'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { MOCK_PNL_DAILY } from '@/lib/mock-data'
import { aggregatePnl, getDefaultDateRange } from '@/lib/utils'
import { DateRange, PnlSummary, RentalGroup, OtherCost } from '@/lib/types'
import { useProjectsContext } from '@/context/ProjectsContext'
import { supabase } from '@/lib/supabase'
import { computeCidCost } from '@/lib/costs'
import { type FilterProject } from '@/components/revenue/ProjectFilterDropdown'

interface AdSpendRow {
  campaign_id: string
  date: string
  spend: number
}

interface CampaignInfo {
  campaign_id: string
  customer_id: string
  mcc_id: string | null
  project_id: string | null
}

interface RevenueRow {
  project_id: string
  date: string
  type: 'confirmed' | 'pending'
  amount: number
}

export function usePnlData() {
  const { projects } = useProjectsContext()
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange())
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set())
  const [adSpendRows, setAdSpendRows] = useState<AdSpendRow[] | null>(null)
  const [revenueRows, setRevenueRows] = useState<RevenueRow[]>([])
  const [rentalGroups, setRentalGroups] = useState<RentalGroup[]>([])
  const [otherCosts, setOtherCosts] = useState<OtherCost[]>([])
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)
  const [campaignInfoByProjectId, setCampaignInfoByProjectId] = useState<Map<string, CampaignInfo>>(new Map())

  // Map google_campaign_id → project
  const projectByCampaignId = useMemo(
    () => new Map(
      projects
        .filter(p => p.google_campaign_id)
        .map(p => [p.google_campaign_id!, p])
    ),
    [projects]
  )

  const projectNameMap = useMemo(
    () => new Map(projects.map(p => [p.project_id, p.name])),
    [projects]
  )
  const activeProjectIds = useMemo(
    () => new Set(projects.map(p => p.project_id)),
    [projects]
  )

  async function fetchAdSpend(range: DateRange) {
    const from = range.from.toISOString().split('T')[0]
    const to = range.to.toISOString().split('T')[0]
    const { data } = await supabase
      .from('ad_spend')
      .select('campaign_id, date, spend')
      .gte('date', from)
      .lte('date', to)
    setAdSpendRows(data ?? [])
  }

  async function fetchRevenue(range: DateRange) {
    const from = range.from.toISOString().split('T')[0]
    const to = range.to.toISOString().split('T')[0]
    const { data } = await supabase
      .from('affiliate_revenue')
      .select('project_id, date, type, amount')
      .gte('date', from)
      .lte('date', to)
    setRevenueRows((data ?? []) as RevenueRow[])
  }

  async function fetchCosts(range: DateRange) {
    const from = range.from.toISOString().split('T')[0]
    const to = range.to.toISOString().split('T')[0]
    const [rgRes, otherRes] = await Promise.all([
      fetch('/api/expenses/rental-groups').then(r => r.json()),
      fetch(`/api/expenses/other?from=${from}&to=${to}`).then(r => r.json()),
    ])
    setRentalGroups(Array.isArray(rgRes) ? rgRes : [])
    setOtherCosts(Array.isArray(otherRes) ? otherRes : [])
  }

  async function fetchCampaignInfo() {
    const res = await fetch('/api/integrations/campaigns').catch(() => null)
    if (!res?.ok) return
    const list: CampaignInfo[] = await res.json().catch(() => [])
    if (!Array.isArray(list)) return
    const map = new Map<string, CampaignInfo>()
    list.forEach(c => { if (c.project_id) map.set(c.project_id, c) })
    setCampaignInfoByProjectId(map)
  }

  async function fetchLastSync() {
    const { data } = await supabase
      .from('sync_log')
      .select('synced_at')
      .eq('status', 'success')
      .order('synced_at', { ascending: false })
      .limit(1)
      .single()
    if (data) setLastSyncedAt(data.synced_at)
  }

  useEffect(() => {
    fetchCampaignInfo()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchAdSpend(dateRange)
    fetchRevenue(dateRange)
    fetchCosts(dateRange)
    fetchLastSync()
  }, [dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  const dataSource: 'real' | 'mock' = (adSpendRows && adSpendRows.length > 0) ? 'real' : 'mock'

  // Build CID → project_id mapping (for rental groups without explicit project_id)
  const projectByCid = useMemo(
    () => new Map(projects.filter(p => p.cid).map(p => [p.cid, p.project_id])),
    [projects]
  )

  const allSummaries = useMemo(() => {
    const fromStr = dateRange.from.toISOString().split('T')[0]
    const toStr   = dateRange.to.toISOString().split('T')[0]

    // adSpendByCid: needed for percentage rental rate calculation
    const adSpendByCid = new Map<string, number>()
    adSpendRows?.forEach(row => {
      const p = projectByCampaignId.get(row.campaign_id)
      if (p?.cid) adSpendByCid.set(p.cid, (adSpendByCid.get(p.cid) ?? 0) + row.spend)
    })

    // Rental cost per project
    const rentalByProject = new Map<string, number>()
    rentalGroups.forEach(rg => {
      rg.rental_group_cids?.forEach(cidEntry => {
        const cost = computeCidCost(cidEntry.cid, rg, fromStr, toStr, adSpendByCid)
        const pid = cidEntry.project_id ?? projectByCid.get(cidEntry.cid)
        if (pid) rentalByProject.set(pid, (rentalByProject.get(pid) ?? 0) + cost)
      })
    })

    // Other cost per project (only those linked to a project)
    const otherByProject = new Map<string, number>()
    otherCosts.forEach(c => {
      if (c.project_id) otherByProject.set(c.project_id, (otherByProject.get(c.project_id) ?? 0) + c.amount)
    })

    if (dataSource === 'real' && adSpendRows && adSpendRows.length > 0) {
      // Aggregate revenue from affiliate_revenue by project_id
      const revenueByProject = new Map<string, number>()
      const screenByProject = new Map<string, number>()
      revenueRows.forEach(r => {
        if (r.type === 'confirmed') {
          revenueByProject.set(r.project_id, (revenueByProject.get(r.project_id) ?? 0) + r.amount)
        } else {
          screenByProject.set(r.project_id, (screenByProject.get(r.project_id) ?? 0) + r.amount)
        }
      })

      const map = new Map<string, PnlSummary>()
      adSpendRows.forEach(row => {
        const project = projectByCampaignId.get(row.campaign_id)
        if (!project) return
        const campaignInfo = campaignInfoByProjectId.get(project.project_id)
        const existing = map.get(project.project_id)
        if (!existing) {
          map.set(project.project_id, {
            project_id: project.project_id,
            cid: campaignInfo?.customer_id ?? project.cid,
            name: project.name,
            mcc_id: campaignInfo?.mcc_id ?? project.mcc_id,
            total_spend: row.spend,
            total_rental: 0,
            total_other: 0,
            total_revenue: 0,
            total_profit: 0,
            avg_roi: 0,
            total_screen_revenue: 0,
            total_pending: 0,
          })
        } else {
          existing.total_spend += row.spend
        }
      })

      // Apply revenue, rental, other costs, then compute profit/ROI
      map.forEach(s => {
        s.total_revenue        = revenueByProject.get(s.project_id) ?? 0
        s.total_screen_revenue = screenByProject.get(s.project_id) ?? 0
        s.total_rental         = rentalByProject.get(s.project_id) ?? 0
        s.total_other          = otherByProject.get(s.project_id) ?? 0
        const totalCost        = s.total_spend + s.total_rental + s.total_other
        s.total_profit         = s.total_revenue - totalCost
        s.total_pending        = s.total_screen_revenue
        s.avg_roi              = totalCost > 0 ? (s.total_profit / totalCost) * 100 : 0
      })

      return Array.from(map.values())
    }

    // Fallback: mock data (rental/other = 0)
    const filteredDaily = MOCK_PNL_DAILY.filter(row => activeProjectIds.has(row.project_id))
    const summaries = aggregatePnl(filteredDaily, dateRange)
    summaries.forEach(s => {
      const name = projectNameMap.get(s.project_id)
      if (name) s.name = name
      s.total_screen_revenue = 0
      s.total_pending = 0
    })
    return summaries
  }, [dataSource, adSpendRows, revenueRows, rentalGroups, otherCosts, projectByCampaignId, projectByCid, projectNameMap, activeProjectIds, dateRange, campaignInfoByProjectId])

  const filterProjectData = useMemo<FilterProject[]>(() =>
    allSummaries.map(s => ({
      project_id: s.project_id,
      name: s.name,
      isActive: s.total_spend > 0 || s.total_revenue > 0,
      monthlyRevenue: s.total_revenue,
    })),
    [allSummaries]
  )

  const filtered = useMemo(() => {
    let result = allSummaries
    if (selectedProjectIds.size > 0)
      result = result.filter(s => selectedProjectIds.has(s.project_id))
    if (!search.trim()) return result
    const q = search.toLowerCase()
    return result.filter(s => s.name.toLowerCase().includes(q) || s.project_id.includes(q))
  }, [allSummaries, search, selectedProjectIds])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => ({
        spend:          acc.spend   + s.total_spend,
        rental:         acc.rental  + s.total_rental,
        other:          acc.other   + s.total_other,
        revenue:        acc.revenue + s.total_revenue,
        profit:         acc.profit  + s.total_profit,
        screen_revenue: acc.screen_revenue + s.total_screen_revenue,
        pending:        acc.pending + s.total_pending,
      }),
      { spend: 0, rental: 0, other: 0, revenue: 0, profit: 0, screen_revenue: 0, pending: 0 }
    )
  }, [filtered])

  const avgRoi = totals.spend > 0 ? (totals.profit / totals.spend) * 100 : 0

  const refresh = useCallback(async () => {
    setIsLoading(true)
    await Promise.all([fetchAdSpend(dateRange), fetchRevenue(dateRange), fetchCosts(dateRange), fetchLastSync(), fetchCampaignInfo()])
    setIsLoading(false)
  }, [dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    data: filtered as PnlSummary[],
    allSummaries,
    totals: { ...totals, avgRoi },
    isLoading,
    dateRange,
    setDateRange,
    search,
    setSearch,
    selectedProjectIds,
    setSelectedProjectIds,
    filterProjectData,
    refresh,
    dataSource,
    lastSyncedAt,
  }
}
