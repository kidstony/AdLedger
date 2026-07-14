# Revenue Fetch Engine

Tự động lấy doanh thu affiliate từ dashboard của mọi network về Supabase. Chạy local, chi phí 0 đồng, không cào DOM — engine mở trang báo cáo bằng Chrome và **hứng các response JSON** mà trang gọi ngầm, chuẩn hóa theo config rồi ghi vào DB.

- Không viết code riêng cho network nào. **Thêm network = thêm 1 file JSON trong `configs/`.**
- Việc tay duy nhất: đăng nhập lần đầu vào mỗi network (`node login.js`).
- Mỗi lần chạy lấy trailing 30 ngày và upsert — network điều chỉnh lùi số liệu (reversal) tự được ghi đè.

## Cài đặt (mỗi máy làm 1 lần)

```bash
cd engine
npm install
npx playwright install chromium
cp .env.example .env   # điền SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
```

Chạy migration `../supabase/migration_revenue_engine.sql` trong Supabase SQL Editor (tạo 3 bảng `revenue_raw`, `engine_runs`, `engine_alerts`).

⚠️ **Heartbeat worker** (UI admin hiện "Worker đang chạy/offline"): chạy migration `../supabase/migration_engine_worker_heartbeat.sql` **trước khi deploy UI mới**, rồi restart worker (`node worker.js`) sau khi pull code — worker cũ không ghi heartbeat nên UI sẽ hiện "Không rõ".

Trên máy dev đã có `.env.local` ở root repo thì không cần tạo `engine/.env` — engine tự đọc fallback.

### Ping Optimizer v2 (tùy chọn nhưng nên bật)

Sau mỗi chu kỳ sync doanh thu, worker gọi `POST <APP_URL>/api/optimize/analyze` để app
chạy phân tích nền (phát hiện đột biến, đề xuất tối ưu, chấm phiếu test) trên dữ liệu vừa thu.
Thêm vào `engine/.env`:

```bash
APP_URL=https://<app-cua-ban>.vercel.app   # URL app Next.js (không có / cuối)
ANALYZE_SECRET=<chuoi-ngau-nhien-dai>      # PHẢI trùng env ANALYZE_SECRET trên Vercel
# ANALYZE_FALLBACK_HOURS=6                 # nhịp ping dự phòng (mặc định 6h)
```

Thiếu 2 biến trên thì worker bỏ qua ping (không lỗi) — app vẫn tự phân tích khi
Google Ads Script đẩy dữ liệu hoặc khi user mở trang Tối Ưu Camp.

## Thêm một network mới

1. Copy `configs/_template.json` → `configs/<network_id>.json` (đọc chú thích `_comment` trong template).
2. Mở dashboard network bằng Chrome thường, bật DevTools → Network → XHR, mở trang báo cáo. Tìm request trả JSON chứa số liệu → lấy:
   - Một đoạn URL đặc trưng → `capture.url_pattern`
   - Đường dẫn tới mảng dòng dữ liệu trong JSON → `rows_path` (VD `data.results[]`)
   - Tên field ngày/offer/tiền → `mapping`
3. Khai `project_mapping` (doanh thu đổ về project nào trên P&L).
4. Đăng nhập lần đầu: `node login.js --network=<network_id>` — đăng nhập trong cửa sổ Chrome mở ra (captcha/2FA thoải mái), xong nhấn Enter. Script tự chạy thử và báo session OK hay chưa.
5. Chạy thử không ghi DB: `node fetch-all.js --network=<network_id> --dry-run` — đối chiếu tổng theo ngày với UI của network.
6. Khớp số rồi thì chạy thật: `node fetch-all.js --network=<network_id>`.

### Auto-scan trang báo cáo (khi Dò)

Checkbox **"Tự quét trang báo cáo"** trong wizard Cấu hình (bật sẵn cho thẻ Tiền màn hình): sau khi đăng nhập xong, worker tự ghé các link menu cùng origin có tên giống trang báo cáo (Conversions/Reports/Statistics/Earnings/Payouts…), hứng XHR + bảng HTML của từng trang — user không cần biết trang nào chứa dữ liệu. Detect sẽ tự chọn nguồn doanh thu/breakdown trên mọi trang đã quét và đặt đúng `report.url`.

- Là cờ của LỆNH dò (`engine_commands.discover_scan` — cần chạy `supabase/migration_engine_discover_scan.sql`), không phải field config — `_template.json` không đổi.
- An toàn: điều hướng GET qua `<a href>` cùng origin; link phải đạt điểm từ khóa mới được ghé; link logout/settings/billing/export… bị loại tuyệt đối. Tối đa 6 trang / ~2 phút.
- **Click tab phân khúc**: trên mỗi trang, auto-scan còn tự click các tab con SPA có tên Location/Country/Geo/Device/Platform (dữ liệu breakdown hay nằm sau tab, vd Tolt Reports → Location/Device). Chỉ click tab-like khớp whitelist (bỏ Traffic source/Links/Promo — optimize không dùng), không click nút phá hoại/form. Report breakdown sinh ra mang `actions:[{click:"Device"}]` để lúc sync tự click lại tab đó.

## Chạy hàng ngày

```bash
node fetch-all.js              # tất cả network enabled, tuần tự
node fetch-all.js --network=x  # 1 network
node fetch-all.js --dry-run    # không chạm DB
```

- **Khóa THEO ACCOUNT** (`engine/.locks/<account>.lock`, cũ hơn 2h coi là tiến trình chết → tự chiếm lại): mỗi account chỉ chạy 1 lượt tại 1 thời điểm, nhưng **nhiều account chạy SONG SONG được**. Worker xử lý tối đa `ENGINE_CONCURRENCY` profile cùng lúc (mặc định **4**; thêm `ENGINE_CONCURRENCY=<n>` vào `engine/.env` để chỉnh — mỗi profile ~0.5GB RAM). `fetch-all.js` KHÔNG còn ôm lock toàn cục nên không chặn worker; chỉ chờ khi trùng đúng account.
  - Muốn **auto-sync chạy song song**: để `node worker.js` chạy + bật auto-sync trong admin (worker tự xếp & chạy nhiều account cùng lúc). Không cần Task Scheduler `fetch-all.js`; nếu vẫn dùng thì nó tự khóa per-account, không đụng worker.
- Log: console + `logs/run-<timestamp>.log` (không tự xóa — thỉnh thoảng dọn tay).
- Trạng thái ghi vào Supabase:
  - `engine_runs` — mỗi lần chạy 1 network: success/failed, số dòng, khoảng ngày.
  - `engine_alerts` — lỗi đang mở; **tự đóng** khi network đó chạy lại thành công. 3 loại:
    - `NO_CAPTURE`: mất phiên đăng nhập (chạy lại `login.js`) hoặc network đổi endpoint (sửa `url_pattern`).
    - `MAPPING_FAILED`: network đổi cấu trúc JSON (sửa `rows_path`/`mapping`).
    - `DB_ERROR`: lỗi ghi Supabase.

## Dữ liệu ghi vào đâu

1. **`revenue_raw`** (staging): grain offer/ngày, khóa `(network_id, date, offer_id, offer_name)`, giữ `raw_payload` JSON gốc từng dòng.
2. **`affiliate_revenue`** (số trên P&L, khi `sync_pnl: true`): cộng dồn theo (project, ngày) rồi quy về USD, upsert **type='pending'**. Việc chốt `confirmed` vẫn làm tay trên dashboard.
   - ⚠️ Số pending nhập tay cho cùng (project, ngày) trong cửa sổ 30 ngày sẽ bị engine ghi đè.
3. **`revenue_breakdown`** (report `kind: "breakdown"` — PIPELINE RIÊNG): doanh thu theo chiều **quốc gia / thiết bị / giờ / sub-id**, grain tổng hợp (ngày × chiều), cho mục **Tối Ưu Camp** join ROI thật theo segment với chi phí Google Ads. KHÔNG bao giờ vào `affiliate_revenue` (không double-count P&L). Khai báo qua block `dimensions` trong report (xem `_template.json`); mọi chiều đều tùy chọn — network có gì lấy nấy.
   - **2 pipeline độc lập, chung Chrome profile** (đăng nhập 1 lần): lệnh `fetch` chỉ chạy report doanh thu → `revenue_raw` + P&L; lệnh `fetch_breakdown` chỉ chạy report breakdown → `revenue_breakdown`. Run riêng (`engine_runs.kind`), alert riêng (tag `<account>:breakdown`) — lỗi bên này không che/không kéo bên kia. Auto-sync xếp CẢ 2 lệnh mỗi chu kỳ (breakdown chỉ khi network có report + `engine_network_configs.breakdown_enabled`).
   - **Cấu hình & quản lý**: KHÔNG nằm trong wizard doanh thu — dùng tab **Tối Ưu Camp → Dữ liệu tối ưu Network** (Dò & cấu hình tự quét trang + click tab, Đồng bộ, bật/tắt per network). Detect có thể tạo NHIỀU report breakdown (mỗi tab/dimension 1 report: `breakdown_geo`, `breakdown_device`...). CLI: `node fetch-all.js --kind=revenue|breakdown` (bỏ cờ = chạy cả 2 tuần tự — nightly full sync).
   - **`actions`** (click tab lúc sync) + **`date_mode:'window_end'`**: nguồn tổng-theo-kỳ không có cột ngày (vd Location = tổng theo quốc gia cho cửa sổ) → engine gán `date` = ngày cuối cửa sổ sync; đây là aggregate theo kỳ (không breakdown theo từng ngày), dùng cho ROI quốc gia/thiết bị gần đây.
   - **Sub-id → campaign**: đặt Google Ads Final URL suffix `<tham_số_sub>={campaignid}` (vd `aff_sub={campaignid}`) → engine tách `campaign_id` theo `sub_id_parse` (mặc định: sub_id là campaign ID trần 8–12 chữ số) → Tối Ưu Camp attribution chính xác theo campaign.
   - Migrations cần chạy: `migration_revenue_breakdown.sql` + `migration_engine_split_pipelines.sql`; **restart worker** sau khi deploy.

### Quy đổi tiền tệ về USD (P&L hiển thị $)

- `fx_to_usd` (số): hệ số nhân **tĩnh**. Doanh thu đã là USD → để 1.
- `fx_auto_from` (mã tiền tệ, VD `"EUR"`): engine **tự lấy tỷ giá realtime** `<cur>→USD` từ [frankfurter.dev](https://frankfurter.dev) (ECB, miễn phí, không key), dự phòng [open.er-api.com](https://open.er-api.com). Có `fx_auto_from` thì bỏ qua `fx_to_usd`.
- Nếu cả 2 nguồn tỷ giá chết: `revenue_raw` vẫn ghi bình thường, chỉ **bỏ qua đồng bộ P&L** lần đó (không ghi số USD sai) — lần chạy sau tự sync lại.

Hạn chế đã biết: network **xóa hẳn** một dòng (không phải điều chỉnh về 0) thì dòng cũ vẫn nằm trong `revenue_raw` — cột `fetched_at` cho biết dòng nào không còn được làm mới.

## Test pipeline không cần credential

```bash
node fetch-all.js --network=_synthetic_test --dry-run
```

Config `_synthetic-test.json` trỏ vào GitHub API công khai, đi qua đúng pipeline capture→extract→map. Chạy không `--dry-run` sẽ ghi vào `revenue_raw` với `network_id='_synthetic_test'` (không chạm P&L vì `sync_pnl: false`); dọn bằng:

```sql
DELETE FROM revenue_raw WHERE network_id = '_synthetic_test';
```

## Bảo mật

`profiles/` chứa **cookie đăng nhập của mọi network** — đã gitignore cùng `logs/`, `.env`. Tuyệt đối không commit, không copy profile giữa các máy (mỗi máy tự đăng nhập).

## Windows Task Scheduler (khi engine đã chạy ổn bằng tay)

Tạo Basic Task chạy hàng ngày, chọn **"Run only when user is logged on"** (bắt buộc — engine mở Chrome có giao diện):

```
Program:  cmd
Arguments: /c cd /d C:\duong\dan\repo\engine && node fetch-all.js >> logs\scheduler.log 2>&1
```
