import { NextResponse } from 'next/server';
export async function POST() {
  return NextResponse.json({ status: 'unavailable', reason: 'Production scenarios are served by the authenticated MN25 backend at /api/production/scenario.' }, { status: 410 });
}
