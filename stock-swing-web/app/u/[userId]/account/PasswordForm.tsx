'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'パスワードを変更できませんでした。');
      setMessage(json.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => router.replace('/'), 1500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="account-form" onSubmit={submit}>
      <label>現在のパスワード<input className="input" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
      <label>新しいパスワード<input className="input" type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
      <label>新しいパスワード（確認）<input className="input" type="password" autoComplete="new-password" minLength={10} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
      <p className="meta account-note">10文字以上で、他のサービスと異なるパスワードを設定してください。</p>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      {message ? <p className="success-message" role="status">{message}</p> : null}
      <button className="btn" type="submit" disabled={busy}>{busy ? '変更中…' : 'パスワードを変更'}</button>
    </form>
  );
}
