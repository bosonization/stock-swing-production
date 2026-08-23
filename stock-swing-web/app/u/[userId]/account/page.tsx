import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAppUser } from '../../../../lib/auth';
import PasswordForm from './PasswordForm';

export default async function AccountPage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  const user = await requireAppUser();
  if (user.id !== userId) redirect(`/u/${encodeURIComponent(user.id)}/account`);

  return (
    <main className="wrap account-wrap">
      <section className="section account-card">
        <div className="eyebrow">Account Security</div>
        <h1>パスワード変更</h1>
        <p>{user.display_name || user.email} のログインパスワードを変更します。</p>
        <PasswordForm />
        <div className="footer-links"><Link className="btn" href={`/u/${encodeURIComponent(userId)}`}>ダッシュボードへ戻る</Link></div>
      </section>
    </main>
  );
}
