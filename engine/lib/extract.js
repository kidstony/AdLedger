// Lấy giá trị theo dot-notation: "offer.name" → obj.offer.name
export function getPath(obj, dotPath) {
  if (dotPath === '' || dotPath == null) return obj
  let current = obj
  for (const key of dotPath.split('.')) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[key]
  }
  return current
}

// Lấy mảng dòng dữ liệu theo rows_path.
// Hậu tố [] trên một đoạn = flatten mảng đó rồi đi tiếp vào từng phần tử:
//   "data.results[]"      → data.results (mảng)
//   "data.pages[].rows"   → gộp rows của mọi phần tử trong data.pages
// rows_path rỗng = response gốc đã là mảng. Giá trị cuối không phải mảng → wrap [value].
export function extractRows(payload, rowsPath) {
  if (rowsPath === '' || rowsPath == null) {
    return Array.isArray(payload) ? payload : [payload]
  }

  let candidates = [payload]
  for (const segment of rowsPath.split('.')) {
    const flatten = segment.endsWith('[]')
    const key = flatten ? segment.slice(0, -2) : segment
    const next = []
    for (const item of candidates) {
      const value = key === '' ? item : getPath(item, key)
      if (value === undefined || value === null) continue
      if (flatten) {
        if (Array.isArray(value)) next.push(...value)
        else next.push(value)
      } else {
        next.push(value)
      }
    }
    candidates = next
  }

  // Sau khi duyệt hết path: gộp về 1 mảng dòng
  const rows = []
  for (const item of candidates) {
    if (Array.isArray(item)) rows.push(...item)
    else rows.push(item)
  }
  return rows
}
