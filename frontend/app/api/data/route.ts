import { NextResponse } from 'next/server';
export async function GET() {
  return NextResponse.json({ status: 'unavailable', reason: 'Production intelligence is served by the authenticated MN25 backend.' }, { status: 410 });
}
