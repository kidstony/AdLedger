# ROADMAP — AdLedger (P&L Tracker cho Affiliate)

> **File này là "bộ não" của dự án.** Nó chứa: ngữ cảnh sản phẩm → bản đồ dữ liệu → bản đồ code → các luồng chính → checklist tiến độ → **quy tắc thêm chức năng mới mà không phá code/dữ liệu cũ**.
>
> **Đọc file này TRƯỚC khi code bất cứ thứ gì.** Sau khi thêm/sửa tính năng, **cập nhật lại file này** (đặc biệt mục [Bản đồ dữ liệu](#2--bản-đồ-dữ-liệu-nguồn-sự-thật) và [Checklist](#6--checklist-tiến-độ)). Coi đây là hợp đồng — code phải khớp với mô tả ở đây.

---

## 0 · Mục lục

1. [Ngữ cảnh sản phẩm](#1--ngữ-cảnh-sản-phẩm)
2. [Bản đồ dữ liệu (nguồn sự thật)](#2--bản-đồ-dữ-liệu-nguồn-sự-thật)
3. [Bản đồ code](#3--bản-đồ-code)
4. [Các luồng dữ liệu chính](#4--các-luồng-dữ-liệu-chính)
5. [Phân quyền (RBAC + Sharing)](#5--phân-quyền-rbac--sharing)
6. [Checklist tiến độ](#6--checklist-tiến-độ)
7. [Quy tắc thêm chức năng mới (đọc kỹ!)](#7--quy-tắc-thêm-chức-năng-mới-đọc-kỹ)
8. [Phụ lục: môi trường, deploy, quy trình vibe-code](#8--phụ-lục)

---

## 1 · Ngữ cảnh sản phẩm

**AdLedger** là công cụ theo dõi **lãi/lỗ (P&L)** cho hoạt động affiliate chạy Google Ads ở quy mô nhiều CID / nhiều MCC.

Bài toán cốt lõi: nối **chi phí quảng cáo** (tự động từ Google Ads) với **doanh thu affiliate** (nhập tay) + **các chi phí khác** (thuê tài khoản, chi phí vận hành) để ra được P&L theo từng dự án / ngày / team.

Mô hình dữ liệu gốc (vẫn đúng, chỉ mở rộng thêm):

```
Google Ads (nhiều MCC × nhiều CID)
      │  google-ads-sync.js chạy hằng ngày ở từng MCC
      ▼
POST /api/sync/ads-script   (1 webhook duy nhất, xác thực bằng secret)
      ▼
Supabase / Postgres
   ├── ad_spend            (campaign_id × date × device × ad_group) ← TỰ ĐỘNG
   ├── projects            (map: project_id ↔ cid ↔ google_campaign_id)
   ├── affiliate_revenue   (project_id × date)                     ← NHẬP TAY
   ├── rental_groups + other_costs (chi phí thuê TK + CP khác)      ← NHẬP TAY
   └── ... (teams, org, shares, banks, reminders...)
      ▼
P&L TÍNH Ở APP LAYER (KHÔNG dùng view pnl_daily)
   attribution.ts (chia spend theo ref-link) + costs.ts (thuê TK) → usePnlData.ts / pnl-summary
      ▼
Dashboard / Revenue grid / Project detail (Next.js)
```

> ⚠️ **Điểm quan trọng vs. kế hoạch gốc:** ROADMAP đời đầu dự tính một **view SQL `pnl_daily`**. Thực tế **view này KHÔNG tồn tại**. P&L được tính **hoàn toàn trong TypeScript** vì logic attribution (chia 1 campaign cho nhiều ref-link) quá phức tạp cho SQL view. Xem [§4.3](#43-tính-pl).

**Trạng thái hiện tại:** app đã vượt xa MVP ban đầu. Ngoài P&L, đã có: quản lý dự án dạng "Camp Manager" (status/category/network/attribution), multi-tenant (organizations), RBAC 3 cấp + chia sẻ dự án theo quyền chi tiết, teams, banks/tài khoản thanh toán, chi phí thuê TK, nhắc lịch + thông báo (in-app + Telegram), lịch sử thay đổi.

---

## 2 · Bản đồ dữ liệu (nguồn sự thật)

> **Nguồn schema chuẩn = [`src/lib/types.ts`](src/lib/types.ts).** Các bảng gốc (`projects`, `ad_spend`, `affiliate_revenue`, `banks`, `bank_accounts`...) được tạo tay trong Supabase SQL Editor — **không** có migration file. Các file trong [`supabase/`](supabase/) chỉ là **migration tăng dần** (thêm cột/bảng/RLS về sau). Khi đổi schema: sửa `types.ts` **và** thêm 1 file `supabase/migration_*.sql` mới, **không sửa migration cũ**.

### 2.1 Nhóm bảng theo miền

| Miền | Bảng | Khóa / quan hệ chính | Ghi bởi |
|---|---|---|---|
| **Chi phí QC** | `ad_spend` | PK `(campaign_id, date, device, ad_group_id)` | Webhook (auto) |
| | `campaign_discoveries` | PK `campaign_id`; `customer_id`(=cid), `mcc_id` | Webhook (auto) |
| | `sync_log` | log mỗi lần sync; `organization_id` | Webhook (auto) |
| **Tối ưu camp** | `campaign_metrics` | PK `(campaign_id, date)`; impressions/clicks/cost/conversions/Search IS | Webhook (auto) |
| | `keyword_metrics` | PK `(campaign_id, ad_group_id, criterion_id, date)`; +quality_score *(P2)* | Webhook (auto) |
| | `search_term_metrics` | PK `(campaign_id, ad_group_id, search_term, date)` *(P2)* | Webhook (auto) |
| | `segment_metrics` | PK `(campaign_id, date, segment_type, segment_value)`; device/hour/geo *(P3)* | Webhook (auto) |
| **Dự án** | `projects` | PK `project_id`; FK `cid`, `google_campaign_id`, `team_id`, `master_project_id`, `category_id`, `bank_account_id` | UI |
| | `master_projects` | gom nhiều `projects` thành 1 dự án mẹ | UI |
| | `project_categories`, `affiliate_networks` | phân loại; `organization_id` | UI |
| **Doanh thu** | `affiliate_revenue` | PK `(project_id, date)`; `revenue`, `screen_revenue`, `status`, chu kỳ payout | UI (nhập tay) |
| **Chi phí khác** | `rental_groups` + `rental_group_cids` | thuê tài khoản theo nhóm CID; rate_type % / ngày / tuần / tháng / 1 lần | UI |
| | `account_rental_rates` | (biến thể thuê theo từng CID) | UI |
| | `cost_categories` + `other_costs` | chi phí vận hành khác, có thể gán `project_id` | UI |
| **Ngân hàng** | `banks` + `bank_accounts` | TK nhận tiền (traditional / crypto) | UI |
| **Multi-tenant + quyền** | `organizations` | tenant gốc; giữ `ads_secret`, `telegram_bot_token`, `telegram_chat_id` | Admin |
| | `teams` | thuộc `organization_id`; `projects.team_id` trỏ về | Admin |
| | `user_profiles` | `role`, `team_id`, `organization_id` (1-1 với `auth.users`) | Admin |
| | `project_members` | gán member ↔ project (quyền cơ bản) | Admin/Manager |
| | `project_shares` + `project_share_permissions` | chia sẻ dự án + override quyền chi tiết | Manager |
| **Vận hành** | `project_history` | audit log thay đổi field của project | Auto (API) |
| | `project_reminders` | nhắc lịch, lặp, kênh in-app/telegram | UI |
| | `notifications` | thông báo in-app | Auto/API |
| | `rate_limits` | chống spam endpoint (vd webhook) | Auto |

### 2.2 Quan hệ then chốt (đọc kỹ trước khi đụng vào)

- **`projects.google_campaign_id` là bản lề** nối dự án ↔ `ad_spend`. Một `google_campaign_id` có thể gắn **nhiều** `projects` (nhiều ref-link chung 1 campaign) → sinh ra cơ chế **attribution** ([§4.2](#42-attribution-chia-spend)).
- **`ad_spend` KHÔNG có `project_id`.** Spend gắn với `campaign_id`; việc quy spend về project là do code TS làm lúc runtime. **Đừng** thêm `project_id` vào `ad_spend` — sẽ phá attribution.
- **`ad_spend` có 2 mức granularity cùng tồn tại:** dòng legacy `device='ALL', ad_group_id='ALL'` (script cũ) và dòng chi tiết theo device/ad_group (script mới). Webhook **tự xóa** dòng ALL khi có dòng chi tiết cùng `(campaign, date)` để không đếm gấp đôi (xem [`route.ts:172`](src/app/api/sync/ads-script/route.ts#L172)).
- **`affiliate_revenue` tách 2 loại doanh thu:** `revenue` (đã chốt) và `screen_revenue` (số hiển thị sớm trên dashboard network, dùng làm tín hiệu chia spend khi chưa có revenue thật).
- **Đa số bảng có `organization_id`** để cô lập tenant qua RLS. Bảng mới **nên có** `organization_id` nếu chứa dữ liệu nghiệp vụ.

---

## 3 · Bản đồ code

Next.js 16 (App Router) + TypeScript + Tailwind v4 + Supabase. Cấu trúc:

```
src/
├── app/                      # App Router: pages + API routes
│   ├── (pages)               # dashboard, projects, revenue, expenses, banks,
│   │                         #   master-projects, teams, users, admin/*, login
│   └── api/                  # 42 route handlers (xem §3.2)
├── components/               # UI theo miền: dashboard/, project/, projects/,
│   │                         #   revenue/, team/, project-detail/, layout/, ui/
├── context/                  # React Context (state toàn cục phía client)
│   ├── AuthContext           # user + role + teamId + organizationId
│   ├── ProjectsContext       # danh sách projects (lọc theo role)
│   ├── MasterProjectsContext
│   └── DateRangeContext      # khoảng ngày dùng chung dashboard/revenue
├── hooks/
│   ├── usePnlData.ts         # ★ tính P&L dashboard (client): spend+attr+cost+rev
│   ├── useRevenueGrid.ts     # ★ grid nhập doanh thu kiểu Excel
│   ├── useProjects.ts, useSharePermissions.ts
├── lib/
│   ├── types.ts              # ★ NGUỒN SCHEMA — mọi interface dữ liệu
│   ├── attribution.ts        # ★ chia spend 1 campaign → nhiều ref-link project
│   ├── costs.ts              # ★ tính chi phí thuê TK (rental) theo rate_type
│   ├── supabase.ts           # client anon (dùng ở client component, chịu RLS)
│   ├── supabase-admin.ts     # client service_role (chỉ dùng trong API routes!)
│   ├── require-role.ts       # requireRole / getCallerProfile / getOrgTeamIds
│   ├── check-member-permission.ts  # memberCanDo(user, project, permission)
│   ├── crypto.ts             # mã hóa mật khẩu affiliate lưu DB
│   ├── rate-limit.ts, utils.ts, mock-data.ts
├── middleware.ts             # hiện chỉ pass-through (chưa chặn auth ở edge)
└── scripts/google-ads-sync.js  # script dán vào Google Ads (không thuộc bundle)
```

### 3.1 File quan trọng nhất (nếu sửa, dễ ảnh hưởng dây chuyền)

| File | Vai trò | Đụng vào là ảnh hưởng |
|---|---|---|
| [`lib/types.ts`](src/lib/types.ts) | Toàn bộ interface + hằng số (STATUS_CONFIG, ACCESS_LEVEL_DEFAULTS…) | Mọi nơi |
| [`lib/attribution.ts`](src/lib/attribution.ts) | Chia spend theo tier ad_group > device > date_window > campaign/manual_pct; đảm bảo **tổng spend bất biến** | Dashboard, project detail |
| [`lib/costs.ts`](src/lib/costs.ts) | Quy đổi rate thuê TK ra tiền theo khoảng ngày | Dashboard, pnl-summary |
| [`lib/campaign-optimizer.ts`](src/lib/campaign-optimizer.ts) | Rule engine tối ưu camp (deterministic): metrics + P&L thật → gợi ý; ngưỡng ở `CFG` | Trang `/optimize` |
| [`hooks/usePnlData.ts`](src/hooks/usePnlData.ts) | Ghép spend+revenue+cost thành P&L cho dashboard (client-side) | Trang dashboard |
| [`app/api/sync/ads-script/route.ts`](src/app/api/sync/ads-script/route.ts) | Webhook nhận spend + discovery, chống double-count | Toàn bộ dữ liệu spend |

### 3.2 Bản đồ API (42 route, dưới `src/app/api/`)

- **Ingest/Integrations:** `sync/ads-script` (webhook — spend + `campaign_metrics` + discovery), `integrations/{campaigns, secret, sync-log}`
- **Tối ưu camp:** `optimize` (GET — phân tích 1 camp theo project, chạy `campaign-optimizer`)
- **Projects:** `projects/[id]/{route, history, pnl-summary, password, reminder, my-permissions, shares, shares/[shareId]}`, `projects/{categories, networks, next-id, reminders-active, team-users}`, `project-members`
- **Master projects:** `master-projects`, `master-projects/[id]`
- **Doanh thu:** `revenue`
- **Chi phí:** `expenses/{categories, other, rental-groups, rental-group-cids, rental-rates}`
- **Ngân hàng:** `banks`, `bank-accounts`, `payment-accounts`
- **Teams:** `teams`, `teams/[id]`, `teams/[id]/{members, projects, access-matrix}`
- **Admin:** `admin/{list-users, create-user, delete-user, update-role, assign-org, telegram-config, encrypt-passwords}`
- **Khác:** `notifications`

> **Quy ước API:** route nào dùng [`supabaseAdmin`](src/lib/supabase-admin.ts) (service_role, bỏ qua RLS) **bắt buộc** tự kiểm quyền bằng [`requireRole`](src/lib/require-role.ts) / [`getCallerProfile`](src/lib/require-role.ts) / [`memberCanDo`](src/lib/check-member-permission.ts) trước khi ghi. Client component thì query trực tiếp qua [`supabase`](src/lib/supabase.ts) anon và **dựa vào RLS** để lọc dữ liệu.

---

## 4 · Các luồng dữ liệu chính

### 4.1 Thu thập spend (auto)
`google-ads-sync.js` chạy ở mỗi MCC → POST `/api/sync/ads-script` với `secret`.
- Xác thực: khớp `organizations.ads_secret` (đa tenant) **hoặc** env `ADS_SCRIPT_SECRET` (fallback).
- `type:'discover'` → upsert `campaign_discoveries` (khám phá campaign ↔ cid ↔ mcc).
- `type:'spend'` (mặc định) → upsert `ad_spend` theo `(campaign_id,date,device,ad_group_id)`, xóa dòng legacy `ALL` để tránh đếm đôi, ghi `sync_log`.
- `backfillProjectCidMcc()` tự cập nhật `projects.cid/mcc_id` từ discovery.

### 4.2 Attribution (chia spend)
Khi nhiều `projects` (ref-link) chung 1 `google_campaign_id`:
`buildSiblingsByCampaign()` gom sibling → mỗi dòng `ad_spend` chạy qua `allocateSpendRow()`:
tier khớp cụ thể nhất (**ad_group > device > date_window > campaign/manual_pct**), rồi `splitSpend()` chia theo trọng số `attribution_weight` → nếu không có thì theo `screen_revenue` → không có nữa thì chia đều. **Bất biến: tổng phần chia == spend gốc** (không mất/đội chi phí).

### 4.3 Tính P&L
**KHÔNG có view SQL.** Hai điểm tính, cùng công thức:
- **Dashboard (client):** [`usePnlData.ts`](src/hooks/usePnlData.ts) — đọc `ad_spend` + `affiliate_revenue` + rental + other, chạy attribution + costs, ra `DailyPnlRow` / `PnlSummary`.
- **Chi tiết 1 project (server):** [`api/projects/[id]/pnl-summary`](src/app/api/projects/[id]/pnl-summary/route.ts) — cùng logic qua `computeCidCost`.

Công thức: `cost = spend(QC) + rentalDay(thuê TK) + otherDay(CP khác)`; `profit = revenue − cost`; `screenProfit = screen_revenue − cost`; `roi = profit / cost × 100`.

### 4.4 Nhập doanh thu
Trang `/revenue` dùng [`useRevenueGrid.ts`](src/hooks/useRevenueGrid.ts): grid kiểu Excel (hàng = project, cột = ngày), gõ ô → upsert `affiliate_revenue`. Có `status` pending/confirmed + chu kỳ payout.

### 4.5 Tối ưu camp
`google-ads-sync.js` gửi thêm `type:'campaign_metrics'` (impressions/clicks/CTR/CPC/Search IS) → webhook upsert `campaign_metrics` (KHÔNG đụng `ad_spend`). Trang `/optimize` gọi [`api/optimize`](src/app/api/optimize/route.ts): ghép `campaign_metrics` + **DT Màn hình** (`affiliate_revenue` type='pending', tính qua [`screen-revenue.ts`](src/lib/screen-revenue.ts) — mirror logic delta của `usePnlData`) + cost (spend+rental+other, dùng lại `computeCidCost`) → [`campaign-optimizer.ts`](src/lib/campaign-optimizer.ts) chạy rule engine ra `health` + `suggestions[]`. Cơ sở phân tích = **DT Màn hình** (tín hiệu sớm, kịp tối ưu); DT Thực (confirmed) chỉ hiển thị tham chiếu. Vì affiliate **không có conversion tracking**, tín hiệu tiền chỉ ở mức project×ngày → gợi ý chia 2 độ tin cậy `roi` (chắc) vs `engagement` (cần xem xét).

---

## 5 · Phân quyền (RBAC + Sharing)

**3 vai trò** (`user_profiles.role`): `super_admin` (toàn quyền), `manager` (phạm vi team/org của mình), `member` (chỉ dự án được gán/chia sẻ).

Lọc dữ liệu theo role diễn ra ở **2 tầng**:
1. **RLS trong Postgres** (các `migration_rbac.sql`, `migration_security_rls.sql`, `migration_organizations.sql`, `migration_shares.sql`) + hàm `get_user_role() / get_user_org_id() / get_user_team_id() / check_project_permission()`.
2. **Code TS**: `ProjectsContext` load khác nhau theo role; API routes gọi `requireRole` / `memberCanDo`.

**Chia sẻ chi tiết:** `project_shares.access_level` ∈ `viewer/reporter/editor` → map ra 6 quyền (`ACCESS_LEVEL_DEFAULTS` trong types.ts): `view_revenue/view_profit/view_adspend/input_revenue/input_expense/confirm_payment`. `project_share_permissions` **override từng quyền**. Kiểm ở server bằng `memberCanDo()`.

> ⚠️ Khi thêm bảng/tính năng có dữ liệu nhạy cảm: **phải** viết RLS tương ứng **và** kiểm quyền ở API. Đừng chỉ dựa một tầng.

---

## 6 · Checklist tiến độ

### Nền tảng gốc (Phase 1–6 kế hoạch đầu) — ✅ Hoàn thành
- [x] Chuẩn hóa `project_id ↔ cid ↔ campaign` (thay Google Sheet bằng trang "Quản lý dự án")
- [x] Hạ tầng Supabase + bảng `projects`, `ad_spend`, `affiliate_revenue`
- [x] Webhook `/api/sync/ads-script` (secret, rate-limit, discovery, chống double-count)
- [x] `google-ads-sync.js` chạy được cho cả MCC lẫn CID thường; segment device/ad_group
- [x] Trang nhập doanh thu kiểu Excel (`/revenue`)
- [x] Dashboard P&L (bảng + biểu đồ theo ngày) + trang chi tiết project
- [x] Cảnh báo sync trễ / Telegram (config theo org) — `sync_log` + `telegram-config`

### Tính năng đã mở rộng thêm — ✅ Hoàn thành
- [x] **Multi-tenant**: `organizations`, secret ingest theo org
- [x] **RBAC 3 cấp** + RLS + **chia sẻ dự án** theo quyền chi tiết (6 permission, override)
- [x] **Teams**: gán project theo team, ma trận truy cập (`teams/[id]/access-matrix`)
- [x] **Camp Manager**: status (8 trạng thái), category, affiliate network, người phụ trách, ghi chú, ngày start camp
- [x] **Attribution**: chia 1 campaign cho nhiều ref-link (ad_group/device/date/manual %)
- [x] **Chi phí**: thuê tài khoản (`rental_groups`) + chi phí khác (`other_costs`)
- [x] **Master projects**: gom nhiều CID thành 1 dự án mẹ
- [x] **Banks / tài khoản thanh toán** (traditional + crypto), mã hóa mật khẩu affiliate
- [x] **Nhắc lịch + thông báo** in-app + Telegram; **lịch sử thay đổi** project
- [x] **screen_revenue** vs **revenue** (tín hiệu sớm) + trạng thái payout pending/confirmed

### Tối Ưu Camp (Campaign Optimizer) — đang triển khai theo giai đoạn
- [x] **P1 — ROI core:** bảng `campaign_metrics` + ingest (`type:'campaign_metrics'`) + `campaign-optimizer.ts` (rule ROI-based: cut/scale/raise_budget/raise_bid/margin_alert/daypart + fix_creative + setup_tracking) + `api/optimize` + trang `/optimize` (scorecard + thẻ gợi ý). Migration [`migration_campaign_optimizer.sql`](supabase/migration_campaign_optimizer.sql) tạo sẵn cả 4 bảng.
- [ ] **P2 — keyword & search term:** ingest `keyword_metrics`/`search_term_metrics` + rule engagement (negative keyword, pause keyword) + bảng breakdown.
- [ ] **P3 — device/giờ/geo:** ingest `segment_metrics` + rule bid-adjust/dayparting theo phân khúc + charts.

### Việc còn mở / ý tưởng tiếp theo — ☐ Chưa làm
- [ ] Tự động lấy doanh thu từ **network API** (thay nhập tay) — ghi thẳng vào `affiliate_revenue`, **không đổi** phần tính P&L phía sau
- [ ] `middleware.ts` hiện **pass-through** — cân nhắc chặn auth ở edge thay vì chỉ client redirect
- [ ] Materialize P&L (view/bảng cache) nếu dữ liệu lớn làm dashboard chậm — hiện tính client-side mỗi lần
- [ ] Export báo cáo (CSV/PDF) theo team/khoảng ngày
- [ ] Test tự động (hiện chưa có test) cho `attribution.ts` + `costs.ts` (logic dễ sai nhất)

> **Khi hoàn thành một mục:** đổi `[ ]`→`[x]`, và nếu có bảng/cột/luồng mới thì cập nhật [§2](#2--bản-đồ-dữ-liệu-nguồn-sự-thật)/[§3](#3--bản-đồ-code)/[§4](#4--các-luồng-dữ-liệu-chính).

---

## 7 · Quy tắc thêm chức năng mới (đọc kỹ!)

Mục tiêu: thêm tính năng mà **không phá code cũ** và **ghép được với dữ liệu hiện có**.

### 7.1 Checklist trước khi code
1. **Đọc lại §2 + §4** — tính năng của bạn đọc/ghi bảng nào? Nó ghép với dữ liệu hiện có qua khóa nào (`project_id`? `google_campaign_id`? `organization_id`? `date`?).
2. **Định nghĩa kiểu trong [`types.ts`](src/lib/types.ts) TRƯỚC** — đây là hợp đồng. Không rải interface rời rạc khắp nơi.
3. **Đổi schema = thêm migration mới**, đặt tên `supabase/migration_<mô_tả>.sql`. **Tuyệt đối không sửa migration đã có.** Dùng `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` để chạy lại an toàn (idempotent).
4. Bảng mới chứa dữ liệu nghiệp vụ → **thêm `organization_id` + viết RLS** cùng lúc.

### 7.2 Nguyên tắc "không phá cũ"
- **Cột mới luôn nullable / có default.** Không NOT NULL trên bảng có sẵn dữ liệu.
- **Không đổi PK/ý nghĩa cột đang dùng.** Đặc biệt: đừng thêm `project_id` vào `ad_spend`; đừng gộp `revenue`/`screen_revenue`; đừng phá bất biến "tổng spend" của [`attribution.ts`](src/lib/attribution.ts).
- **Tôn trọng 2 mức granularity của `ad_spend`** (ALL vs device/ad_group). Query spend mới phải cộng đúng như [`usePnlData.ts`](src/hooks/usePnlData.ts) làm, tránh đếm đôi.
- **P&L chỉ có 1 công thức** (§4.3). Nếu cần số P&L ở chỗ mới, **tái sử dụng** `attribution.ts` + `costs.ts`, đừng viết lại công thức song song (sẽ lệch số giữa các trang).

### 7.3 Chọn đúng client Supabase
- **Client component / hook** → [`supabase`](src/lib/supabase.ts) (anon) + dựa RLS.
- **API route cần bỏ qua RLS** → [`supabaseAdmin`](src/lib/supabase-admin.ts) **và phải tự kiểm quyền** (`requireRole`/`memberCanDo`). Không bao giờ import `supabase-admin` vào client.

### 7.4 Thêm trang / API mới — theo khuôn có sẵn
- Trang mới: đặt `src/app/<tên>/page.tsx`, thêm link trong [`layout/Sidebar.tsx`](src/components/layout/Sidebar.tsx), bọc trong provider phù hợp nếu cần state chung.
- API mới: `src/app/api/<miền>/route.ts`, mở đầu bằng kiểm quyền, trả `NextResponse.json`. Nhìn [`revenue`](src/app/api/revenue/route.ts) hoặc [`pnl-summary`](src/app/api/projects/[id]/pnl-summary/route.ts) làm mẫu.
- UI: tái dùng `components/ui/*` và tuân [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) (màu/UX/glossary).

### 7.5 Sau khi xong
- Chạy `npm run dev` + `npm run lint`, kiểm thử tay luồng vừa sửa.
- **Cập nhật ROADMAP.md này** (schema/luồng/checklist).
- `git commit` message rõ ràng theo từng bước hoàn chỉnh.

---

## 8 · Phụ lục

### 8.1 Môi trường & deploy
- **Tech:** Next.js 16 (App Router), React 19, TS, Tailwind v4, Supabase (Postgres + Auth), Recharts, Radix/base-ui. Deploy: Vercel.
- **Biến môi trường** ([`.env.example`](.env.example)):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client)
  - `SUPABASE_SERVICE_ROLE_KEY` (server — bí mật)
  - `ADS_SCRIPT_SECRET` (fallback secret cho webhook; ưu tiên `organizations.ads_secret`)
- **Chạy local:** `npm install` → điền `.env.local` → `npm run dev`. Setup Supabase xem [README.md](README.md).

### 8.2 Quy trình vibe-code (VS Code + Claude Code)
1. Mở phiên chat mới → yêu cầu: *"Đọc ROADMAP.md rồi làm việc X"* (Claude sẽ có toàn bộ ngữ cảnh từ file này).
2. Bật **Plan mode** để duyệt kế hoạch trước khi cho sửa file thật.
3. Xem diff từng file → Accept / yêu cầu chỉnh.
4. Nhờ chạy `npm run dev` để kiểm lỗi ngay trong terminal tích hợp.
5. Nhờ **cập nhật ROADMAP.md** + **commit git** sau mỗi bước hoàn chỉnh.
6. `/usage` định kỳ để theo dõi hạn mức gói Pro.
