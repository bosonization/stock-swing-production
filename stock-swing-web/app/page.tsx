import { redirect } from 'next/navigation';

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

  return <main className="hero"><div className="eyebrow">Swing Technical Service</div><h1>Stock Swing Dashboard</h1><p className="meta">/u/u001?user=p098&amp;key=発行キー でPoC用ダッシュボードを表示します。トップページ経由の場合は /?target=u001&amp;user=p098&amp;key=発行キー を利用できます。</p></main>;
}
