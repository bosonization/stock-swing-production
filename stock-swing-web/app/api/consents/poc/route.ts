import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

const CONSENT_TYPE = 'poc_terms';
const DEFAULT_VERSION = 'poc_terms_v1';

async function parseBody(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return req.json();
  const form = await req.formData();
  return Object.fromEntries(form.entries());
}

export async function POST(req: Request) {
  const body: any = await parseBody(req);
  const userId = String(body.userId || '').trim();
  const version = String(body.version || DEFAULT_VERSION).trim();
  const agreed = body.agreed === 'yes' || body.agreed === true || body.agreed === 'true';
  const returnPath = String(body.returnPath || `/u/${encodeURIComponent(userId)}`).trim();

  if (!userId || !agreed) return NextResponse.json({ error: 'consent is required' }, { status: 400 });

  const h = await headers();
  const userAgent = h.get('user-agent') || null;
  const ipAddress = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null;

  const supabase = supabaseAdmin();
  const insert = await supabase.from('user_consents').insert({
    user_id: userId,
    consent_type: CONSENT_TYPE,
    version,
    agreed_at: new Date().toISOString(),
    user_agent: userAgent,
    ip_address: ipAddress,
  });
  if (insert.error) return NextResponse.json({ error: insert.error.message }, { status: 500 });

  const redirectUrl = returnPath.startsWith('/') && !returnPath.startsWith('//') ? new URL(returnPath, req.url) : new URL(`/u/${encodeURIComponent(userId)}`, req.url);
  return NextResponse.redirect(redirectUrl, { status: 303 });
}
