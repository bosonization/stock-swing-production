import { NextResponse } from 'next/server';
import { apiAppUser } from '../../../../../../lib/auth';
import { supabaseAdmin } from '../../../../../../lib/supabaseServer';

function operationsUrl(req: Request, message: string, kind: 'message' | 'error' = 'message') {
  const url = new URL('/admin/operations', req.url);
  url.searchParams.set(kind, message);
  return url;
}

export async function POST(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const actor = await apiAppUser();
  if (!actor) return NextResponse.redirect(new URL('/?error=login_required', req.url), 303);
  if (actor.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { userId } = await params;
  const form = await req.formData();
  const featureKey = String(form.get('featureKey') || '');
  const enabled = String(form.get('enabled') || '') === 'true';
  if (!['community', 'stock_swing_tool'].includes(featureKey)) return NextResponse.redirect(operationsUrl(req, '機能の指定が不正です。', 'error'), 303);
  const supabase = supabaseAdmin();
  const target = await supabase.from('app_users').select('id,display_name,email').eq('id', userId).single();
  if (target.error || !target.data) return NextResponse.redirect(operationsUrl(req, '対象会員を確認できません。', 'error'), 303);
  const saved = await supabase.from('feature_entitlements').upsert({ user_id: userId, feature_key: featureKey, enabled, reason: 'operations admin change', granted_by: actor.auth_user_id }, { onConflict: 'user_id,feature_key' });
  if (saved.error) return NextResponse.redirect(operationsUrl(req, `利用権限を更新できませんでした: ${saved.error.message}`, 'error'), 303);
  await supabase.from('app_event_logs').insert({ user_id: userId, actor_id: actor.auth_user_id, event_type: 'community.entitlement_changed', event_version: 'community_v1', payload: { feature_key: featureKey, enabled } });
  const label = target.data.display_name || target.data.email || target.data.id;
  return NextResponse.redirect(operationsUrl(req, `${label} の銘柄整理ツールを${enabled ? '有効' : '停止'}にしました。`), 303);
}
