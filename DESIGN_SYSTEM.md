# Design System — P&L Tracker

Tool quản lý P&L cho nhiều dự án affiliate marketing (Google Ads): project, CID, bank account, doanh thu, chi phí.

## Routes

| Route | Mục đích |
|---|---|
| `/dashboard` | P&L tổng quan, filter ngày + dự án |
| `/projects` | Quản lý dự án (table + search + bulk) |
| `/projects/[id]` | Chi tiết P&L 1 dự án (chart + daily) |
| `/master-projects` | Nhóm thương hiệu, aggregate nhiều dự án |
| `/revenue` | Nhập doanh thu (spreadsheet, keyboard nav) |
| `/expenses` | Chi phí: QC / Thuê TK / CP Khác / Tổng hợp |
| `/banks` | Quản lý bank/ví |
| `/admin` | User, phân quyền |
| `/admin/integrations` | Google Ads script + mapping campaign |

---

## Hệ thống màu (bắt buộc)

| Loại dữ liệu | Tailwind |
|---|---|
| Chi phí (QC, Thuê TK, CP Khác) | `text-slate-700` |
| Doanh thu xác nhận (đã nhận) | `text-blue-600` |
| Màn hình / Chờ về / Ước tính (chưa nhận) | `text-amber-500` |
| Lợi nhuận thực dương | `text-green-600` |
| ROI thực dương | `text-emerald-600` |
| Lỗ / giá trị âm | `text-red-600` |
| Null / trống | `text-slate-300` — hiện "—" |

**Quy tắc:** Amber = chưa nhận được tiền. Mọi "ước tính", "chờ về", "màn hình" đều amber.

---

## Component patterns

### Shared components (`src/components/ui/`) — dùng thay vì tự chế

| Component | Dùng cho | Ghi chú |
|---|---|---|
| `PageHeader` | Header mọi trang: title, subtitle, badge, backHref, actions | Thay `text-xl font-semibold text-slate-800` chép tay |
| `ConfirmDialog` (`useConfirm`) | Xác nhận xóa/hành động nguy hiểm | **Cấm `window.confirm()`/`alert()`**; `if (!(await confirmDlg({ title }))) return` |
| `StatusPill` | Pill trạng thái tone cố định (green/amber/red/blue/indigo/slate) | KHÔNG dùng cho pill màu theo DB (project status, category) |
| `StatCard` | Thẻ chỉ số (label/value/sub/icon, active để làm card-as-tab, loading skeleton) | Wrapper domain (SummaryCards…) compose từ đây |
| `SegmentedControl` | Toggle nhóm nút (Tiền màn hình/Thực nhận, table/kanban) | `activeClass` để đổi màu chữ active (amber/blue) |
| `TabBar` | Tab underline cấp trang | Active = `indigo-600` (accent chuẩn duy nhất) |
| Hook `useAsyncAction` | Nút async: pending + toast lỗi/thành công | `src/hooks/useAsyncAction.ts` |

Quy tắc: primary button = `ui/Button` variant `default`; hủy = `outline`; xóa = `destructive`. Accent tab/link active = `indigo-600`.

### Summary Cards
```
grid grid-cols-4 gap-4
card: bg-white rounded-lg border border-slate-200 p-5 shadow-sm  (= StatCard)
```
- Thứ tự: Chi phí → Doanh thu → Lợi nhuận → ROI
- Sub-label pending: `<Monitor size={10} />` + amber text bên dưới main value
- Progress bar pending: `pending / (confirmed + pending) * 100`

### Tables
- Header: `bg-slate-50 sticky top-0 z-10 text-xs font-medium text-slate-500 uppercase`
- Cột ước tính/màn hình: `text-amber-400` + `<Monitor size={11} />` trong header
- Row lỗ: `bg-red-50 hover:bg-red-100` — Row lời: `hover:bg-slate-50`
- Sort: click header → ArrowUp/Down/UpDown icons

### Loading & Empty State
- Loading: dùng `<TableSkeleton rows={n} cols={n} />` (`src/components/ui/TableSkeleton.tsx`) — không viết inline `animate-pulse`
- Empty (standalone): `<EmptyState message="..." />`
- Empty (trong tbody): `<EmptyState message="..." colSpan={n} />`
- (`src/components/ui/EmptyState.tsx`)

### Toast / Feedback
- `import { toast } from 'sonner'` — `<Toaster />` đã mount global trong `Providers.tsx`
- Dùng `toast.success('...')` / `toast.error('...')` sau mỗi thao tác tạo, sửa, xóa, sync

### Modals
- Backdrop: `fixed inset-0 bg-black/40 flex items-center justify-center z-50`
- Container: `bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4`
- Actions: `flex justify-end gap-2 mt-4` — Button outline (Hủy) + Button primary (Lưu)

---

## UX cho dữ liệu lớn

**Date range global**
- Dùng `useDateRange()` từ `src/context/DateRangeContext.tsx` — cung cấp `{ dateRange, setDateRange, fromStr, toStr }`
- Không dùng local state cho DateRangePicker — filter ở 1 trang, chuyển trang không reset

**Search & Filter** (bắt buộc khi list > 15 items)
- Dùng `ProjectFilterDropdown` (`src/components/revenue/ProjectFilterDropdown.tsx`) — debounce 150ms + virtual scroll
- Phím tắt `/` focus search (nhân rộng từ Revenue pattern)

**Scroll vs Pagination**
- < 50 items: `max-h-[calc(100vh-Xpx)] overflow-y-auto` + sticky header
- > 50 items: pagination 50/page (Expenses Summary pattern)
- Modal/dropdown: fixed height + `overflow-y-auto`

**Bulk actions**
- Checkbox col đầu + floating action bar khi có selection
- Patterns: bulk delete (Projects), batch confirm (Revenue)

**Keyboard navigation**
- Arrow keys, Tab/Shift+Tab, Ctrl+Z undo, Ctrl+V paste Excel
- Tái dùng `EditableCell` component (`src/components/revenue/EditableCell.tsx`)

**Collapsible & Tree**
- Setup ít dùng: collapsed mặc định (ChevronDown/Right + state)
- Tree table: parent `font-medium`, child `pl-10 text-xs bg slightly different`

---

## Glossary — từ chuẩn (canonical)

**Bắt buộc dùng đúng các từ này.** Quy tắc: "màn hình" luôn viết thường; nhóm màn hình = amber, nhóm thực nhận = xanh. `total_pending` == `total_screen_revenue` → dùng chung nhóm "màn hình".

| Khái niệm | Nút/toggle | Cột bảng | Nhãn thẻ (card) | Màu |
|---|---|---|---|---|
| Doanh thu chưa nhận (screen/pending) | **Tiền màn hình** | **DT màn hình** | **Doanh thu (màn hình)** | Amber |
| Lợi nhuận screen | — | **LN màn hình** | **Lợi nhuận (màn hình)** | Amber |
| ROI screen | — | — | **ROI (màn hình)** | Amber |
| Doanh thu đã nhận (confirmed) | **Thực nhận** | **Doanh thu** | **Doanh thu** | Blue |
| Phụ đề ô đã nhận | — | — | **✓ đã nhận** | — |

Không dùng lại các biến thể cũ: ~~DT Màn hình~~, ~~Doanh thu (Màn hình)~~, ~~Theo màn hình~~, ~~Doanh thu thực~~, ~~Doanh thu chờ~~, ~~Chờ TT~~ (cho doanh thu), ~~(Ước tính)~~.
Chi phí: **Tổng chi phí** (thẻ) / **Tổng CP** (bảng hẹp), **CP khác**, **Chi phí QC** / **QC** (viết tắt), **Thuê TK**.

Lưu ý enum nội bộ (chưa đồng bộ, không hiển thị): confirmed = `'confirmed'` (DB/dashboard) nhưng `'revenue'` (revenue tab); screen = `'pending'` (DB) nhưng `'screen'` (UI toggle).

| Thuật ngữ | Nghĩa | Màu |
|---|---|---|
| CID | Google Ads Customer ID (xxx-xxx-xxxx) | — |
| MCC | Manager account Google Ads hierarchy | — |

---

## Utility functions (`src/lib/utils.ts`)

Luôn dùng, không tự format:
- `formatVND(n)` — compact "$1.2K" → dùng trong table cells
- `formatVNDFull(n)` — đầy đủ "$1,234.56" → dùng trong summary cards
- `formatROI(n)`, `formatCid(cid)`, `cn(...classes)`
- `getProfitTextClass(n)`, `getRoiTextClass(n)`, `getProfitRowClass(n)`

---

## Security

- `SUPABASE_SERVICE_ROLE_KEY`: **không bao giờ** có prefix `NEXT_PUBLIC_` — API routes only
- `ADS_SCRIPT_SECRET`: server-side only
- Tất cả số tiền: **USD**

