import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../../../lib/auth';

export async function POST(req: Request) {
  const response = NextResponse.redirect(new URL('/', req.url), 303);
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
