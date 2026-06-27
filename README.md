# AdLedger — P&L Tracker

Ứng dụng quản lý dự án affiliate và theo dõi P&L, tích hợp Google Ads.

## Tech Stack

- **Frontend**: Next.js 14 (App Router) + TypeScript + Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Auth)
- **Deploy**: Vercel

---

## Setup cho Developer (chạy local)

### Yêu cầu
- Node.js 18+
- Tài khoản [Supabase](https://supabase.com) (free tier là đủ)

### Bước 1 — Clone & install

```bash
git clone https://github.com/kidstony/AdLedger.git
cd AdLedger
npm install
```

### Bước 2 — Tạo Supabase project

1. Vào [supabase.com](https://supabase.com) → New project
2. Vào **Settings → API**, copy:
   - `Project URL`
   - `anon public` key
   - `service_role` key (secret)

### Bước 3 — Tạo file `.env.local`

```bash
cp .env.example .env.local
# Mở .env.local và điền các giá trị từ Supabase
```

### Bước 4 — Chạy migrations (theo thứ tự)

Vào Supabase Dashboard → **SQL Editor**, chạy từng file theo thứ tự:

```
1. supabase/migration_organizations.sql
2. supabase/migration_rbac.sql
3. supabase/migration_project_management.sql
4. supabase/migration_phase2.sql
5. supabase/migration_affiliate_networks.sql
6. supabase/migration_shares.sql
```

### Bước 5 — Tạo tài khoản admin đầu tiên

1. Supabase Dashboard → **Authentication → Users → Add user**
2. Điền email + password → tạo xong copy **User UID**
3. Mở `supabase/seed_global_admin.sql`, thay `PASTE_USER_ID_HERE` bằng UID vừa copy
4. Chạy file đó trong SQL Editor

### Bước 6 — Chạy app

```bash
npm run dev
# Mở http://localhost:3000
# Đăng nhập bằng email/password vừa tạo
```

---

## Deploy lên Vercel (cho tester — không cần cài gì)

1. Fork/clone repo lên GitHub của bạn
2. [vercel.com](https://vercel.com) → Import Git Repository
3. Vào project settings → **Environment Variables** → thêm 4 biến từ `.env.example`
4. Deploy → tester chỉ cần URL + tài khoản

---

## Cấu trúc thư mục chính

```
src/
├── app/                  # Next.js App Router pages + API routes
│   ├── api/              # Backend API routes
│   ├── projects/         # Quản lý dự án
│   ├── revenue/          # Nhập doanh thu
│   ├── expenses/         # Nhập chi phí
│   └── admin/            # Quản trị hệ thống
├── components/           # React components
├── context/              # React contexts (Auth, Projects, DateRange)
├── hooks/                # Custom hooks
└── lib/                  # Utilities, types, Supabase clients
supabase/                 # SQL migrations
```
