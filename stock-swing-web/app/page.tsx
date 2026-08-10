import { redirect } from 'next/navigation';
import { currentAppUser } from '../lib/auth';

type HomeSearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value?: string | string[]) {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

export default async function Home({ searchParams }: { searchParams?: HomeSearchParams }) {
  const query = searchParams ? await searchParams : {};
  const user = firstParam(query.user);
  const key = firstParam(query.key);
  const target = firstParam(query.target || query.target_user || query.targetUser);

  if (user && key) {
    const targetUserId = target || user;
    const params = new URLSearchParams({ user, key });
    redirect(`/u/${encodeURIComponent(targetUserId)}?${params.toString()}`);
  }

  const signedIn = await currentAppUser();
  if (signedIn) redirect(`/u/${encodeURIComponent(signedIn.id)}`);
  const error = firstParam(query.error);
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="eyebrow">Swing Technical Service</div>
        <h1>Stock Swing Dashboard</h1>
        <p className="meta">登録銘柄を、既定の26条件とイベント情報で整理します。</p>
        {error ? <p className="alert">メールアドレスまたはパスワードを確認してください。</p> : null}
        <form action="/api/auth/login" method="post" className="auth-form">
          <label>メールアドレス<input className="input" type="email" name="email" autoComplete="email" required /></label>
          <label>パスワード<input className="input" type="password" name="password" autoComplete="current-password" required /></label>
          <button className="btn" type="submit">ログイン</button>
        </form>
        <p className="disclaimer">本サービスは売買推奨ではありません。表示値は定義済み条件への一致状況です。</p>
      </section>
    </main>
  );
}
