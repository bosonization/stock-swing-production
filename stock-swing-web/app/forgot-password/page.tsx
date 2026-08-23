'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'メールを送信できませんでした。');
      setMessage(json.message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="eyebrow">Account Recovery</div>
        <h1>パスワードを忘れた方</h1>
        <p className="meta">登録メールアドレスへ、パスワード変更用URLを送ります。</p>
        <form className="auth-form" onSubmit={submit}>
          <label>メールアドレス<input className="input" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          {error ? <p className="alert" role="alert">{error}</p> : null}
          {message ? <p className="success-message" role="status">{message}</p> : null}
          <button className="btn" type="submit" disabled={busy}>{busy ? '送信中…' : '変更用メールを送信'}</button>
        </form>
        <div className="footer-links"><Link className="btn" href="/">ログイン画面へ戻る</Link></div>
      </section>
    </main>
  );
}
