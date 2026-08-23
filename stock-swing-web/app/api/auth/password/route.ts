import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, apiAppUser } from '../../../../lib/auth';
import { supabaseAdmin } from '../../../../lib/supabaseServer';

const PASSWORD_MIN_LENGTH = 10;

export async function POST(req: Request) {
  const actor = await apiAppUser();
  if (!actor?.auth_user_id || !actor.email) {
    return NextResponse.json({ error: 'ログインし直してください。' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword || '');
  const newPassword = String(body.newPassword || '');
  const confirmPassword = String(body.confirmPassword || '');

  if (!currentPassword || !newPassword || !confirmPassword) {
    return NextResponse.json({ error: 'すべての項目を入力してください。' }, { status: 400 });
  }
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return NextResponse.json({ error: `新しいパスワードは${PASSWORD_MIN_LENGTH}文字以上にしてください。` }, { status: 400 });
  }
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ error: '新しいパスワードと確認用パスワードが一致しません。' }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: '現在とは異なるパスワードを指定してください。' }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const verification = await supabase.auth.signInWithPassword({
    email: actor.email,
    password: currentPassword,
  });
  if (verification.error) {
    return NextResponse.json({ error: '現在のパスワードが正しくありません。' }, { status: 400 });
  }

  const updated = await supabase.auth.admin.updateUserById(actor.auth_user_id, {
    password: newPassword,
  });
  if (updated.error) {
    return NextResponse.json({ error: 'パスワードを変更できませんでした。時間をおいて再度お試しください。' }, { status: 500 });
  }

  await supabase.from('app_event_logs').insert({
    user_id: actor.id,
    actor_id: actor.auth_user_id,
    event_type: 'password_changed',
    event_version: 'production_v1',
    payload: {},
    created_at: new Date().toISOString(),
  }).then(() => null);

  const response = NextResponse.json({ ok: true, message: 'パスワードを変更しました。新しいパスワードでログインしてください。' });
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
  return response;
}
