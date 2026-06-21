# Lộ trình xây dựng tool theo dõi lãi/lỗ Affiliate (100 CID / 10 MCC)

## Kiến trúc tổng thể (ghi nhớ trước khi bắt đầu)

```
10 MCC (mỗi MCC 10 CID)
      │  Google Ads Scripts chạy hourly tại từng MCC
      ▼
1 webhook endpoint duy nhất (Next.js API route)
      │
      ▼
Database (Supabase/Postgres)
   ├── projects          (map: cid ↔ project_id)
   ├── ad_spend          (cid, date, cost)            ← tự động từ Scripts
   └── affiliate_revenue (project_id, date, revenue)  ← NHẬP THỦ CÔNG (tạm thời)
      │  view pnl_daily JOIN theo project_id + date
      ▼
Dashboard (Next.js, đọc từ view, nút Refresh chỉ query DB)
```

> **Cập nhật:** vì chưa gắn được tracking/subid vào link dự án, doanh thu sẽ nhập tay theo `project_id` thay vì tự động khớp qua subid. Khi nào gắn tracking xong, chỉ cần thêm 1 job tự động ghi vào đúng bảng `affiliate_revenue` này — không phải đổi kiến trúc gì cả.

---

## PHASE 1 — Chuẩn hóa quy ước ID (làm trước tiên, không cần code)

- [ ] Với mỗi dự án, đặt 1 mã định danh duy nhất (vd `proj001`, `proj002`...)
- [ ] Đảm bảo mã này gắn được vào tracking template của campaign Google Ads tương ứng (để biết `project_id ↔ cid`)
- [ ] ~~Subid sang network affiliate~~ — tạm bỏ qua, vì hiện chưa gắn được tracking vào link dự án; doanh thu sẽ nhập thủ công (xem Phase 4)
- [ ] Chuẩn bị danh sách `project_id | cid | tên dự án` để nhập vào tool — Phase 2 sẽ build trang "Quản lý dự án" ngay trong tool, không dùng Google Sheet

> Không có bước này thì không thể biết spend nào thuộc dự án nào, mọi bước sau đều vô nghĩa.

---

## PHASE 2 — Dựng hạ tầng lưu trữ & nhận dữ liệu

- [ ] Build trang "Quản lý dự án": thêm/sửa/xóa mapping `project_id | cid | tên dự án` trực tiếp trên giao diện web → lưu vào bảng `projects` trong Supabase
- [ ] Tạo project Supabase (Postgres miễn phí)
- [ ] Tạo 3 bảng: `projects`, `ad_spend`, `affiliate_revenue` + import dữ liệu từ Phase 1 vào `projects`
- [ ] Tạo view `pnl_daily` (JOIN spend + revenue theo project_id + date)
- [ ] Build project Next.js, deploy lên Vercel (có URL public ổn định)
- [ ] Build API route `/api/ingest/spend` — nhận JSON từ script, ghi vào `ad_spend`, có secret key xác thực đơn giản trong header

> Làm phase này trước Phase 3, vì script Google Ads cần có endpoint sẵn để gửi dữ liệu vào.

---

## PHASE 3 — Thu thập dữ liệu Google Ads qua Scripts

- [ ] Viết 1 script mẫu: loop qua các CID con trong MCC → lấy `date, cost, clicks` → POST về webhook ở Phase 2
- [ ] Dán và test trên **1 MCC duy nhất** trước, dùng nút "Preview" để kiểm tra log, xác nhận data đến đúng webhook
- [ ] Khi ổn, sao chép script (chỉnh mã định danh MCC) sang 9 MCC còn lại
- [ ] Set lịch chạy **hourly** cho cả 10 MCC (qua icon bút chì ở cột Frequency), lệch giờ nhau vài phút giữa các MCC
- [ ] Thêm bộ lọc theo label (`Active_Tool`) để chỉ chạy trên các CID đang cần theo dõi

---

## PHASE 4 — Nhập doanh thu thủ công (tạm thời, thay cho tự động hóa qua network)

- [ ] Build 1 trang "Nhập doanh thu" dạng **bảng giống Excel** (hàng = project, cột = các ngày gần đây) thay vì form nhập từng dòng — với 50+ project, nhập kiểu form-từng-cái sẽ rất mất thời gian
- [ ] Cho phép gõ trực tiếp số tiền vào ô, tự lưu vào `affiliate_revenue (project_id, date, revenue)` khi rời ô (hoặc có nút "Lưu" cuối trang)
- [ ] Cân nhắc tần suất nhập: hằng ngày nếu cần theo dõi sát, hoặc gộp nhập 1 lần/tuần nếu khối lượng quá lớn — chỉ cần nhất quán

> Khi nào gắn được tracking/subid vào link dự án, thay bước này bằng job tự động lấy doanh thu từ network API — ghi vào đúng bảng `affiliate_revenue` này, không cần đổi Phase 5/6 phía sau.

---

## PHASE 5 — Dashboard hiển thị P&L

- [ ] Trang tổng quan: bảng tất cả project, cột spend/revenue/profit/ROI%, tô màu dòng đang lỗ
- [ ] Trang chi tiết: click 1 project → biểu đồ profit theo ngày
- [ ] Nút "Refresh": chỉ query lại view `pnl_daily`, không gọi ra ngoài (dữ liệu đã được Scripts cập nhật sẵn theo giờ)

---

## PHASE 6 — Giám sát & vận hành ổn định

- [ ] Thêm cảnh báo (email/Telegram) nếu 1 `cid` không nhận data mới trong >2 giờ — phát hiện script bị âm thầm dừng
- [ ] Định kỳ 1 lần/tháng kiểm tra log thực thi script ở cả 10 MCC
- [ ] Khi có dự án mới: thêm dòng vào bảng `projects`, gắn label trên CID tương ứng — hệ thống tự nhận diện, không cần sửa code

---

## PHỤ LỤC — Quy trình vibe code bằng VS Code + Claude Pro

### A. Cài đặt môi trường (làm 1 lần)

1. Cài **VS Code** bản 1.98.0 trở lên
2. Cài **Node.js** (bản LTS) — cần để chạy project Next.js sau này
3. Mở VS Code → `Ctrl+Shift+X` (Windows/Linux) hoặc `Cmd+Shift+X` (Mac) → tìm **"Claude Code"** (publisher: Anthropic) → Install
4. Click icon **Spark (✱)** ở góc trên-phải editor (hoặc icon Spark ở thanh Activity Bar bên trái) → **Sign in** → đăng nhập bằng tài khoản **Claude Pro** ngay trên trình duyệt — không cần tạo API key riêng, dùng thẳng gói Pro

### B. Khởi tạo project

5. Tạo thư mục project, mở bằng VS Code (`code ten-thu-muc`)
6. Copy file lộ trình này vào thư mục gốc, đặt tên `ROADMAP.md` — Claude sẽ đọc file này để hiểu toàn bộ kiến trúc
7. Trong khung chat Claude Code, gõ `/init` — lệnh này tạo file `CLAUDE.md` ghi nhớ ngữ cảnh dự án, để các phiên làm việc sau không phải giải thích lại từ đầu

### C. Quy trình làm việc cho mỗi Phase

8. Mở 1 phiên chat mới trong Claude Code (icon Spark)
9. Bật **Plan mode** (chọn ở thanh chế độ dưới khung nhập) — Claude sẽ mô tả kế hoạch trước khi sửa file, bạn duyệt trước khi cho code chạy thật
10. Gõ prompt kiểu: *"Đọc ROADMAP.md, thực hiện Phase 2: khởi tạo project Next.js + schema Supabase theo đúng mô tả"*
11. Xem bản kế hoạch Claude đưa ra → góp ý / chỉnh sửa nếu cần → đồng ý cho thực thi
12. Claude sửa file, hiện diff (so sánh trước/sau) từng file → bạn **Accept** hoặc yêu cầu sửa lại
13. Sau khi xong, nhờ Claude tự chạy thử (vd `npm run dev`) ngay trong terminal tích hợp để kiểm tra lỗi
14. Nhờ Claude **commit git** sau mỗi bước hoàn chỉnh (*"commit thay đổi này với message mô tả rõ"*) — giúp dễ quay lại nếu bước sau làm hỏng

### D. Lặp lại cho từng Phase tiếp theo

15. Mỗi khi bắt đầu Phase mới, nhắc lại: *"Đọc ROADMAP.md, đánh dấu Phase X đã xong, bắt đầu Phase Y"*
16. Gõ `/usage` định kỳ để theo dõi mức dùng còn lại trong gói Pro, tránh hết hạn mức giữa chừng việc đang dở

---

## Thứ tự ưu tiên nếu muốn có kết quả nhanh nhất

1. Phase 1 (chuẩn hóa ID) — bắt buộc làm đầu tiên
2. Phase 2 + Phase 3 cho **1 MCC mẫu** — chứng minh luồng spend chạy thông suốt
3. Phase 5 (dashboard cơ bản) — nhìn thấy kết quả sớm để có động lực
4. Nhân rộng Phase 3 ra 9 MCC còn lại
5. Phase 4 (doanh thu affiliate) — ghép nốt để có P&L hoàn chỉnh
6. Phase 6 — hoàn thiện khâu vận hành lâu dài
