'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import { MOCK_PNL_DAILY } from '@/lib/mock-data'
import { aggregatePnl, getDefaultDateRange } from '@/lib/utils'
import { DateRange, PnlSummary } from '@/lib/types'
import { useProjectsContext } from '@/context/ProjectsContext'
import { supabase } from '@/lib/supabase'

interface AdSpendRow {
  campaign_id: string
  date: string
  spend: number
}

interface RevenueRow {
  project_id: string
  date: string
  revenue: number
  screen_revenue: number
}

export function usePnlData() {
  const { projects } = useProjectsContext()
  const [dateRange, setDateRange] = useState<DateRange>(getDefaultDateRange())
  const [isLoading, setIsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [adSpendRows, setAdSpendRows] = useState<AdSpendRow[] | null>(null)
  const [revenueRows, setRevenueRows] = useState<RevenueRow[]>([])
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)

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
      .select('project_id, date, revenue, screen_revenue')
      .gte('date', from)
      .lte('date', to)
    setRevenueRows((data ?? []).map(r => ({ ...r, screen_revenue: r.screen_revenue ?? 0 })))
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
    fetchAdSpend(dateRange)
    fetchRevenue(dateRange)
    fetchLastSync()
  }, [dateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  const dataSource: 'real' | 'mock' = (adSpendRows && adSpendRows.length > 0) ? 'real' : 'mock'

  const allSummaries = useMemo(() => {
    if (dataSource === 'real' && adSpendRows && adSpendRows.length > 0) {
      // Aggregate revenue from affiliate_revenue by project_id
      const revenueByProject = new Map<string, number>()
      const screenByProject = new Map<string, number>()
      revenueRows.forEach(r => {
        revenueByProject.set(r.project_id, (revenueByProject.get(r.project_id) ?? 0) + r.revenue)
        screenByProject.set(r.project_id, (screenByProject.get(r.project_id) ?? 0) + (r.screen_revenue ?? 0))
      })

      const map = new Map<string, PnlSummary>()
      adSpendRows.forEach(row => {
        const project = projectByCampaignId.get(row.campaign_id)
        if (!project) return
        const existing = map.get(project.project_id)
        if (!existing) {
          map.set(project.project_id, {
            project_id: project.project_id,
            cid: project.cid,
            name: project.name,
            mcc_id: project.mcc_id,
            total_spend: row.spend,
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

      // Apply revenue, screen_revenue and compute profit/ROI
      map.forEach(s => {
        s.total_revenue        = revenueByProject.get(s.project_id) ?? 0
        s.total_screen_revenue = screenByProject.get(s.project_id) ?? 0
        s.total_profit         = s.total_revenue - s.total_spend
        s.total_pending        = s.total_screen_revenue - s.total_revenue
        s.avg_roi              = s.total_spend > 0 ? (s.total_profit / s.total_spend) * 100 : 0
      })

      return Array.from(map.values())
    }

    // Fallback: mock data
    const filteredDaily = MOCK_PNL_DAILY.filter(row => activeProjectIds.has(row.project_id))
    const summaries = aggregatePnl(filteredDaily, dateRange)
    summaries.forEach(s => {
      const name = projectNameMap.get(s.project_id)
      if (name) s.name = name
      s.total_screen_revenue = 0
      s.total_pending = 0
    })
    return summaries
  }, [dataSource, adSpendRows, revenueRows, projectByCampaignId, projectNameMap, activeProjectIds, dateRange])

  const filtered = useMemo(() => {
    if (!search.trim()) return allSummaries
    const q = search.toLowerCase()
    return allSummaries.filter(
      s => s.name.toLowerCase().includes(q) || s.project_id.includes(q)
    )
  }, [allSummaries, search])

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, s) => ({
        spend:          acc.spend   + s.total_spend,
        revenue:        acc.revenue + s.total_revenue,
        profit:         acc.profit  + s.total_profit,
        screen_revenue: acc.screen_revenue + s.total_screen_revenue,
        pending:        acc.pending + s.total_pending,
      }),
      { spend: 0, revenue: 0, profit: 0, screen_revenue: 0, pending: 0 }
    )
  }, [filtered])

  const avgRoi = totals.spend > 0 ? (totals.profit / totals.spend) * 100 : 0

  const refresh = useCallback(async () => {
    setIsLoading(true)
    await Promise.all([fetchAdSpend(dateRange), fetchRevenue(dateRange), fetchLastSync()])
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
    refresh,
    dataSource,
    lastSyncedAt,
  }
}
