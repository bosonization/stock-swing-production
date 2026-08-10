import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

export async function POST(req: Request) {
  const form = await req.formData();
  const email = String(form.get('email') || '').trim();
  const password = String(form.get('password') || '');
  if (!email || !password) return NextResponse.redirect(new URL('/?error=missing_credentials', req.url), 303);

  const supabase = supabaseAdmin();
  const result = await supabase.auth.signInWithPassword({ email, password });
  if (result.error || !result.data.session) {
    return NextResponse.redirect(new URL('/?error=invalid_credentials', req.url), 303);
  }
  const appUser = await supabase.from('app_users').select('id,status').eq('auth_user_id', result.data.user.id).single();
  if (appUser.error || !appUser.data || appUser.data.status !== 'active') {
    return NextResponse.redirect(new URL('/?error=inactive_user', req.url), 303);
  }

  const response = NextResponse.redirect(new URL(`/u/${encodeURIComponent(appUser.data.id)}`, req.url), 303);
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set(ACCESS_COOKIE, result.data.session.access_token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: result.data.session.expires_in });
  response.cookies.set(REFRESH_COOKIE, result.data.session.refresh_token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30 });
  return response;
}
