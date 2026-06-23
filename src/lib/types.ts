export interface MasterProject {
  id: string
  name: string
  description?: string | null
  created_at?: string
}

export interface Project {
  project_id: string
  cid: string
  name: string
  mcc_id: string
  master_project_id?: string | null
  google_campaign_id?: string | null
  screen_revenue_type?: 'daily' | 'cumulative'
}

export interface CampaignDiscovery {
  campaign_id: string
  campaign_name: string
  customer_id: string
  last_seen: string
  mcc_id?: string | null
  mcc_name?: string | null
  project_id?: string | null
  project_name?: string | null
}

export interface AdSpend {
  campaign_id: string
  date: string
  spend: number
}

export interface AffiliateRevenue {
  project_id: string
  date: string
  revenue: number
  screen_revenue: number
  note?: string | null
  payout_start_date?: string | null
  payout_end_date?: string | null
  status?: 'pending' | 'confirmed'
  confirmed_at?: string | null
}

export interface PnlDaily {
  project_id: string
  cid: string
  name: string
  date: string
  spend: number
  revenue: number
  profit: number
  roi: number
}

export interface PnlSummary {
  project_id: string
  cid: string
  name: string
  mcc_id: string
  total_spend: number
  total_revenue: number
  total_profit: number
  avg_roi: number
  total_screen_revenue: number
  total_pending: number
}

export interface DateRange {
  from: Date
  to: Date
}

export type SortColumn = keyof Pick<PnlSummary, 'name' | 'total_spend' | 'total_revenue' | 'total_profit' | 'avg_roi'>
export type SortDirection = 'asc' | 'desc'
