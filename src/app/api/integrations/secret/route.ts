import { NextResponse } from 'next/server'

export async function GET() {
  const secret = process.env.ADS_SCRIPT_SECRET ?? ''
  const preview = secret.length > 4 ? '•'.repeat(secret.length - 4) + secret.slice(-4) : '••••'
  return NextResponse.json({ preview, full: secret })
}
