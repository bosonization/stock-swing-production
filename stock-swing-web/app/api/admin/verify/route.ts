import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseServer';
import { apiAppUser } from '../../../../lib/auth';

function normalizeKey(raw: unknown) { return String(raw ?? '').trim(); }

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const actor = await apiAppUser();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!userId || (actor.id !== userId && actor.role !== 'admin')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  return NextResponse.json({ ok: true });
}
