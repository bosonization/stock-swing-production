import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

function normalizeCode(raw: unknown) {
  const value = String(raw ?? '').trim().toUpperCase().replace('.T', '');
  if (!value) return '';
  return value.replace(/\s+/g, '').replace(/-/g, '');
}

function normalizeKey(raw: unknown) {
  return String(raw ?? '').trim();
}

export async function POST(req: Request) {
  const body = await req.json();
  const userId = String(body.userId || '').trim();
  const adminKey = normalizeKey(body.adminKey);
  const rows = Array.isArray(body.rows) ? body.rows : [];

  if (!userId || !adminKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const user = await supabase
    .from('app_users')
    .select('id,display_name,max_watchlist_count,admin_key,status')
    .eq('id', userId)
    .single();

  if (user.error || !user.data) {
    return NextResponse.json({ error: `user not found: ${userId}` }, { status: 404 });
  }
  if (user.data.status !== 'active') {
    return NextResponse.json({ error: `user is not active: ${userId}` }, { status: 403 });
  }

  const expectedKey = normalizeKey(user.data.admin_key || process.env.ADMIN_UPLOAD_KEY || '');
  if (!expectedKey || adminKey !== expectedKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const seen = new Set<string>();
  const items = rows
    .map((r: any) => {
      const code = normalizeCode(r.code ?? r.Code ?? r['銘柄コード']);
      const name = String(r.name ?? r.Name ?? r['銘柄名'] ?? '').trim();
      return { code, name };
    })
    .filter((r: any) => {
      if (!r.code || seen.has(r.code)) return false;
      seen.add(r.code);
      return true;
    })
    .map((r: any) => ({
      user_id: userId,
      code: r.code,
      name: r.name,
      is_active: true,
      updated_at: new Date().toISOString(),
    }));

  const max = user.data.max_watchlist_count ?? 400;
  if (items.length > max) {
    return NextResponse.json({ error: `registered list limit exceeded: ${items.length}/${max}` }, { status: 400 });
  }

  // ユーザ単位で最新CSVに置き換える。過去分は物理削除せずinactive化して履歴の余地を残す。
  const disable = await supabase
    .from('watchlists')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (disable.error) return NextResponse.json({ error: disable.error.message }, { status: 500 });

  if (items.length > 0) {
    const upsert = await supabase
      .from('watchlists')
      .upsert(items, { onConflict: 'user_id,code' });
    if (upsert.error) return NextResponse.json({ error: upsert.error.message }, { status: 500 });
  }

  await supabase.from('app_event_logs').insert({
    user_id: userId,
    event_type: 'registered_symbols_csv_upsert',
    event_version: 'poc_concept_v1',
    payload: { count: items.length },
    created_at: new Date().toISOString(),
  }).then(() => null);

  return NextResponse.json({ ok: true, count: items.length });
}
