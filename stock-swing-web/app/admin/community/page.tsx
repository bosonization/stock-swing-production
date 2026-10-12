import Link from 'next/link';
import { requireAdmin } from '../../../lib/auth';
import { supabaseAdmin } from '../../../lib/supabaseServer';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value?: string | string[]) {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function formatJst(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: '下書き', published: '公開中', archived: '終了', cancelled: '中止', completed: '終了',
    open: '未対応', in_progress: '対応中', resolved: '解決', closed: '終了',
  };
  return labels[status] || status;
}

export default async function CommunityAdmin({ searchParams }: { searchParams?: SearchParams }) {
  const admin = await requireAdmin();
  const query = searchParams ? await searchParams : {};
  const message = firstParam(query.message);
  const error = firstParam(query.error);
  const supabase = supabaseAdmin();
  const [announcements, lessons, events, tickets, users, roles] = await Promise.all([
    supabase.from('announcements').select('id,title,status,published_at,created_at').order('created_at', { ascending: false }).limit(30),
    supabase.from('lessons').select('id,title,status,sort_order,published_at').order('sort_order').limit(50),
    supabase.from('community_events').select('id,title,status,starts_at,ends_at').order('starts_at', { ascending: false }).limit(30),
    supabase.from('support_tickets').select('id,user_id,category,subject,message,status,created_at').order('created_at', { ascending: false }).limit(50),
    supabase.from('app_users').select('id,display_name,email,status').order('created_at'),
    supabase.from('role_assignments').select('id,user_id,role,is_active,updated_at').eq('is_active', true).order('updated_at', { ascending: false }),
  ]);
  const firstError = [announcements.error, lessons.error, events.error, tickets.error, users.error, roles.error].find(Boolean);
  if (firstError) throw new Error(`コミュニティ管理情報を読み込めません: ${firstError?.message}`);
  const userMap = new Map((users.data || []).map((user: any) => [user.id, user.display_name || user.email || user.id]));
  const openTickets = (tickets.data || []).filter((ticket: any) => ['open', 'in_progress'].includes(ticket.status));

  return (
    <>
      <header className="hero operations-hero">
        <div className="eyebrow">Community Administration</div>
        <h1>コミュニティ管理</h1>
        <p className="hero-lead">公式告知、教材、開催予定、問い合わせ、担当役割を管理します。</p>
        <p className="meta">管理者: {admin.display_name || admin.email}</p>
      </header>
      <main className="wrap operations-wrap">
        {message ? <p className="success-message">{message}</p> : null}
        {error ? <p className="alert">{error}</p> : null}

        <section className="operations-summary">
          <div><span>公開中のお知らせ</span><b>{(announcements.data || []).filter((x: any) => x.status === 'published').length}</b></div>
          <div><span>公開教材</span><b>{(lessons.data || []).filter((x: any) => x.status === 'published').length}</b></div>
          <div><span>開催予定</span><b>{(events.data || []).filter((x: any) => x.status === 'published' && new Date(x.starts_at) >= new Date()).length}</b></div>
          <div><span>未完了の問い合わせ</span><b>{openTickets.length}</b></div>
          <div><span>担当割当</span><b>{(roles.data || []).length}</b></div>
        </section>

        <section className="community-admin-grid">
          <article className="section operations-section">
            <h2>公式のお知らせを作成</h2>
            <form action="/api/admin/community" method="post" className="community-admin-form">
              <input type="hidden" name="action" value="announcement" />
              <label>タイトル<input className="input" name="title" minLength={3} maxLength={160} required /></label>
              <label>本文<textarea className="input" name="body" rows={7} minLength={1} maxLength={10000} required /></label>
              <label>状態<select className="input" name="status"><option value="published">公開する</option><option value="draft">下書き</option></select></label>
              <button className="btn" type="submit">保存</button>
            </form>
          </article>

          <article className="section operations-section">
            <h2>教材を作成</h2>
            <form action="/api/admin/community" method="post" className="community-admin-form">
              <input type="hidden" name="action" value="lesson" />
              <label>タイトル<input className="input" name="title" minLength={3} maxLength={160} required /></label>
              <label>概要<textarea className="input" name="summary" rows={3} maxLength={500} /></label>
              <label>本文<textarea className="input" name="body" rows={7} minLength={1} maxLength={30000} required /></label>
              <div className="form-split"><label>表示順<input className="input" type="number" name="sortOrder" defaultValue="100" /></label><label>状態<select className="input" name="status"><option value="draft">下書き</option><option value="published">公開する</option></select></label></div>
              <button className="btn" type="submit">保存</button>
            </form>
          </article>

          <article className="section operations-section">
            <h2>イベントを作成</h2>
            <form action="/api/admin/community" method="post" className="community-admin-form">
              <input type="hidden" name="action" value="event" />
              <label>名称<input className="input" name="title" minLength={3} maxLength={160} required /></label>
              <label>説明<textarea className="input" name="description" rows={4} maxLength={5000} /></label>
              <div className="form-split"><label>開始（日本時間）<input className="input" type="datetime-local" name="startsAt" required /></label><label>終了（日本時間）<input className="input" type="datetime-local" name="endsAt" /></label></div>
              <label>参加URL<input className="input" type="url" name="meetingUrl" placeholder="https://..." /></label>
              <label>状態<select className="input" name="status"><option value="published">公開する</option><option value="draft">下書き</option></select></label>
              <button className="btn" type="submit">保存</button>
            </form>
          </article>

          <article className="section operations-section">
            <h2>担当役割を割り当てる</h2>
            <p className="account-note">システムの管理者権限とは別に、実際の運営業務の担当を記録します。</p>
            <form action="/api/admin/community" method="post" className="community-admin-form">
              <input type="hidden" name="action" value="role" />
              <label>対象者<select className="input" name="userId" required>{(users.data || []).map((user: any) => <option value={user.id} key={user.id}>{userMap.get(user.id)}</option>)}</select></label>
              <label>役割<select className="input" name="role"><option value="business_owner">事業・運営責任者</option><option value="technical_admin">技術管理者</option><option value="community_manager">コミュニティ進行</option><option value="instructor">教育担当</option><option value="member">一般会員</option></select></label>
              <button className="btn" type="submit">役割を記録</button>
            </form>
            <ul className="role-list">{(roles.data || []).map((role: any) => <li key={role.id}><b>{userMap.get(role.user_id) || role.user_id}</b><span>{role.role}</span></li>)}</ul>
          </article>
        </section>

        <section className="section operations-section">
          <div className="section-headline"><div><h2>公式コンテンツ</h2><p>現在登録されているお知らせ、教材、開催予定です。</p></div></div>
          <div className="operations-table-wrap"><table className="operations-table compact"><thead><tr><th>種類</th><th>タイトル</th><th>状態</th><th>公開・開催日時</th><th>公開操作</th></tr></thead><tbody>
            {(announcements.data || []).map((x: any) => <tr key={`a-${x.id}`}><td>お知らせ</td><td>{x.title}</td><td>{statusLabel(x.status)}</td><td>{formatJst(x.published_at || x.created_at)}</td><td><form action="/api/admin/community" method="post"><input type="hidden" name="action" value="content_status" /><input type="hidden" name="kind" value="announcement" /><input type="hidden" name="contentId" value={x.id} /><input type="hidden" name="status" value={x.status === 'published' ? 'archived' : 'published'} /><button className={`mini-btn ${x.status === 'published' ? 'danger-button' : 'success-button'}`} type="submit">{x.status === 'published' ? '公開終了' : '公開'}</button></form></td></tr>)}
            {(lessons.data || []).map((x: any) => <tr key={`l-${x.id}`}><td>教材</td><td>{x.title}</td><td>{statusLabel(x.status)}</td><td>{formatJst(x.published_at)}</td><td><form action="/api/admin/community" method="post"><input type="hidden" name="action" value="content_status" /><input type="hidden" name="kind" value="lesson" /><input type="hidden" name="contentId" value={x.id} /><input type="hidden" name="status" value={x.status === 'published' ? 'archived' : 'published'} /><button className={`mini-btn ${x.status === 'published' ? 'danger-button' : 'success-button'}`} type="submit">{x.status === 'published' ? '公開終了' : '公開'}</button></form></td></tr>)}
            {(events.data || []).map((x: any) => <tr key={`e-${x.id}`}><td>イベント</td><td>{x.title}</td><td>{statusLabel(x.status)}</td><td>{formatJst(x.starts_at)}</td><td><form action="/api/admin/community" method="post"><input type="hidden" name="action" value="content_status" /><input type="hidden" name="kind" value="event" /><input type="hidden" name="contentId" value={x.id} /><input type="hidden" name="status" value={x.status === 'published' ? 'cancelled' : 'published'} /><button className={`mini-btn ${x.status === 'published' ? 'danger-button' : 'success-button'}`} type="submit">{x.status === 'published' ? '中止' : '公開'}</button></form></td></tr>)}
          </tbody></table></div>
        </section>

        <section className="section operations-section">
          <div className="section-headline"><div><h2>公式サポート受付</h2><p>LINEではなく、ここで対応状況を管理します。</p></div><span>{openTickets.length}件未完了</span></div>
          <div className="ticket-list">{(tickets.data || []).map((ticket: any) => <article className={`ticket-card ${ticket.status}`} key={ticket.id}>
            <div><span className="ops-status">{statusLabel(ticket.status)}</span><time>{formatJst(ticket.created_at)}</time></div>
            <h3>{ticket.subject}</h3><p className="ticket-owner">{userMap.get(ticket.user_id) || ticket.user_id} / {ticket.category}</p><p>{ticket.message}</p>
            <form action="/api/admin/community" method="post" className="ticket-action"><input type="hidden" name="action" value="ticket" /><input type="hidden" name="ticketId" value={ticket.id} /><select className="input" name="status" defaultValue={ticket.status}><option value="open">未対応</option><option value="in_progress">対応中</option><option value="resolved">解決</option><option value="closed">終了</option></select><button className="mini-btn" type="submit">更新</button></form>
          </article>)}</div>
        </section>

        <div className="footer-links"><Link className="btn" href={`/u/${admin.id}/home`}>コミュニティへ</Link><Link className="btn" href="/admin/operations">会員・規約管理へ</Link></div>
      </main>
    </>
  );
}
