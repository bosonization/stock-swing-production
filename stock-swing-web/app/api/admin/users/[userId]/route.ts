import { NextResponse } from 'next/server';
import { apiAppUser } from '../../../../../lib/auth';
import { supabaseAdmin } from '../../../../../lib/supabaseServer';

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
  const status = String(form.get('status') || '');
  if (!['active', 'suspended'].includes(status)) {
    return NextResponse.redirect(operationsUrl(req, '利用状態の指定が不正です。', 'error'), 303);
  }
  if (userId === actor.id) {
    return NextResponse.redirect(operationsUrl(req, '自分自身の管理者アカウントは停止できません。', 'error'), 303);
  }

  const supabase = supabaseAdmin();
  const updated = await supabase
    .from('app_users')
    .update({ status })
    .eq('id', userId)
    .select('id,display_name,email,status')
    .single();

  if (updated.error) {
    return NextResponse.redirect(operationsUrl(req, `更新できませんでした: ${updated.error.message}`, 'error'), 303);
  }

  await supabase.from('app_event_logs').insert({
    user_id: userId,
    actor_id: actor.auth_user_id,
    event_type: 'admin.user_status_changed',
    event_version: 'production_v1',
    payload: { status, target_display_name: updated.data.display_name, target_email: updated.data.email },
  });

  const label = updated.data.display_name || updated.data.email || updated.data.id;
  const action = status === 'active' ? '利用を再開' : '利用を停止';
  return NextResponse.redirect(operationsUrl(req, `${label} の${action}しました。`), 303);
}

