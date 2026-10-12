import { NextResponse } from 'next/server';
import { apiAppUser } from '../../../../../lib/auth';
import { COMMUNITY_FEATURE, hasFeatureEntitlement } from '../../../../../lib/community';
import { supabaseAdmin } from '../../../../../lib/supabaseServer';
import { hasRequiredTermsConsent } from '../../../../../lib/terms';

function homeUrl(req: Request, userId: string, message: string, kind: 'message' | 'error' = 'message') {
  const url = new URL(`/u/${encodeURIComponent(userId)}/home`, req.url);
  url.searchParams.set(kind, message);
  return url;
}

export async function POST(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  const actor = await apiAppUser();
  if (!actor) return NextResponse.redirect(new URL('/?error=login_required', req.url), 303);
  const { eventId } = await params;
  const form = await req.formData();
  const userId = String(form.get('userId') || '').trim();
  const intent = String(form.get('intent') || 'register');
  if (actor.id !== userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await hasFeatureEntitlement(userId, COMMUNITY_FEATURE))) return NextResponse.json({ error: 'community_disabled' }, { status: 403 });
  if (!(await hasRequiredTermsConsent(userId))) return NextResponse.json({ error: 'terms_consent_required' }, { status: 428 });
  if (!['register', 'cancel'].includes(intent)) return NextResponse.redirect(homeUrl(req, userId, '操作を確認してください。', 'error'), 303);

  const supabase = supabaseAdmin();
  const event = await supabase.from('community_events').select('id,title,status,starts_at').eq('id', eventId).eq('status', 'published').single();
  if (event.error || !event.data) return NextResponse.redirect(homeUrl(req, userId, '対象のイベントを確認できません。', 'error'), 303);
  const status = intent === 'cancel' ? 'cancelled' : 'registered';
  const saved = await supabase.from('event_registrations').upsert({ event_id: eventId, user_id: userId, status }, { onConflict: 'event_id,user_id' });
  if (saved.error) return NextResponse.redirect(homeUrl(req, userId, `更新できませんでした: ${saved.error.message}`, 'error'), 303);
  await supabase.from('app_event_logs').insert({ user_id: userId, actor_id: actor.auth_user_id, event_type: `community.event_${status}`, event_version: 'community_v1', payload: { event_id: eventId, title: event.data.title } });
  return NextResponse.redirect(homeUrl(req, userId, intent === 'cancel' ? '参加登録を取り消しました。' : '参加登録を受け付けました。'), 303);
}
