import { NextResponse } from 'next/server';
import { apiAppUser } from '../../../../lib/auth';
import { COMMUNITY_FEATURE, hasFeatureEntitlement } from '../../../../lib/community';
import { supabaseAdmin } from '../../../../lib/supabaseServer';
import { hasRequiredTermsConsent } from '../../../../lib/terms';

function homeUrl(req: Request, userId: string, message: string, kind: 'message' | 'error' = 'message') {
  const url = new URL(`/u/${encodeURIComponent(userId)}/home`, req.url);
  url.searchParams.set(kind, message);
  url.hash = 'support';
  return url;
}

export async function POST(req: Request) {
  const actor = await apiAppUser();
  if (!actor) return NextResponse.redirect(new URL('/?error=login_required', req.url), 303);
  const form = await req.formData();
  const userId = String(form.get('userId') || '').trim();
  const category = String(form.get('category') || '').trim();
  const subject = String(form.get('subject') || '').trim();
  const message = String(form.get('message') || '').trim();
  if (actor.id !== userId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (!(await hasFeatureEntitlement(userId, COMMUNITY_FEATURE))) return NextResponse.json({ error: 'community_disabled' }, { status: 403 });
  if (!(await hasRequiredTermsConsent(userId))) return NextResponse.json({ error: 'terms_consent_required' }, { status: 428 });
  if (!['operation', 'account', 'event', 'withdrawal', 'other'].includes(category) || subject.length < 3 || subject.length > 160 || message.length < 10 || message.length > 5000) {
    return NextResponse.redirect(homeUrl(req, userId, '入力内容を確認してください。', 'error'), 303);
  }

  const supabase = supabaseAdmin();
  const saved = await supabase.from('support_tickets').insert({ user_id: userId, category, subject, message }).select('id').single();
  if (saved.error) return NextResponse.redirect(homeUrl(req, userId, `送信できませんでした: ${saved.error.message}`, 'error'), 303);
  await supabase.from('app_event_logs').insert({ user_id: userId, actor_id: actor.auth_user_id, event_type: 'community.support_created', event_version: 'community_v1', payload: { ticket_id: saved.data.id, category } });
  return NextResponse.redirect(homeUrl(req, userId, 'お問い合わせを受け付けました。運営者が公式管理画面で確認します。'), 303);
}
