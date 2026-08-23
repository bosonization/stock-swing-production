'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true } },
);

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function establishRecoverySession() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get('code');
      if (code) {
        const exchanged = await supabase.auth.exchangeCodeForSession(code);
        setInvalid(!!exchanged.error); setReady(!exchanged.error); return;
      }
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      const accessToken = hash.get('access_token');
      const refreshToken = hash.get('refresh_token');
      if (accessToken && refreshToken) {
        const session = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        setInvalid(!!session.error); setReady(!session.error); return;
      }
      const existing = await supabase.auth.getSession();
      setInvalid(!existing.data.session); setReady(!!existing.data.session);
    }
    void establishRecoverySession();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(''); setError('');
    try {
      if (newPassword.length < 10) throw new Error('新しいパスワードは10文字以上にしてください。');
      if (newPassword !== confirmPassword) throw new Error('確認用パスワードが一致しません。');
      const updated = await supabase.auth.updateUser({ password: newPassword });
      if (updated.error) throw updated.error;
      await supabase.auth.signOut();
      setMessage('パスワードを変更しました。ログイン画面から新しいパスワードでログインしてください。');
      setReady(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="eyebrow">Account Recovery</div>
        <h1>新しいパスワード</h1>
        {invalid ? <p className="alert">変更用URLが無効または期限切れです。もう一度メールを送信してください。</p> : null}
        {!ready && !invalid && !message ? <p className="meta">変更用URLを確認しています…</p> : null}
        {ready ? <form className="auth-form" onSubmit={submit}>
          <label>新しいパスワード<input className="input" type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
          <label>新しいパスワード（確認）<input className="input" type="password" autoComplete="new-password" minLength={10} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
          <p className="meta account-note">10文字以上で、他のサービスと異なるパスワードを設定してください。</p>
          {error ? <p className="alert" role="alert">{error}</p> : null}
          <button className="btn" type="submit" disabled={busy}>{busy ? '変更中…' : 'パスワードを変更'}</button>
        </form> : null}
        {message ? <p className="success-message" role="status">{message}</p> : null}
        <div className="footer-links">
          {invalid ? <Link className="btn" href="/forgot-password">変更用メールを再送</Link> : null}
          <Link className="btn" href="/">ログイン画面へ</Link>
        </div>
      </section>
    </main>
  );
}
