// Đọc bảng <table> trong DOM (cho dashboard render HTML server-side như Localrent).
// Mỗi dòng → object có key theo CHỈ SỐ cột (col_0, col_1…) và theo TÊN HEADER (nếu có).
// Dùng col_N làm path mapping cho chắc (tên header có thể chứa dấu chấm/ký tự lạ).

const EXTRACT_TABLES = () => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
  // Bảng có đang HIỂN THỊ không (tab bị ẩn display:none → getClientRects rỗng). Dùng để tự nhắm
  // đúng bảng khi 1 trang có nhiều tab (vd click "Payment history" → bảng payout visible, Commission ẩn).
  const isVisible = (el) => { try { return el.getClientRects().length > 0 } catch { return true } }
  const out = []
  // Dựng grid từ headers[] + rowCells[][] (bóc nhãn cột responsive như trước).
  const pushGrid = (index, headers, rowCells, visible = true) => {
    const rows = rowCells
      .map((cells) => {
        // Bỏ dòng placeholder (1 ô spanning kiểu "Empty/No data") → bảng payout rỗng coi là 0 dòng.
        if (cells.length < 2) return null
        const o = {}
        cells.forEach((v, i) => {
          const h = headers[i]
          if (h && v.toLowerCase().startsWith(h.toLowerCase())) v = v.slice(h.length).trim()
          o[`col_${i}`] = v
          if (h) o[h] = v
        })
        return o
      })
      .filter(Boolean)
    // Có dữ liệu (>=2 dòng) HOẶC bảng RỖNG nhưng có header thật (>=2) → giữ để cấu hình theo tên cột.
    if (rows.length >= 2 || (rows.length === 0 && headers.length >= 2)) out.push({ table_index: index, headers, rows, visible })
  }

  // 1) <table> — GIỮ chỉ số DOM (table_index = vị trí trong querySelectorAll('table'))
  //    để không vỡ config đã lưu.
  Array.from(document.querySelectorAll('table')).forEach((table, ti) => {
    const trs = Array.from(table.querySelectorAll('tr'))
    if (trs.length < 2) return
    let headers = Array.from(table.querySelectorAll('thead th')).map((c) => clean(c.textContent))
    let bodyRows = Array.from(table.querySelectorAll('tbody tr'))
    if (headers.length === 0) {
      headers = Array.from(trs[0].querySelectorAll('th,td')).map((c) => clean(c.textContent))
      bodyRows = trs.slice(1)
    }
    pushGrid(ti, headers, bodyRows.map((tr) => Array.from(tr.querySelectorAll('td,th')).map((c) => clean(c.textContent))), isVisible(table))
  })

  // 2) ARIA grid: [role=table]/[role=grid] (chỉ số 1000+)
  Array.from(document.querySelectorAll('[role="table"],[role="grid"]')).forEach((g, gi) => {
    const rowsEl = Array.from(g.querySelectorAll('[role="row"]'))
    if (rowsEl.length < 2) return
    let headers = Array.from(g.querySelectorAll('[role="columnheader"]')).map((c) => clean(c.textContent))
    let bodyRowsEl
    if (headers.length) {
      bodyRowsEl = rowsEl.filter((r) => r.querySelectorAll('[role="columnheader"]').length === 0)
    } else {
      headers = Array.from(rowsEl[0].querySelectorAll('[role="cell"],[role="gridcell"],[role="columnheader"]')).map((c) => clean(c.textContent))
      bodyRowsEl = rowsEl.slice(1)
    }
    pushGrid(1000 + gi, headers, bodyRowsEl.map((r) => Array.from(r.querySelectorAll('[role="cell"],[role="gridcell"]')).map((c) => clean(c.textContent))), isVisible(g))
  })

  // 3) Div lặp cấu trúc (best-effort, chỉ số 2000+): container có >=3 con cùng tag, mỗi con
  //    có 2–15 "ô", và nhiều dòng có token NGÀY + SỐ (lọc bỏ nav/menu). Cap 5.
  const dateLike = (s) => /\d{4}-\d{2}-\d{2}|\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}/.test(s)
  const numLike = (s) => /\d[.,]\d|\d\s*(?:USD|EUR|€|\$|₫)/i.test(s)
  let ri = 0, scanned = 0
  for (const cont of Array.from(document.querySelectorAll('div,ul,ol,section'))) {
    if (scanned++ > 5000 || ri >= 5) break
    const kids = Array.from(cont.children)
    if (kids.length < 3) continue
    const tag = kids[0].tagName
    if (kids.filter((k) => k.tagName === tag).length < 3) continue
    const rowCells = kids.filter((k) => k.tagName === tag).map((k) => {
      let cells = Array.from(k.children).map((c) => clean(c.textContent)).filter((t) => t !== '')
      if (cells.length < 2) cells = [clean(k.textContent)].filter(Boolean)
      return cells
    })
    const maxc = Math.max(...rowCells.map((c) => c.length))
    if (maxc < 2 || maxc > 15) continue
    if (rowCells.filter((cells) => cells.some(dateLike)).length < 3) continue
    if (rowCells.filter((cells) => cells.some(numLike)).length < 3) continue
    pushGrid(2000 + ri, [], rowCells, isVisible(cont))
    ri++
  }

  return out
}

// Tất cả bảng của trang (dùng khi dò).
export async function extractTables(page) {
  try { return await page.evaluate(EXTRACT_TABLES) } catch { return [] }
}

// 1 bảng theo index (dùng khi fetch). Không thấy đúng index → lấy bảng đầu.
export async function extractTable(page, tableIndex = 0) {
  const tables = await extractTables(page)
  const t = tables.find((x) => x.table_index === tableIndex) ?? tables[0]
  return t ? t.rows : []
}

// Đọc bảng qua NHIỀU TRANG: đọc trang hiện tại → bấm "next" → đọc tiếp, tích luỹ +
// khử trùng, đến khi hết nút next / không có dòng mới / chạm maxPages.
// Selector next: phủ Rails will_paginate (a.next_page), kaminari & Bootstrap (rel=next,
// .pagination .next a, li.next a), + icon/class chevron/arrow-right, aria-label. Trang cuối
// thường render <span>/disabled → tự dừng. Fallback: link/button có text chỉ là ›»→>.
const NEXT_SEL = [
  'a[rel="next"]', 'a.next_page', '.pagination a.next', '.pagination li.next a',
  'li.next:not(.disabled) a', 'a[aria-label*="next" i]', 'button[aria-label*="next" i]',
  'a[class*="next-page" i]', '[class*="pagination"] a[class*="next" i]',
  '[class*="chevron-right" i]', '[class*="arrow-right" i]', '[class*="angle-right" i]',
].join(', ')

// Tìm nút "next" hợp lệ (đang hiện + bật). Trả locator hoặc null.
async function findNext(page) {
  let loc = page.locator(NEXT_SEL).first()
  if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false)) && (await loc.isEnabled().catch(() => false))) return loc
  // Fallback theo text chevron next (›»→>). Lấy cái cuối (thường nằm bên phải).
  loc = page.locator('a, button').filter({ hasText: /^\s*[›»→⟩>]\s*$/ }).last()
  if ((await loc.count().catch(() => 0)) > 0 && (await loc.isVisible().catch(() => false)) && (await loc.isEnabled().catch(() => false))) return loc
  return null
}

export async function extractTableAllPages(page, tableIndex = 0, { maxPages = 100, settleMs = 1200 } = {}) {
  const seen = new Set()
  const all = []
  let pages = 0
  for (; pages < maxPages; pages++) {
    const rows = await extractTable(page, tableIndex)
    let added = 0
    for (const r of rows) { const k = JSON.stringify(r); if (!seen.has(k)) { seen.add(k); all.push(r); added++ } }
    if (added === 0 && pages > 0) break // trang không có dòng mới → dừng (chống lặp)

    const next = await findNext(page)
    if (!next) break

    await next.click().catch(() => {})
    await page.waitForLoadState('domcontentloaded').catch(() => {})
    await page.waitForTimeout(settleMs)
  }
  return { rows: all, pages: pages + 1 }
}
