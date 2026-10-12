import { createHmac } from 'crypto';
import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { apiAppUser } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

export async function POST(req: Request) {
  const actor = await apiAppUser();
  if (!actor) return NextResponse.redirect(new URL('/?error=login_required', req.url), 303);

  const form = await req.formData();
  const userId = String(form.get('userId') || '').trim();
  const documentId = String(form.get('documentId') || '').trim();
  const requestedReturnTo = String(form.get('returnTo') || '').trim();
  const agreed = form.get('agreed') === 'yes';
  if (!userId || !documentId || !agreed || actor.id !== userId) {
    return NextResponse.json({ error: 'invalid consent request' }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const document = await supabase
    .from('terms_documents')
    .select('id,terms_type,version,is_active')
    .eq('id', documentId)
    .eq('is_active', true)
    .single();
  if (document.error || !document.data) {
    return NextResponse.json({ error: '現在有効な規約を確認できませんでした。画面を再読込してください。' }, { status: 409 });
  }

  const requestHeaders = await headers();
  const userAgent = requestHeaders.get('user-agent') || null;
  const ipAddress = requestHeaders.get('x-forwarded-for')?.split(',')[0]?.trim() || requestHeaders.get('x-real-ip') || null;
  const hashSecret = process.env.POC_IP_HASH_SALT || process.env.SUPABASE_SERVICE_ROLE_KEY || 'stock-swing';
  const ipHash = ipAddress ? createHmac('sha256', hashSecret).update(ipAddress).digest('hex') : null;
  const agreedAt = new Date().toISOString();

  const saved = await supabase.from('user_consents').upsert({
    user_id: userId,
    consent_type: document.data.terms_type,
    version: document.data.version,
    agreed_at: agreedAt,
    user_agent: userAgent,
    ip_hash: ipHash,
  }, { onConflict: 'user_id,consent_type,version' });
  if (saved.error) return NextResponse.json({ error: saved.error.message }, { status: 500 });

  await supabase.from('app_event_logs').insert({
    user_id: userId,
    actor_id: actor.auth_user_id,
    event_type: 'terms.accepted',
    event_version: document.data.version,
    payload: { document_id: document.data.id, consent_type: document.data.terms_type, agreed_at: agreedAt },
  });

  const communityPath = `/u/${encodeURIComponent(userId)}/home`;
  const toolPath = `/u/${encodeURIComponent(userId)}`;
  const returnTo = requestedReturnTo === communityPath || requestedReturnTo === toolPath ? requestedReturnTo : communityPath;
  return NextResponse.redirect(new URL(returnTo, req.url), 303);
}

