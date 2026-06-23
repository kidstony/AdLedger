export interface MasterProject {
  id: string
  name: string
  description?: string | null
  created_at?: string
}

export interface Bank {
  id: string
  name: string
  type: 'local' | 'international'
  bank_category: 'traditional' | 'crypto'
  created_at: string
}

export interface BankAccount {
  id: string
  bank_id: string
  account_identifier: string   // email/số TK for traditional
  owner_name: string
  note?: string | null
  coin_type?: string | null    // crypto only
  network?: string | null      // crypto only
  wallet_address?: string | null // crypto only
  created_at: string
  banks?: Bank | null
}

export interface Project {
  project_id: string
  cid: string
  name: string
  mcc_id: string
  master_project_id?: string | null
  google_campaign_id?: string | null
  screen_revenue_type?: 'daily' | 'cumulative'
  ref_link?: string | null
  bank_account_id?: string | null
  bank_accounts?: (BankAccount & { banks?: Bank | null }) | null
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
  total_spend: number          // QC / ad spend only
  total_rental: number         // thuê tài khoản
  total_other: number          // chi phí khác
  total_revenue: number
  total_profit: number         // revenue - (spend + rental + other)
  avg_roi: number              // profit / total_cost * 100
  total_screen_revenue: number
  total_pending: number
}

export interface DateRange {
  from: Date
  to: Date
}

export type SortColumn = keyof Pick<PnlSummary, 'name' | 'total_spend' | 'total_revenue' | 'total_profit' | 'avg_roi'>
export type SortDirection = 'asc' | 'desc'

export type RentalRateType = 'percentage' | 'daily' | 'weekly' | 'monthly' | 'one_time'

export interface AccountRentalRate {
  id: string
  cid: string | null
  account_label: string
  project_id: string | null
  rate_type: RentalRateType
  rate_value: number
  period_from: string | null
  period_to: string | null
  payment_date: string | null
  note: string | null
  created_at: string
}

export interface CostCategory {
  id: string
  name: string
  color: string
  created_at: string
}

export interface OtherCost {
  id: string
  date: string
  category_id: string | null
  amount: number
  description: string | null
  project_id: string | null
  created_at: string
  cost_categories?: CostCategory | null
}

export interface RentalGroupCid {
  id: string
  group_id: string
  cid: string
  account_label: string
  project_id: string | null
  created_at: string
}

export interface RentalGroup {
  id: string
  name: string
  rate_type: RentalRateType
  rate_value: number
  period_from: string | null
  period_to: string | null
  payment_date: string | null
  note: string | null
  created_at: string
  rental_group_cids?: RentalGroupCid[]
}
