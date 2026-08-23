import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'メールアドレスを入力してください。' }, { status: 400 });

  const origin = new URL(req.url).origin;
  const supabase = supabaseAdmin();
  // Do not reveal whether an account exists. Supabase applies its own mail rate limits.
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });

  return NextResponse.json({
    ok: true,
    message: '登録済みのメールアドレスであれば、パスワード変更用メールを送信しました。',
  });
}
