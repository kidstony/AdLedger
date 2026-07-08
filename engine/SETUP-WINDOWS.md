# Cài & vận hành Revenue Engine trên máy Windows

Máy Windows này là nơi **chạy engine + giữ các profile đăng nhập (cookie)**. Nó đọc/ghi
chung một Supabase với web app, nên mọi tài khoản bạn thêm trên web (tab *Tài khoản & Dự án*)
sẽ tự xuất hiện ở đây. Việc duy nhất phải làm tại máy này: **đăng nhập dashboard lần đầu**
cho mỗi tài khoản (cần thấy cửa sổ Chrome → phải remote vào máy).

---

## A. Chuẩn bị máy Windows (làm 1 lần)

### 1. Cài Node.js 20+
- Tải bản **LTS** tại https://nodejs.org → cài (Next → Next → Finish).
- Mở **PowerShell** (hoặc Command Prompt), kiểm tra:
  ```powershell
  node -v      # phải >= v20
  npm -v
  ```

### 2. Đưa thư mục `engine/` sang máy Windows
Chỉ cần **mã nguồn**, KHÔNG cần chép `node_modules/` và `profiles/` (sẽ tạo lại tại đây):
- Cần chép: `fetch-all.js`, `login.js`, `discover.js`, thư mục `lib/`, `configs/`, `package.json`, `.env.example`, `README.md`, file này.
- Cách chép: nén `engine/` (bỏ `node_modules`, `profiles`, `logs`) → gửi qua Google Drive/USB → giải nén vào, ví dụ, `C:\revenue-engine`.

> Nếu sau này engine được commit vào git, có thể `git clone` rồi vào thư mục `engine` thay cho bước chép.

### 3. Cài thư viện + trình duyệt Playwright
```powershell
cd C:\revenue-engine
npm install
npx playwright install chromium
```

### 4. Tạo file cấu hình kết nối Supabase `engine\.env`
```powershell
copy .env.example .env
notepad .env
```
Điền 2 dòng (lấy ở **Supabase → Settings → API**):
```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role key — GIỮ BÍ MẬT>
```
> `service_role` bypass RLS. Không commit, không chia sẻ. Chỉ đặt trên máy engine.

Kiểm tra kết nối nhanh:
```powershell
node -e "import('./lib/db.js').then(m=>m.getSupabase().from('engine_accounts').select('account_id').then(r=>console.log('OK',r.data)))"
```
Thấy danh sách account (VD `blancvpn`) là kết nối chuẩn.

---

## B. Remote vào máy Windows (để đăng nhập dashboard)

Đăng nhập cần **cửa sổ Chrome hiện lên** (engine chạy không headless), nên bạn phải nhìn
thấy màn hình máy Windows. Chọn 1 cách:

| Cách | Ghi chú |
|---|---|
| **AnyDesk / TeamViewer** (khuyến nghị) | Cài trên cả máy Windows và máy bạn. Giữ **phiên desktop vật lý** → Chrome hiện đúng, và chạy nền được cả khi bạn ngắt kết nối. Dễ nhất cho cả login lẫn chạy định kỳ. |
| **Windows Remote Desktop (RDP)** | Có sẵn trên Windows Pro. Nhược: khi ngắt RDP, phiên bị khóa → Chrome không headless có thể lỗi cho lần chạy định kỳ. Dùng tốt cho thao tác login thủ công. |
| **Chrome Remote Desktop** | Miễn phí, cài nhanh qua tài khoản Google, giữ phiên tốt. |

Sau khi remote vào, mở PowerShell tại `C:\revenue-engine` và làm phần C.

---

## C. Quy trình khi có tài khoản mới (kết hợp web + máy Windows)

1. **Trên web** (máy nào cũng được) → *Quản lý Doanh thu Engine* → tab **Tài khoản & Dự án**
   → **Thêm tài khoản**: chọn network, nhập `account_id` (VD `blancvpn_2`), nhãn, chọn **dự án**.
2. **Remote vào máy Windows** → PowerShell:
   ```powershell
   cd C:\revenue-engine
   node login.js --network=blancvpn --account=blancvpn_2
   ```
   Cửa sổ Chrome mở ra → đăng nhập tài khoản đó (captcha/2FA thoải mái) → thấy trang báo cáo
   → quay lại PowerShell **nhấn Enter**. Script tự chạy thử và báo `✓ Session OK`.
3. Lấy dữ liệu thật:
   ```powershell
   node fetch-all.js --network=blancvpn
   ```
   Engine đọc danh sách account từ Supabase (gồm cả account mới), chạy lần lượt, đổ doanh thu
   về đúng dự án đã gán.
4. **Trên web** → tab *Theo dõi*: account mới hiện dưới đúng khối dự án.

> Đổi dự án / bật-tắt / xóa tài khoản: làm hẳn trên web, không cần đụng máy Windows.
> Chỉ cần ra máy Windows khi phải **đăng nhập** một tài khoản mới hoặc **đăng nhập lại**
> (khi có cảnh báo `NO_CAPTURE` = mất phiên).

---

## D. Chạy tự động hàng ngày (tùy chọn)

Dùng **Task Scheduler** của Windows:
1. Mở *Task Scheduler* → **Create Task**.
2. General: chọn **Run only when user is logged on** (vì Chrome cần phiên desktop).
3. Triggers: Daily, giờ mong muốn (VD 07:00).
4. Actions → Start a program:
   - Program: `C:\Program Files\nodejs\node.exe`
   - Arguments: `fetch-all.js`
   - Start in: `C:\revenue-engine`
5. Điều kiện: bỏ chọn "Stop if the computer switches to battery" nếu là laptop.

> Muốn chạy định kỳ ổn định: để máy **auto-login** vào user, và dùng AnyDesk/Chrome Remote
> Desktop (giữ phiên) thay vì RDP. Lockfile `engine\.lock` chống chạy chồng.

---

## E. Xử lý sự cố nhanh

| Hiện tượng | Nguyên nhân & cách xử lý |
|---|---|
| `Thiếu SUPABASE_URL / SERVICE_ROLE_KEY` | Chưa tạo/điền `engine\.env`. Xem A.4. |
| Cảnh báo `NO_CAPTURE` trên web | Mất phiên đăng nhập → remote vào chạy lại `node login.js --network=<net> --account=<id>`. |
| Chrome không mở khi login | Đang ở phiên RDP đã ngắt/bị khóa → dùng AnyDesk/Chrome Remote Desktop giữ phiên. |
| `engine_accounts` trống | Chưa chạy migration `supabase/migration_revenue_engine_accounts_table.sql`, hoặc chưa thêm account trên web. |
| Log chi tiết | `engine\logs\run-<timestamp>.log`. |
