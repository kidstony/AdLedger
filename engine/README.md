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

Trên máy dev đã có `.env.local` ở root repo thì không cần tạo `engine/.env` — engine tự đọc fallback.

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

## Chạy hàng ngày

```bash
node fetch-all.js              # tất cả network enabled, tuần tự
node fetch-all.js --network=x  # 1 network
node fetch-all.js --dry-run    # không chạm DB
```

- Lockfile `engine/.lock` chống chạy chồng (lock cũ hơn 2h coi là tiến trình chết, tự chiếm lại).
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
