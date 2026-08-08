import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

function normalizeKey(raw: unknown) { return String(raw ?? '').trim(); }

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId || '').trim();
  const adminKey = normalizeKey(body.adminKey);
  if (!userId || !adminKey) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const supabase = supabaseAdmin();
  const user = await supabase.from('app_users').select('id,admin_key,status').eq('id', userId).single();
  if (user.error || !user.data) return NextResponse.json({ error: `user not found: ${userId}` }, { status: 404 });
  if (user.data.status !== 'active') return NextResponse.json({ error: `user is not active: ${userId}` }, { status: 403 });
  const expectedKey = normalizeKey(user.data.admin_key || process.env.ADMIN_UPLOAD_KEY || '');
  if (!expectedKey || adminKey !== expectedKey) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true });
}
