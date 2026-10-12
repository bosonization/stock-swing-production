import Link from 'next/link';
import { authorizeUserId } from '../../../../lib/auth';
import { COMMUNITY_FEATURE, getFeatureEntitlements, STOCK_SWING_FEATURE } from '../../../../lib/community';
import { supabaseAdmin } from '../../../../lib/supabaseServer';
import { getRequiredTerms, type TermsDocument } from '../../../../lib/terms';

type Announcement = { id: string; title: string; body: string; published_at: string | null };
type Lesson = { id: string; title: string; summary: string; body: string; sort_order: number };
type CommunityEvent = { id: string; title: string; description: string; starts_at: string; ends_at: string | null; meeting_url: string | null };
type Registration = { event_id: string; status: string };
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function displayName(user: { display_name?: string | null; email?: string | null }) {
  const name = String(user.display_name || '').trim();
  const uuid = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(name);
  if (name && !uuid) return name;
  return String(user.email || '').split('@')[0] || 'メンバー';
}

function formatJst(value?: string | null) {
  if (!value) return '日時未定';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日時未定';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function TermsConsent({ userId, document }: { userId: string; document: TermsDocument }) {
  return (
    <main className="wrap premium-wrap">
      <section className="section consent-box">
        <div className="eyebrow dark-eyebrow">Terms Agreement</div>
        <h1>{document.title}</h1>
        <p className="terms-version">版: {document.version}</p>
        <div className="terms-body">{document.body}</div>
        <form action="/api/consents/terms" method="POST" className="consent-form">
          <input type="hidden" name="userId" value={userId} />
          <input type="hidden" name="documentId" value={document.id} />
          <input type="hidden" name="returnTo" value={`/u/${userId}/home`} />
          <label className="consent-check"><input type="checkbox" name="agreed" value="yes" required /> 上記を確認し、同意します。</label>
          <button className="btn" type="submit">同意してコミュニティへ</button>
        </form>
      </section>
    </main>
  );
}

export default async function CommunityHome({ params, searchParams }: { params: Promise<{ userId: string }>; searchParams?: SearchParams }) {
  const { userId } = await params;
  const user = await authorizeUserId(userId);
  const terms = await getRequiredTerms(user.id);
  if (!terms.agreed) return <TermsConsent userId={user.id} document={terms.document} />;

  const query = searchParams ? await searchParams : {};
  const message = firstParam(query.message);
  const error = firstParam(query.error);
  const supabase = supabaseAdmin();
  const now = new Date().toISOString();
  const [announcementsResult, lessonsResult, eventsResult, registrationsResult, entitlements] = await Promise.all([
    supabase.from('announcements').select('id,title,body,published_at').eq('status', 'published').order('published_at', { ascending: false }).limit(5),
    supabase.from('lessons').select('id,title,summary,body,sort_order').eq('status', 'published').order('sort_order').limit(12),
    supabase.from('community_events').select('id,title,description,starts_at,ends_at,meeting_url').eq('status', 'published').gte('starts_at', now).order('starts_at').limit(6),
    supabase.from('event_registrations').select('event_id,status').eq('user_id', user.id),
    getFeatureEntitlements(user.id),
  ]);
  const firstError = [announcementsResult.error, lessonsResult.error, eventsResult.error, registrationsResult.error].find(Boolean);
  if (firstError) throw new Error(`コミュニティ情報を読み込めません: ${firstError?.message}`);

  const announcements = (announcementsResult.data || []) as Announcement[];
  const lessons = (lessonsResult.data || []) as Lesson[];
  const events = (eventsResult.data || []) as CommunityEvent[];
  const registrations = new Map(((registrationsResult.data || []) as Registration[]).map((row) => [row.event_id, row.status]));
  const communityEnabled = entitlements.get(COMMUNITY_FEATURE)?.enabled === true || user.role === 'admin';
  const toolEnabled = entitlements.get(STOCK_SWING_FEATURE)?.enabled === true || user.role === 'admin';

  if (!communityEnabled) {
    return <main className="wrap premium-wrap"><section className="section tool-unavailable"><h1>コミュニティは現在利用できません</h1><p>利用状態については、運営窓口へお問い合わせください。</p><form action="/api/auth/logout" method="post"><button className="btn" type="submit">ログアウト</button></form></section></main>;
  }

  return (
    <>
      <header className="community-hero">
        <nav className="community-nav">
          <div><span className="community-mark">企業を読むノート部</span><small>公式コミュニティ</small></div>
          <div className="community-nav-actions">
            {user.role === 'admin' ? <Link href="/admin/community">コミュニティ管理</Link> : null}
            {user.role === 'admin' ? <Link href="/admin/operations">運営管理</Link> : null}
            <Link href={`/u/${user.id}/account`}>アカウント</Link>
          </div>
        </nav>
        <div className="community-welcome">
          <div className="eyebrow">LEARN · RECORD · REVIEW</div>
          <h1>{displayName(user)}さん、こんにちは</h1>
          <p>企業情報を読み、事実と考えを分けて記録し、月ごとに振り返るための場所です。</p>
        </div>
      </header>

      <main className="wrap community-wrap">
        {message ? <p className="success-message">{message}</p> : null}
        {error ? <p className="alert">{error}</p> : null}

        <section className="community-principle">
          <b>このコミュニティの約束</b>
          <span>特定銘柄の売買推奨や個別投資相談ではなく、学習・記録・振り返りを支援します。公式情報と手続はこのサイトで確認してください。</span>
        </section>

        <section className="community-tools" aria-label="利用できる機能">
          <article className="community-tool-card primary">
            <span className="tool-kicker">今月の基本</span>
            <h2>学ぶ・記録する</h2>
            <p>短い教材から始め、確認した事実と自分の考えを分けて残します。</p>
            <a href="#lessons" className="community-link">教材を見る</a>
          </article>
          <article className={`community-tool-card ${toolEnabled ? 'tool-available' : 'tool-locked'}`}>
            <span className="tool-kicker">任意機能</span>
            <h2>銘柄整理ツール</h2>
            <p>{toolEnabled ? '登録銘柄を既定の条件とイベント情報で機械的に整理します。' : '現在、このアカウントではツール機能を利用できません。'}</p>
            {toolEnabled ? <Link href={`/u/${user.id}`} className="community-link">ツールを開く</Link> : <span className="community-link disabled">運営者の有効化が必要です</span>}
          </article>
          <article className="community-tool-card">
            <span className="tool-kicker">困ったとき</span>
            <h2>公式サポート</h2>
            <p>操作、アカウント、イベント、退会に関する連絡はこちらで受け付けます。</p>
            <a href="#support" className="community-link">問い合わせる</a>
          </article>
        </section>

        <section className="community-grid-two">
          <div className="community-panel">
            <div className="community-heading"><div><span>OFFICIAL</span><h2>公式のお知らせ</h2></div></div>
            {announcements.length ? <div className="announcement-list">{announcements.map((item) => (
              <article key={item.id}><time>{formatJst(item.published_at)}</time><h3>{item.title}</h3><p>{item.body}</p></article>
            ))}</div> : <p className="community-empty">現在のお知らせはありません。</p>}
          </div>

          <div className="community-panel">
            <div className="community-heading"><div><span>SCHEDULE</span><h2>これからの開催</h2></div></div>
            {events.length ? <div className="event-list">{events.map((event) => {
              const registered = registrations.get(event.id) === 'registered';
              return <article key={event.id}>
                <time>{formatJst(event.starts_at)}</time><h3>{event.title}</h3><p>{event.description}</p>
                <form action={`/api/community/events/${event.id}`} method="post">
                  <input type="hidden" name="userId" value={user.id} />
                  <input type="hidden" name="intent" value={registered ? 'cancel' : 'register'} />
                  <button className={`mini-btn ${registered ? 'subtle-button' : ''}`} type="submit">{registered ? '参加を取り消す' : '参加する'}</button>
                </form>
                {registered && event.meeting_url ? <a className="event-meeting-link" href={event.meeting_url} target="_blank" rel="noreferrer">参加URLを開く</a> : null}
              </article>;
            })}</div> : <p className="community-empty">現在、公開中の開催予定はありません。</p>}
          </div>
        </section>

        <section className="community-panel" id="lessons">
          <div className="community-heading"><div><span>LEARNING</span><h2>基礎教材</h2></div><small>{lessons.length}件</small></div>
          {lessons.length ? <div className="lesson-grid">{lessons.map((lesson, index) => (
            <details className="lesson-card" key={lesson.id} open={index === 0}>
              <summary><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{lesson.title}</h3><p>{lesson.summary}</p></div></summary>
              <div className="lesson-body">{lesson.body}</div>
            </details>
          ))}</div> : <p className="community-empty">公開中の教材はありません。</p>}
        </section>

        <section className="community-panel support-panel" id="support">
          <div className="community-heading"><div><span>SUPPORT</span><h2>公式サポート窓口</h2></div></div>
          <p>LINEでは正式な受付を行いません。返信に必要な内容だけを入力し、証券口座や資産額などは書かないでください。</p>
          <form className="support-form" action="/api/community/support" method="post">
            <input type="hidden" name="userId" value={user.id} />
            <label>お問い合わせ種別<select className="input" name="category" required><option value="operation">操作方法</option><option value="account">アカウント</option><option value="event">イベント</option><option value="withdrawal">退会・契約</option><option value="other">その他</option></select></label>
            <label>件名<input className="input" name="subject" minLength={3} maxLength={160} required /></label>
            <label>内容<textarea className="input" name="message" rows={6} minLength={10} maxLength={5000} required /></label>
            <button className="btn" type="submit">公式窓口へ送信</button>
          </form>
        </section>

        <footer className="community-footer">
          <p>LINE等の外部グループは公式サイトとは別です。契約・退会・返金・重要なお知らせは、このサイトの内容を正とします。</p>
          <form action="/api/auth/logout" method="post"><button className="btn" type="submit">ログアウト</button></form>
        </footer>
      </main>
    </>
  );
}
