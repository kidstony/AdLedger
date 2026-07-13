// Chuẩn hoá affiliate_url (Quản lý dự án) → dashboard_url của engine account.
// {base} trong config engine dùng nguyên URL này (có thể kèm path) nên KHÔNG cắt
// về origin — chỉ thêm scheme nếu thiếu, validate, bỏ '/' cuối.
export function normalizeDashboardUrl(raw: string | null | undefined): string | null {
  let s = (raw ?? '').trim()
  if (!s) return null
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  try { new URL(s) } catch { return null }
  return s.replace(/\/+$/, '')
}
