import { NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './lib/auth';

function expiresSoon(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return !payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000) + 60;
  } catch {
    return true;
  }
}

export async function middleware(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refreshToken || (accessToken && !expiresSoon(accessToken))) return NextResponse.next();

  const url = process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.next();
  const refreshed = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!refreshed.ok) return NextResponse.next();
  const session = await refreshed.json();
  const response = NextResponse.next();
  const secure = process.env.NODE_ENV === 'production';
  response.cookies.set(ACCESS_COOKIE, session.access_token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: session.expires_in });
  response.cookies.set(REFRESH_COOKIE, session.refresh_token, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30 });
  return response;
}

export const config = { matcher: ['/u/:path*', '/api/:path*'] };
