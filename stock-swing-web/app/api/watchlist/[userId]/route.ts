import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseServer';
import { apiAppUser } from '../../../../lib/auth';

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const actor = await apiAppUser();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (actor.id !== userId && actor.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const supabase = supabaseAdmin();

  const user = await supabase
    .from('app_users')
    .select('id,display_name,plan,status,max_watchlist_count')
    .eq('id', userId)
    .single();

  if (user.error || !user.data) {
    return NextResponse.json({ error: `user not found: ${userId}` }, { status: 404 });
  }

  const rows = await supabase
    .from('watchlists')
    .select('code,name,memo,is_active,updated_at')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('code');

  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });
  return NextResponse.json({ user: user.data, rows: rows.data ?? [] });
}
