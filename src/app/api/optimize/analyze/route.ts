import { NextResponse } from 'next/server'
import { getCallerProfile } from '@/lib/require-role'
import { runAnalysis, AnalyzeTrigger } from '@/lib/optimizer/engine'

// POST /api/optimize/analyze — chạy engine Optimizer v2.
// 2 đường vào:
//   • Worker local (engine/worker.js) ping sau mỗi chu kỳ sync revenue:
//     header x-analyze-secret = env ANALYZE_SECRET (không có session).
//   • User bấm "Phân tích lại" trên UI: session super_admin/manager.
// Chạy có time budget (engine tự dừng và ghi tiến độ nếu quá) — Vercel free tier.
export const maxDuration = 300
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // trim() cả hai phía: giá trị env thêm qua CLI/dashboard dễ dính \r\n hoặc
  // khoảng trắng thừa — không trim thì so sánh fail âm thầm (worker nhận 403).
  const secret = (req.headers.get('x-analyze-secret') ?? '').trim()
  const envSecret = (process.env.ANALYZE_SECRET ?? '').trim()

  let organizationId: string | null = null
  let trigger: AnalyzeTrigger = 'manual'
  let force = false

  if (secret && envSecret && secret === envSecret) {
    // Worker ping — không có org context → engine quét mọi org.
    trigger = 'worker'
  } else {
    const caller = await getCallerProfile(req)
    if (!caller || (caller.role !== 'super_admin' && caller.role !== 'manager')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    organizationId = caller.organization_id ?? null
    trigger = 'manual'
    force = true   // user chủ động bấm → bỏ qua cửa sổ claim 15 phút
  }

  try {
    const body = await req.json().catch(() => ({}))
    if (body?.organization_id && trigger === 'worker') organizationId = body.organization_id

    const result = await runAnalysis({ organizationId, trigger, force })
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Analyze failed' }, { status: 500 })
  }
}
