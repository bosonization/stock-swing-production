import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
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
