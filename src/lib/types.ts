export type UserRole = 'super_admin' | 'manager' | 'member'

export interface Team {
  id: string
  name: string
  color: string
  created_at: string
}

export interface UserProfile {
  user_id: string
  full_name: string
  email: string
  role: UserRole
  team_id: string | null
  organization_id: string | null
  email_confirmed: boolean
  project_count: number
  team?: Pick<Team, 'id' | 'name' | 'color'>
}

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  created_at: string
}

export interface MasterProject {
  id: string
  name: string
  description?: string | null
  created_at?: string
  created_by?: string | null
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

export interface ProjectCategory {
  id: string
  name: string
  color: string
  organization_id: string | null
  created_by?: string | null
  created_at?: string
}

export interface AffiliateNetwork {
  id: string
  name: string
  color: string
  organization_id: string | null
}

export type ProjectStatus =
  | 'waiting_camp'    // Chờ Lên Camp
  | 'testing'         // Đang Test
  | 'tested_loss'     // Đã Test (Lỗ)
  | 'waiting_payment' // Chờ Thanh Toán  ← Tab 2
  | 'scaling'         // Đang Scale       ← Tab 2
  | 'paused_camp'     // Dừng Camp        ← Tab 2
  | 'on_hold'         // Tạm Dừng         ← Tab 2
  | 'abandoned'       // Bỏ

export const ACTIVE_STATUSES: ProjectStatus[] = [
  'waiting_payment', 'scaling', 'paused_camp', 'on_hold',
]

export const STATUS_CONFIG: Record<ProjectStatus, { label: string; badge: string; row?: string }> = {
  waiting_camp:    { label: 'Chờ Lên Camp',    badge: 'bg-slate-100 text-slate-600' },
  testing:         { label: 'Đang Test',        badge: 'bg-yellow-100 text-yellow-700' },
  tested_loss:     { label: 'Đã Test (Lỗ)',     badge: 'bg-red-100 text-red-700',     row: 'opacity-60' },
  waiting_payment: { label: 'Chờ Thanh Toán',   badge: 'bg-orange-100 text-orange-700', row: 'bg-amber-50' },
  scaling:         { label: 'Đang Scale',       badge: 'bg-green-100 text-green-700', row: 'bg-green-50' },
  paused_camp:     { label: 'Dừng Camp',        badge: 'bg-blue-100 text-blue-700' },
  on_hold:         { label: 'Tạm Dừng',         badge: 'bg-purple-100 text-purple-700' },
  abandoned:       { label: 'Bỏ',              badge: 'bg-slate-200 text-slate-400',  row: 'opacity-60' },
}

export interface ProjectReminder {
  id: string
  project_id: string
  user_id?: string
  remind_at: string
  repeat_type: 'none' | 'daily' | 'weekly' | 'custom'
  repeat_days: number | null
  message: string | null
  notify_inapp: boolean
  notify_telegram: boolean
  is_triggered: boolean
  created_at?: string
}

export interface AppNotification {
  id: string
  type: string
  title: string
  body: string | null
  project_id: string | null
  is_read: boolean
  created_at: string
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
  // ── Attribution: tách chi phí QC theo link ref khi nhiều ref chung 1 CID/campaign ──
  attribution_type?:        AttributionType
  attribution_device?:      AdDevice | null
  attribution_ad_group_id?: string | null
  attribution_from?:        string | null
  attribution_to?:          string | null
  attribution_weight?:      number | null
  email_ref?: string | null
  bank_account_id?: string | null
  team_id?: string | null
  bank_accounts?: (BankAccount & { banks?: Bank | null }) | null
  share_access_level?: ShareAccessLevel | null  // only set for member role (from project_shares)
  effective_permissions?: SharePermissions | null  // computed from access_level + custom overrides
  // ── Camp Manager fields ──
  category_id?:        string | null
  category?:           ProjectCategory | null
  affiliate_url?:      string | null
  affiliate_username?: string | null
  affiliate_password?: string | null
  affiliate_network?:  string | null
  statuses?:           ProjectStatus[]
  camp_start_date?:    string | null
  person_in_charge?:   string | null
  note?:               string | null
  created_by?:         string | null
  created_at?:         string | null
}

export interface CampaignDiscovery {
  campaign_id: string
  campaign_name: string
  customer_id: string
  last_seen: string
  mcc_id?: string | null
  mcc_name?: string | null
  // Một campaign có thể gán cho nhiều dự án (nhiều link ref chung 1 campaign).
  projects?: { project_id: string; project_name: string }[]
  project_id?: string | null      // = phần tử đầu của projects (tương thích ngược)
  project_name?: string | null
}

// 'ALL' = tổng legacy (script cũ không gửi chiều device).
// 'OTHER' = thiết bị khác (Connected TV / Unknown) từ script mới.
export type AdDevice = 'ALL' | 'MOBILE' | 'DESKTOP' | 'TABLET' | 'OTHER'

export interface AdSpend {
  campaign_id: string
  date: string
  spend: number
  device: AdDevice      // 'ALL' cho row cũ / không segment theo thiết bị
  ad_group_id: string   // 'ALL' cho row cũ / không segment theo ad group
}

// ─── Campaign Optimizer: số liệu hiệu suất Google Ads ────────────────────────
// Tách KHỎI ad_spend (ad_spend chỉ giữ `spend` — nguồn P&L, không đụng).
// conversions/conversions_value NULLABLE: affiliate thường KHÔNG có conversion
// tracking (chuyển đổi xảy ra ở site merchant qua link ref) → thường null/0.

export interface CampaignMetric {
  campaign_id: string
  date: string
  impressions: number
  clicks: number
  cost: number
  conversions: number | null
  conversions_value: number | null
  search_impression_share: number | null   // 0..1 (tỉ lệ)
  search_budget_lost_is: number | null      // 0..1 — IS mất do ngân sách
  search_rank_lost_is: number | null        // 0..1 — IS mất do thứ hạng (Ad Rank)
}

export interface KeywordMetric {
  campaign_id: string
  ad_group_id: string
  criterion_id: string
  date: string
  keyword_text: string
  match_type: string
  impressions: number
  clicks: number
  cost: number
  conversions: number | null
  quality_score: number | null
}

export interface SearchTermMetric {
  campaign_id: string
  ad_group_id: string
  search_term: string
  date: string
  impressions: number
  clicks: number
  cost: number
  conversions: number | null
}

export type SegmentType = 'device' | 'hour' | 'geo'

export interface SegmentMetric {
  campaign_id: string
  date: string
  segment_type: SegmentType
  segment_value: string
  impressions: number
  clicks: number
  cost: number
  conversions: number | null
}

// ── Kết quả engine tối ưu (deterministic rule engine) ──
export type OptSuggestionType =
  | 'scale' | 'cut' | 'raise_budget' | 'raise_bid' | 'lower_bid'
  | 'add_negative' | 'pause_keyword' | 'fix_creative' | 'margin_alert'
  | 'device_adjust' | 'daypart' | 'setup_tracking'

export type OptSeverity = 'high' | 'medium' | 'low'
// 'roi' = dựa trên doanh thu thật (chắc chắn); 'engagement' = chỉ tín hiệu hiệu
// suất (CTR/CPC/IS), không có doanh thu ở mức này → "cần xem xét".
export type OptConfidence = 'roi' | 'engagement'
export type OptScopeLevel = 'campaign' | 'keyword' | 'search_term' | 'segment'

export interface OptEvidence {
  metric: string
  value: string     // đã format sẵn để render
  context?: string
}

export interface OptScope {
  level: OptScopeLevel
  label: string
  campaign_id?: string
  project_id?: string
  ad_group_id?: string
  criterion_id?: string
  search_term?: string
  segment_type?: SegmentType
  segment_value?: string
}

export interface OptimizationSuggestion {
  id: string
  type: OptSuggestionType
  severity: OptSeverity
  confidence: OptConfidence
  scope: OptScope
  title: string
  detail: string
  evidence: OptEvidence[]
  recommendedAction: string
  impactScore: number   // ~ chi phí đang đặt cược × mức độ → xếp hạng giảm dần
}

export interface CampaignHealth {
  roi: number | null           // % ; null nếu chưa có chi phí
  ctr: number                  // %
  avgCpc: number               // đơn vị tiền tài khoản
  cpcTrendPct: number | null   // % thay đổi CPC nửa sau vs nửa đầu kỳ
  impressionShare: number | null   // %
  isLostBudget: number | null      // %
  isLostRank: number | null        // %
  spend: number
  revenue: number
  clicks: number
  impressions: number
  conversions: number | null
  score: number                // 0..100
}

export interface CampaignOptimizerResult {
  health: CampaignHealth
  suggestions: OptimizationSuggestion[]
  hasConversionTracking: boolean
}

// Quy tắc quy chi phí QC của một campaign về từng ref-link project (sub-project).
export type AttributionType =
  | 'campaign'    // nhận toàn bộ chi phí campaign (mặc định)
  | 'device'      // chỉ nhận spend của device tương ứng
  | 'ad_group'    // chỉ nhận spend của ad_group_id tương ứng
  | 'date_window' // chỉ nhận spend trong [attribution_from, attribution_to]
  | 'manual_pct'  // chia theo trọng số % thủ công giữa các sibling

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

// Dashboard per-date row: org-wide daily P&L incl. full cost breakdown (QC + Thuê TK + CP khác).
export interface DailyPnlRow {
  date: string
  spend: number         // QC (ad spend)
  rentalDay: number     // Thuê TK
  otherDay: number      // CP khác
  cost: number          // spend + rentalDay + otherDay
  revenue: number       // confirmed revenue
  screenRevenue: number
  profit: number        // revenue - cost
  screenProfit: number  // screenRevenue - cost
  roi: number
  screenRoi: number
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
  total_profit: number         // confirmed revenue - (spend + rental + other)
  avg_roi: number              // profit / total_cost * 100
  total_screen_revenue: number
  screen_profit: number        // screen revenue - (spend + rental + other)
  screen_roi: number           // screen_profit / total_cost * 100
  total_pending: number
  share_access_level?: ShareAccessLevel | null  // set for member role
  effective_permissions?: SharePermissions | null  // respects custom overrides
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

// ─── Project Sharing ───────────────────────────────────────────────────────

export type ShareAccessLevel = 'viewer' | 'reporter' | 'editor'

export type SharePermissionId =
  | 'view_revenue' | 'view_profit' | 'view_adspend'
  | 'input_revenue' | 'input_expense' | 'confirm_payment'

export interface SharePermissions {
  view_revenue:    boolean
  view_profit:     boolean
  view_adspend:    boolean
  input_revenue:   boolean
  input_expense:   boolean
  confirm_payment: boolean
}

export const ACCESS_LEVEL_DEFAULTS: Record<ShareAccessLevel, SharePermissions> = {
  viewer: {
    view_revenue: false, view_profit: false, view_adspend: false,
    input_revenue: false, input_expense: false, confirm_payment: false,
  },
  reporter: {
    view_revenue: true, view_profit: true, view_adspend: true,
    input_revenue: false, input_expense: false, confirm_payment: false,
  },
  editor: {
    view_revenue: true, view_profit: true, view_adspend: true,
    input_revenue: true, input_expense: true, confirm_payment: true,
  },
}

export interface ProjectShare {
  id:           string
  project_id:   string
  user_id:      string
  shared_by:    string | null
  access_level: ShareAccessLevel
  created_at:   string
  user_profile?: Pick<UserProfile, 'full_name' | 'email' | 'role'>
  custom_permissions?: Array<{ permission_id: SharePermissionId; granted: boolean }>
}
