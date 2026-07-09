// Sinh slug an toàn (khớp regex ^[a-z0-9_-]+$) từ tên tự do, bỏ dấu tiếng Việt.
// Dùng làm slug engine cho affiliate_networks (= tên file engine/configs/<slug>.json).
export function slugify(name: string): string {
  const base = (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // bỏ dấu (combining marks)
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-') // ký tự lạ → -
    .replace(/^-+|-+$/g, '') // trim -
  return base || 'network'
}

// Chọn slug chưa dùng: base, base-2, base-3…
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const set = new Set(taken)
  const base = slugify(name)
  if (!set.has(base)) return base
  let n = 2
  while (set.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}
