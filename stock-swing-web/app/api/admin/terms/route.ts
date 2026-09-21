import { NextResponse } from 'next/server';
import { apiAppUser } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

function operationsUrl(req: Request, message: string, kind: 'message' | 'error' = 'message') {
  const url = new URL('/admin/operations', req.url);
  url.searchParams.set(kind, message);
  return url;
}

export async function POST(req: Request) {
  const actor = await apiAppUser();
  if (!actor) return NextResponse.redirect(new URL('/?error=login_required', req.url), 303);
  if (actor.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const form = await req.formData();
  const version = String(form.get('version') || '').trim();
  const title = String(form.get('title') || '').trim();
  const body = String(form.get('body') || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]{1,79}$/i.test(version)) {
    return NextResponse.redirect(operationsUrl(req, '版番号は半角英数・ハイフン・アンダーバー・ピリオドの2〜80文字で入力してください。', 'error'), 303);
  }
  if (title.length < 3 || title.length > 120 || body.length < 100 || body.length > 20000) {
    return NextResponse.redirect(operationsUrl(req, 'タイトルは3〜120文字、本文は100〜20,000文字で入力してください。', 'error'), 303);
  }

  const supabase = supabaseAdmin();
  const published = await supabase.rpc('publish_terms_document', {
    p_terms_type: 'service_terms',
    p_version: version,
    p_title: title,
    p_body: body,
    p_published_by: actor.auth_user_id,
  });
  if (published.error) {
    return NextResponse.redirect(operationsUrl(req, `規約を公開できませんでした: ${published.error.message}`, 'error'), 303);
  }

  await supabase.from('app_event_logs').insert({
    user_id: actor.id,
    actor_id: actor.auth_user_id,
    event_type: 'admin.terms_published',
    event_version: 'production_v1',
    payload: { document_id: published.data, terms_type: 'service_terms', version, title },
  });

  return NextResponse.redirect(operationsUrl(req, `規約 ${version} を公開しました。全ユーザーに再同意が求められます。`), 303);
}

