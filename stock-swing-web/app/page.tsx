import { redirect } from 'next/navigation';
import { currentAppUser } from '../lib/auth';
import Link from 'next/link';

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
  if (signedIn) redirect(`/u/${encodeURIComponent(signedIn.id)}/home`);
  const error = firstParam(query.error);
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="eyebrow dark-eyebrow">Learning Community</div>
        <h1>企業を読むノート部</h1>
        <p className="meta">企業情報を学び、記録し、月ごとに振り返る公式コミュニティです。</p>
        {error ? <p className="alert">メールアドレスまたはパスワードを確認してください。</p> : null}
        <form action="/api/auth/login" method="post" className="auth-form">
          <label>メールアドレス<input className="input" type="email" name="email" autoComplete="email" required /></label>
          <label>パスワード<input className="input" type="password" name="password" autoComplete="current-password" required /></label>
          <button className="btn" type="submit">ログイン</button>
        </form>
        <div className="auth-help"><Link href="/forgot-password">パスワードを忘れた方</Link></div>
        <p className="disclaimer">本サービスは学習・記録・振り返りを支援するもので、特定銘柄の売買を推奨するものではありません。</p>
      </section>
    </main>
  );
}
