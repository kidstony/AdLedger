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
}

export interface CampaignDiscovery {
  campaign_id: string
  campaign_name: string
  customer_id: string
  last_seen: string
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
}

export interface DateRange {
  from: Date
  to: Date
}

export type SortColumn = keyof Pick<PnlSummary, 'name' | 'total_spend' | 'total_revenue' | 'total_profit' | 'avg_roi'>
export type SortDirection = 'asc' | 'desc'
